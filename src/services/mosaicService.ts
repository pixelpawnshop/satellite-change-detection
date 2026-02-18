import type { STACItem, BBox } from '../types';

/**
 * MosaicJSON service for creating and caching TiTiler-compatible mosaics
 * Follows MosaicJSON spec 0.0.3: https://github.com/developmentseed/mosaicjson-spec
 */

/**
 * Simple string hash function for cache keys
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

export interface MosaicJSON {
  mosaicjson: string;
  name?: string;
  description?: string;
  version: string;
  attribution?: string;
  minzoom: number;
  maxzoom: number;
  quadkey_zoom: number;
  bounds: [number, number, number, number]; // [west, south, east, north]
  center?: [number, number, number];
  tiles: Record<string, string[]>; // quadkey -> COG URLs
}

/**
 * Convert tile coordinates (z, x, y) to quadkey
 * Quadkey encoding: 0=NW, 1=NE, 2=SW, 3=SE
 */
function tileToQuadkey(z: number, x: number, y: number): string {
  let quadkey = '';
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit++;
    if ((y & mask) !== 0) digit += 2;
    quadkey += digit.toString();
  }
  return quadkey;
}

/**
 * Convert lat/lng to tile coordinates at given zoom
 */
function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number; z: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y, z: zoom };
}

/**
 * Get all quadkeys that intersect a bounding box at given zoom
 */
function getQuadkeysForBounds(bounds: BBox, zoom: number): string[] {
  const { west, south, east, north } = bounds;
  
  // Get tile coordinates for corners
  const nw = latLngToTile(north, west, zoom);
  const se = latLngToTile(south, east, zoom);
  
  const quadkeys: string[] = [];
  
  // Generate all tiles in the bounding box
  for (let x = nw.x; x <= se.x; x++) {
    for (let y = nw.y; y <= se.y; y++) {
      quadkeys.push(tileToQuadkey(zoom, x, y));
    }
  }
  
  return quadkeys;
}

/**
 * Calculate combined bounds from multiple STAC items
 */
function calculateCombinedBounds(items: STACItem[]): [number, number, number, number] {
  if (items.length === 0) {
    throw new Error('Cannot calculate bounds from empty items array');
  }
  
  let west = items[0].bounds.west;
  let south = items[0].bounds.south;
  let east = items[0].bounds.east;
  let north = items[0].bounds.north;
  
  for (const item of items) {
    west = Math.min(west, item.bounds.west);
    south = Math.min(south, item.bounds.south);
    east = Math.max(east, item.bounds.east);
    north = Math.max(north, item.bounds.north);
  }
  
  return [west, south, east, north];
}

/**
 * Generate MosaicJSON document from STAC items
 * 
 * @param items - Array of STAC items to mosaic
 * @param minZoom - Minimum zoom level (default: 8)
 * @param maxZoom - Maximum zoom level (default: 14 for Sentinel-2)
 * @param quadkeyZoom - Zoom level for quadkey tiling (default: 8)
 * @returns MosaicJSON document
 */
export function generateMosaicJSON(
  items: STACItem[],
  minZoom: number = 8,
  maxZoom: number = 14,
  quadkeyZoom: number = 8
): MosaicJSON {
  if (items.length === 0) {
    throw new Error('Cannot generate MosaicJSON from empty items array');
  }
  
  console.log(`Generating MosaicJSON for ${items.length} scenes at quadkey zoom ${quadkeyZoom}`);
  
  // Calculate combined bounds
  const bounds = calculateCombinedBounds(items);
  const [west, south, east, north] = bounds;
  
  // Calculate center
  const centerLng = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const center: [number, number, number] = [centerLng, centerLat, quadkeyZoom];
  
  // Build tile mapping: quadkey -> COG URLs
  const tiles: Record<string, string[]> = {};
  
  // For each item, find which quadkeys it intersects
  for (const item of items) {
    const itemQuadkeys = getQuadkeysForBounds(item.bounds, quadkeyZoom);
    
    for (const quadkey of itemQuadkeys) {
      if (!tiles[quadkey]) {
        tiles[quadkey] = [];
      }
      // Add COG URL if not already in list (avoid duplicates)
      if (!tiles[quadkey].includes(item.cogUrl!)) {
        tiles[quadkey].push(item.cogUrl!);
      }
    }
  }
  
  const quadkeyCount = Object.keys(tiles).length;
  const avgUrlsPerQuadkey = Object.values(tiles).reduce((sum, urls) => sum + urls.length, 0) / quadkeyCount;
  
  console.log(`MosaicJSON generated: ${quadkeyCount} quadkeys, avg ${avgUrlsPerQuadkey.toFixed(1)} URLs per quadkey`);
  
  // Build MosaicJSON document
  const mosaic: MosaicJSON = {
    mosaicjson: '0.0.3',
    version: '1.0.0',
    minzoom: minZoom,
    maxzoom: maxZoom,
    quadkey_zoom: quadkeyZoom,
    bounds,
    center,
    tiles,
    attribution: '© Copernicus Sentinel data',
    name: `Mosaic of ${items.length} scenes`,
    description: `Generated from ${items.length} Sentinel-2 scenes`
  };
  
  return mosaic;
}

/**
 * Create deterministic cache key for MosaicJSON
 * Key includes: sensor, dates, bounds, and render params for cache consistency
 */
export function createMosaicCacheKey(items: STACItem[], sensor: string): string {
  if (items.length === 0) {
    throw new Error('Cannot create cache key from empty items array');
  }
  
  // Sort items by date to ensure deterministic order
  const sortedItems = [...items].sort((a, b) => 
    new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
  );
  
  // Extract key components
  const dates = sortedItems.map(item => item.datetime).join(',');
  const bounds = calculateCombinedBounds(sortedItems);
  const boundsStr = bounds.map(b => b.toFixed(4)).join(',');
  
  // Include render params for cache consistency
  const renderParams = 'png_nearest_transparency'; // Fixed params for consistent caching
  
  // Create hash
  const keyString = `mosaic_v1_${sensor}_${dates}_${boundsStr}_${renderParams}`;
  const hash = simpleHash(keyString);
  
  return `mosaic_${sensor}_${hash}`;
}

/**
 * Get MosaicJSON from localStorage cache
 */
export function getMosaicFromCache(cacheKey: string): MosaicJSON | null {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      return null;
    }
    
    const mosaic = JSON.parse(cached) as MosaicJSON;
    console.log(`MosaicJSON cache HIT: ${cacheKey} (${Object.keys(mosaic.tiles).length} quadkeys)`);
    return mosaic;
  } catch (error) {
    console.warn(`Failed to read MosaicJSON from cache: ${error}`);
    return null;
  }
}

/**
 * Save MosaicJSON to localStorage cache
 */
export function saveMosaicToCache(cacheKey: string, mosaic: MosaicJSON): void {
  try {
    const json = JSON.stringify(mosaic);
    const sizeKB = (json.length / 1024).toFixed(1);
    
    localStorage.setItem(cacheKey, json);
    console.log(`MosaicJSON cached: ${cacheKey} (${sizeKB} KB, ${Object.keys(mosaic.tiles).length} quadkeys)`);
  } catch (error) {
    console.warn(`Failed to cache MosaicJSON (storage full?): ${error}`);
    // Not fatal - continue without cache
  }
}

/**
 * Clear old MosaicJSON cache entries (keep last 20)
 * Call periodically to prevent localStorage from filling up
 */
export function cleanMosaicCache(): void {
  try {
    const keys: string[] = [];
    
    // Find all mosaic cache keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mosaic_')) {
        keys.push(key);
      }
    }
    
    // Remove oldest entries if over limit
    const limit = 20;
    if (keys.length > limit) {
      const toRemove = keys.slice(0, keys.length - limit);
      for (const key of toRemove) {
        localStorage.removeItem(key);
      }
      console.log(`Cleaned ${toRemove.length} old MosaicJSON cache entries`);
    }
  } catch (error) {
    console.warn(`Failed to clean MosaicJSON cache: ${error}`);
  }
}

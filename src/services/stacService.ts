import { STACItem, BBox } from '../types';

const EARTH_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';
const PLANETARY_COMPUTER_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const COPERNICUS_STAC_URL = 'https://catalogue.dataspace.copernicus.eu/stac';
const TITILER_URL = 'https://titiler-1039034665364.europe-west1.run.app';

/**
 * Convert BBox to GeoJSON polygon for STAC queries
 */
function bboxToGeometry(bbox: BBox, bufferDegrees: number = 0) {
  return {
    type: 'Polygon',
    coordinates: [[
      [bbox.west - bufferDegrees, bbox.south - bufferDegrees],
      [bbox.east + bufferDegrees, bbox.south - bufferDegrees],
      [bbox.east + bufferDegrees, bbox.north + bufferDegrees],
      [bbox.west - bufferDegrees, bbox.north + bufferDegrees],
      [bbox.west - bufferDegrees, bbox.south - bufferDegrees]
    ]]
  };
}

/**
 * Check if two bounding boxes intersect
 */
function bboxesIntersect(bbox1: BBox, bbox2: BBox): boolean {
  return bbox1.west < bbox2.east && 
         bbox1.east > bbox2.west && 
         bbox1.south < bbox2.north &&
         bbox1.north > bbox2.south;
}

/**
 * Check if bbox1 fully contains bbox2
 */
function bboxContains(bbox1: BBox, bbox2: BBox): boolean {
  return bbox1.west <= bbox2.west &&
         bbox1.east >= bbox2.east &&
         bbox1.south <= bbox2.south &&
         bbox1.north >= bbox2.north;
}

/**
 * Calculate temporal distance between two dates in days
 */
function dateDiffDays(date1: Date, date2: Date): number {
  return Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Format date for STAC API queries (ISO 8601)
 */
function formatDateForSTAC(date: Date, daysOffset: number = 0): string {
  const d = new Date(date);
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().split('T')[0];
}

/**
 * Generate TiTiler preview URL for a scene
 * Note: Using full scene preview (not cropped to AOI) for faster loading
 */
function generatePreviewUrl(cogUrl: string, bbox?: BBox): string {
  // Generate preview of entire scene for speed (no bounds parameter)
  // This shows the full Sentinel-2 tile which is fine for cloud assessment
  return `${TITILER_URL}/cog/preview?url=${encodeURIComponent(cogUrl)}&width=256&max_size=512`;
}

/**
 * Search Sentinel-2 imagery and return multiple candidates per tile for user selection
 */
export async function searchSentinel2Mosaic(
  bbox: BBox,
  targetDate: Date,
  maxCloudCover: number = 10,  // Lowered default to 10%
  searchWindowDays: number = 30,
  maxCandidatesPerTile: number = 6
): Promise<STACItem[] | null> {
  const startDate = formatDateForSTAC(targetDate, -searchWindowDays);
  const endDate = formatDateForSTAC(targetDate, searchWindowDays);

  // Add 0.05 degree (~5km) buffer to catch tiles at AOI edges
  // This balances finding edge tiles while avoiding distant non-intersecting tiles
  const searchBody = {
    collections: ['sentinel-2-l2a'],
    intersects: bboxToGeometry(bbox, 0.05),
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    query: {
      'eo:cloud_cover': {
        lte: maxCloudCover
      }
    },
    limit: 200,  // Increased to get multiple candidates per tile
    sortby: [
      {
        field: 'properties.datetime',
        direction: 'desc'
      }
    ]
  };

  try {
    const response = await fetch(EARTH_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchBody)
    });

    if (!response.ok) {
      throw new Error(`STAC API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      return null;
    }

    console.log(`STAC API returned ${data.features.length} scenes within ±${searchWindowDays} days and <${maxCloudCover}% cloud cover`);
    
    // Find the closest date for reference
    let closestItem = data.features[0];
    let minDiff =  dateDiffDays(new Date(closestItem.properties.datetime), targetDate);

    for (const item of data.features) {
      const itemDate = new Date(item.properties.datetime);
      const diff = dateDiffDays(itemDate, targetDate);
      if (diff < minDiff) {
        minDiff = diff;
        closestItem = item;
      }
    }
    
    const closestDateStr = new Date(closestItem.properties.datetime).toISOString().split('T')[0];
    
    // Diagnostic: Show all available scenes grouped by date
    const scenesByDate = new Map<string, string[]>();
    for (const item of data.features) {
      const itemDateStr = new Date(item.properties.datetime).toISOString().split('T')[0];
      const tileId = item.id.split('_').slice(1, 2).join('_');
      if (!scenesByDate.has(itemDateStr)) {
        scenesByDate.set(itemDateStr, []);
      }
      scenesByDate.get(itemDateStr)!.push(tileId);
    }
    console.log(`Available scenes by date (closest: ${closestDateStr}):`, 
      Array.from(scenesByDate.entries())
        .sort()
        .map(([date, tiles]: [string, string[]]) => `${date}: ${tiles.join(', ')}`)
        .join(' | ')
    );
    
    // Group scenes by tile ID and keep top N candidates per tile sorted by date proximity
    const tileMap = new Map<string, Array<{ item: any; daysDiff: number }>>();
    
    for (const item of data.features) {
      const tileId = item.id.split('_').slice(1, 2).join('_'); // Extract tile ID like "20QKF"
      const itemDate = new Date(item.properties.datetime);
      const daysDiff = dateDiffDays(itemDate, targetDate);
      
      if (!tileMap.has(tileId)) {
        tileMap.set(tileId, []);
      }
      tileMap.get(tileId)!.push({ item, daysDiff });
    }
    
    // For each tile, keep only top N candidates sorted by date proximity
    const allCandidateItems: any[] = [];
    for (const [tileId, candidates] of tileMap.entries()) {
      // Sort by date proximity and cloud cover
      candidates.sort((a, b) => {
        const dateDiff = a.daysDiff - b.daysDiff;
        if (Math.abs(dateDiff) < 1) { // If dates are similar, prefer lower cloud cover
          return a.item.properties['eo:cloud_cover'] - b.item.properties['eo:cloud_cover'];
        }
        return dateDiff;
      });
      
      // Take top candidates for this tile
      const topCandidates = candidates.slice(0, maxCandidatesPerTile);
      
      // Add all top candidates to the list (scene selector will allow user to choose)
      topCandidates.forEach(c => allCandidateItems.push(c.item));
    }
    
    const sameDateItems = allCandidateItems;

    // Filter out scenes that don't actually intersect with AOI (only have buffered overlap)
    const beforeFilterCount = sameDateItems.length;
    const intersectingItems = sameDateItems.filter((item: any) => {
      const itemBbox: BBox = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };
      return bboxesIntersect(bbox, itemBbox);
    });
    
    if (intersectingItems.length < beforeFilterCount) {
      console.log(`Filtered ${beforeFilterCount} → ${intersectingItems.length} scenes (removed ${beforeFilterCount - intersectingItems.length} non-intersecting)`);
    }

    // Check if any single tile fully contains the AOI
    // If yes, we only need ONE tile (the best one), not a mosaic
    const tilesContainingAOI = intersectingItems.filter((item: any) => {
      const itemBbox: BBox = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };
      return bboxContains(itemBbox, bbox);
    });

    let finalItems = intersectingItems;
    if (tilesContainingAOI.length > 0) {
      // At least one tile fully contains the AOI - no mosaic needed
      // Group by date and pick the best tile for each date
      const byDate = new Map<string, any[]>();
      tilesContainingAOI.forEach((item: any) => {
        const date = new Date(item.properties.datetime).toISOString().split('T')[0];
        if (!byDate.has(date)) {
          byDate.set(date, []);
        }
        byDate.get(date)!.push(item);
      });

      // For each date, pick the tile with lowest cloud cover
      finalItems = Array.from(byDate.values()).map(items => {
        return items.sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover'])[0];
      });

      if (tilesContainingAOI.length > finalItems.length) {
        console.log(`AOI fully contained by ${tilesContainingAOI.length} tiles - selected ${finalItems.length} best tiles (no mosaic needed)`);
      }
    }

    // Calculate date range for logging
    const dates = finalItems.map((item: any) => new Date(item.properties.datetime).toISOString().split('T')[0]);
    const uniqueDates = Array.from(new Set(dates)).sort();
    const dateRange = uniqueDates.length > 1 
      ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`
      : uniqueDates[0];

    // Log tiles for diagnostic purposes
    const tiles = finalItems.map((item: any) => {
      const tileId = item.id.split('_').slice(1, 2).join('_'); // Extract tile ID like "29SPS"
      const date = new Date(item.properties.datetime).toISOString().split('T')[0];
      const cloudCover = Math.round(item.properties['eo:cloud_cover']);
      return `${tileId} (${date}, ${cloudCover}% cloud)`;
    });
    console.log(`Selected ${finalItems.length} scenes from ${dateRange}:`, tiles.join(', '));


    // Convert all items to STACItem format with preview URLs
    const stacItems: STACItem[] = [];
    
    for (const item of finalItems) {
      const tileId = item.id.split('_').slice(1, 2).join('_');
      const selfLink = item.links?.find((link: any) => link.rel === 'self');
      const stacItemUrl = selfLink?.href || `${EARTH_SEARCH_URL.replace('/search', '')}/collections/sentinel-2-l2a/items/${item.id}`;
      
      const visualAsset = item.assets?.visual;
      if (!visualAsset) {
        console.warn(`Skipping ${item.id} - no visual asset`);
        continue;
      }

      // Use built-in thumbnail if available, otherwise try to generate via TiTiler
      const thumbnailAsset = item.assets?.thumbnail;
      const previewUrl = thumbnailAsset?.href || generatePreviewUrl(visualAsset.href);
      
      // Debug: log available assets and chosen preview URL
      if (!thumbnailAsset) {
        console.log(`No thumbnail asset for ${item.id}, available assets:`, Object.keys(item.assets || {}));
        console.log(`Generated preview URL:`, previewUrl);
      }

      const itemBounds = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };

      stacItems.push({
        id: item.id,
        tileId: tileId,
        datetime: item.properties.datetime,
        cloudCover: item.properties['eo:cloud_cover'],
        cogUrl: visualAsset.href,
        stacItemUrl: stacItemUrl,
        previewUrl: previewUrl,
        bounds: itemBounds,
        collection: 'sentinel-2-l2a',
        properties: item.properties
      });
    }

    return stacItems.length > 0 ? stacItems : null;
  } catch (error) {
    console.error('Error searching Sentinel-2:', error);
    throw error;
  }
}

/**
 * Search Sentinel-2 imagery from AWS Earth Search (single scene)
 */
export async function searchSentinel2(
  bbox: BBox,
  targetDate: Date,
  maxCloudCover: number,
  searchWindowDays: number = 30
): Promise<STACItem | null> {
  const startDate = formatDateForSTAC(targetDate, -searchWindowDays);
  const endDate = formatDateForSTAC(targetDate, searchWindowDays);

  const searchBody = {
    collections: ['sentinel-2-l2a'],
    intersects: bboxToGeometry(bbox),
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    query: {
      'eo:cloud_cover': {
        lte: maxCloudCover
      }
    },
    limit: 50,
    sortby: [
      {
        field: 'properties.datetime',
        direction: 'desc'
      }
    ]
  };

  try {
    const response = await fetch(EARTH_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchBody)
    });

    if (!response.ok) {
      throw new Error(`STAC API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      return null;
    }

    // Filter to only scenes that actually intersect with AOI
    const intersectingFeatures = data.features.filter((item: any) => {
      const itemBbox: BBox = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };
      return bboxesIntersect(bbox, itemBbox);
    });

    if (intersectingFeatures.length === 0) {
      console.log('No Sentinel-2 scenes found that intersect with AOI');
      return null;
    }

    if (intersectingFeatures.length < data.features.length) {
      console.log(`Filtered ${data.features.length} → ${intersectingFeatures.length} Sentinel-2 scenes (removed ${data.features.length - intersectingFeatures.length} non-intersecting)`);
    }

    // Find the closest image to target date
    let closestItem = intersectingFeatures[0];
    let minDiff = dateDiffDays(new Date(closestItem.properties.datetime), targetDate);

    for (const item of intersectingFeatures) {
      const itemDate = new Date(item.properties.datetime);
      const diff = dateDiffDays(itemDate, targetDate);
      if (diff < minDiff) {
        minDiff = diff;
        closestItem = item;
      }
    }

    // Extract STAC item URL and visual COG URL
    console.log('Available assets:', Object.keys(closestItem.assets || {}));
    
    // Get self link for TiTiler STAC endpoint
    const selfLink = closestItem.links?.find((link: any) => link.rel === 'self');
    const stacItemUrl = selfLink?.href || `${EARTH_SEARCH_URL.replace('/search', '')}/collections/sentinel-2-l2a/items/${closestItem.id}`;
    
    // Get visual COG URL (TCI = True Color Image)
    const visualAsset = closestItem.assets?.visual;
    
    if (!visualAsset) {
      console.error('No visual asset found');
      console.warn('Available assets:', closestItem.assets);
      return null;
    }

    console.log('Using STAC item:', stacItemUrl);
    console.log('Visual COG URL:', visualAsset.href);

    return {
      id: closestItem.id,
      datetime: closestItem.properties.datetime,
      cloudCover: closestItem.properties['eo:cloud_cover'],
      cogUrl: visualAsset.href,
      stacItemUrl: stacItemUrl,
      bounds: {
        west: closestItem.bbox[0],
        south: closestItem.bbox[1],
        east: closestItem.bbox[2],
        north: closestItem.bbox[3]
      },
      collection: 'sentinel-2-l2a',
      properties: closestItem.properties
    };
  } catch (error) {
    console.error('Error searching Sentinel-2:', error);
    throw error;
  }
}

/**
 * Search Landsat imagery from Microsoft Planetary Computer
 * Uses public HTTPS access via Azure Blob Storage with SAS tokens
 * Supports Landsat 4-9 for historical and current analysis (1982-2026)
 */
export async function searchLandsat(
  bbox: BBox,
  targetDate: Date,
  maxCloudCover: number,
  searchWindowDays: number = 30,
  platforms: string[] = ['landsat-9', 'landsat-8', 'landsat-7', 'landsat-5', 'landsat-4'] // 44 years of coverage
): Promise<STACItem | null> {
  const startDate = formatDateForSTAC(targetDate, -searchWindowDays);
  const endDate = formatDateForSTAC(targetDate, searchWindowDays);

  const searchBody = {
    collections: ['landsat-c2-l2'],
    intersects: bboxToGeometry(bbox),
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    query: {
      'eo:cloud_cover': {
        lte: maxCloudCover
      },
      'platform': {
        in: platforms
      }
    },
    limit: 100, // Increased for more historical results
    sortby: [
      {
        field: 'properties.datetime',
        direction: 'desc'
      }
    ]
  };

  console.log(`Searching Landsat (${platforms.join(', ')}) for date ${targetDate.toISOString().split('T')[0]}`);

  try {
    const response = await fetch(PLANETARY_COMPUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchBody)
    });

    if (!response.ok) {
      throw new Error(`STAC API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      return null;
    }

    // Filter to only scenes that actually intersect with AOI
    const intersectingFeatures = data.features.filter((item: any) => {
      const itemBbox: BBox = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };
      return bboxesIntersect(bbox, itemBbox);
    });

    if (intersectingFeatures.length === 0) {
      console.log('No Landsat scenes found that intersect with AOI');
      return null;
    }

    if (intersectingFeatures.length < data.features.length) {
      console.log(`Filtered ${data.features.length} → ${intersectingFeatures.length} Landsat scenes (removed ${data.features.length - intersectingFeatures.length} non-intersecting)`);
    }

    // Find the closest image to target date
    let closestItem = intersectingFeatures[0];
    let minDiff = dateDiffDays(new Date(closestItem.properties.datetime), targetDate);

    for (const item of intersectingFeatures) {
      const itemDate = new Date(item.properties.datetime);
      const diff = dateDiffDays(itemDate, targetDate);
      if (diff < minDiff) {
        minDiff = diff;
        closestItem = item;
      }
    }

    // Extract STAC item URL for TiTiler STAC endpoint
    console.log(`Found Landsat scene: ${closestItem.id} (${closestItem.properties.platform})`);
    console.log('Available Landsat assets:', Object.keys(closestItem.assets || {}));
    
    // Use Planetary Computer's Data API for rendering (handles signing automatically)
    // This is simpler than manually extracting/signing individual band URLs
    const itemId = closestItem.id;
    const collectionId = 'landsat-c2-l2';
    
    // Store metadata for Planetary Computer rendering
    // The layerManager will use this to construct tile URLs via PC Data API
    const renderingInfo = {
      collection: collectionId,
      item: itemId,
      assets: ['red', 'green', 'blue'] // Common names that PC understands
    };
    
    console.log('Using Planetary Computer Data API for rendering');

    return {
      id: closestItem.id,
      datetime: closestItem.properties.datetime,
      cloudCover: closestItem.properties['eo:cloud_cover'],
      cogUrl: '', // Not used for Planetary Computer rendering
      stacItemUrl: '', // Not used for Planetary Computer rendering
      bounds: {
        west: closestItem.bbox[0],
        south: closestItem.bbox[1],
        east: closestItem.bbox[2],
        north: closestItem.bbox[3]
      },
      collection: 'landsat-c2-l2',
      properties: { ...closestItem.properties, renderingInfo }
    };
  } catch (error) {
    console.error('Error searching Landsat:', error);
    throw error;
  }
}

/**
 * Generate Sentinel-1 WMS URL from Copernicus Browser
 * Note: This uses pre-rendered visualizations since raw SAR processing is complex
 */
export function getSentinel1WMS(bbox: BBox, date: Date, daysWindow: number = 7): STACItem {
  const startDate = formatDateForSTAC(date, -daysWindow);
  const endDate = formatDateForSTAC(date, daysWindow);

  // Using Copernicus Data Space WMS service
  const wmsBaseUrl = 'https://sh.dataspace.copernicus.eu/ogc/wms/';
  
  // Note: This is a simplified URL. In production, you'd need to:
  // 1. Register for Copernicus Data Space account
  // 2. Get an instance ID
  // 3. Use proper authentication
  
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: 'AWS_VH_DB',
    styles: '',
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:4326',
    bbox: `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`,
    width: '1024',
    height: '1024',
    time: `${startDate}/${endDate}`,
    maxcc: '100' // Not applicable for SAR
  });

  const wmsUrl = `${wmsBaseUrl}?${params.toString()}`;

  return {
    id: `sentinel-1-${date.toISOString()}`,
    datetime: date.toISOString(),
    wmsUrl: wmsUrl,
    bounds: bbox,
    collection: 'sentinel-1-grd',
    properties: {
      sensor: 'SAR',
      note: 'Pre-rendered visualization from Copernicus Data Space'
    }
  };
}

/**
 * Search for closest imagery based on sensor type
 */
export async function searchImagery(
  sensor: 'sentinel-1' | 'sentinel-2' | 'landsat',
  bbox: BBox,
  targetDate: Date,
  maxCloudCover: number = 20
): Promise<STACItem | null> {
  switch (sensor) {
    case 'sentinel-2':
      return searchSentinel2(bbox, targetDate, maxCloudCover);
    case 'landsat':
      return searchLandsat(bbox, targetDate, maxCloudCover);
    case 'sentinel-1':
      return getSentinel1WMS(bbox, targetDate);
    default:
      throw new Error(`Unknown sensor type: ${sensor}`);
  }
}

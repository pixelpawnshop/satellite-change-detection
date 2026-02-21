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
 * Search Landsat imagery and return multiple path/rows for mosaicking
 * Groups by WRS-2 path/row to ensure full AOI coverage when it spans multiple scenes
 * Supports Landsat 4-9 for historical and current analysis (1982-2026)
 */
export async function searchLandsatMosaic(
  bbox: BBox,
  targetDate: Date,
  maxCloudCover: number,
  searchWindowDays: number = 30,
  platforms: string[] = ['landsat-9', 'landsat-8', 'landsat-7', 'landsat-5', 'landsat-4'],
  maxCandidatesPerPathRow: number = 6
): Promise<STACItem[] | null> {
  const startDate = formatDateForSTAC(targetDate, -searchWindowDays);
  const endDate = formatDateForSTAC(targetDate, searchWindowDays);

  // Add small buffer to catch scenes at AOI edges
  const searchBody = {
    collections: ['landsat-c2-l2'],
    intersects: bboxToGeometry(bbox, 0.05),
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    query: {
      'eo:cloud_cover': {
        lte: maxCloudCover
      },
      'platform': {
        in: platforms
      }
    },
    limit: 200, // Increased to get multiple candidates per path/row
    sortby: [
      {
        field: 'properties.datetime',
        direction: 'desc'
      }
    ]
  };

  console.log(`Searching Landsat mosaic (${platforms.join(', ')}) for date ${targetDate.toISOString().split('T')[0]}`);

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
      console.log(`No Landsat scenes found in STAC API response for ${targetDate.toISOString().split('T')[0]} (search window: ±${searchWindowDays} days, cloud cover ≤${maxCloudCover}%)`);
      return null;
    }

    console.log(`STAC API returned ${data.features.length} Landsat scenes within ±${searchWindowDays} days and <${maxCloudCover}% cloud cover`);

    // Find the closest date for reference
    let closestItem = data.features[0];
    let minDiff = dateDiffDays(new Date(closestItem.properties.datetime), targetDate);

    for (const item of data.features) {
      const itemDate = new Date(item.properties.datetime);
      const diff = dateDiffDays(itemDate, targetDate);
      if (diff < minDiff) {
        minDiff = diff;
        closestItem = item;
      }
    }

    const closestDateStr = new Date(closestItem.properties.datetime).toISOString().split('T')[0];

    // Group scenes by path/row (WRS-2 system) and keep top N candidates per path/row
    const pathRowMap = new Map<string, Array<{ item: any; daysDiff: number }>>();

    for (const item of data.features) {
      // Extract path/row from properties
      const path = item.properties['landsat:wrs_path'];
      const row = item.properties['landsat:wrs_row'];
      if (!path || !row) continue;

      const pathRowId = `${String(path).padStart(3, '0')}/${String(row).padStart(3, '0')}`;
      const itemDate = new Date(item.properties.datetime);
      const daysDiff = dateDiffDays(itemDate, targetDate);

      if (!pathRowMap.has(pathRowId)) {
        pathRowMap.set(pathRowId, []);
      }
      pathRowMap.get(pathRowId)!.push({ item, daysDiff });
    }

    // For each path/row, keep only top N candidates sorted by date proximity and cloud cover
    const allCandidateItems: any[] = [];
    for (const [pathRowId, candidates] of pathRowMap.entries()) {
      // Sort by date proximity and cloud cover
      candidates.sort((a, b) => {
        const dateDiff = a.daysDiff - b.daysDiff;
        if (Math.abs(dateDiff) < 1) { // If dates are similar, prefer lower cloud cover
          return a.item.properties['eo:cloud_cover'] - b.item.properties['eo:cloud_cover'];
        }
        return dateDiff;
      });

      // Take top candidates for this path/row
      const topCandidates = candidates.slice(0, maxCandidatesPerPathRow);
      topCandidates.forEach(c => allCandidateItems.push(c.item));
    }

    // Filter out scenes that don't actually intersect with AOI
    const beforeFilterCount = allCandidateItems.length;
    const intersectingItems = allCandidateItems.filter((item: any) => {
      const itemBbox: BBox = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };
      return bboxesIntersect(bbox, itemBbox);
    });

    if (intersectingItems.length < beforeFilterCount) {
      console.log(`Filtered ${beforeFilterCount} → ${intersectingItems.length} Landsat scenes (removed ${beforeFilterCount - intersectingItems.length} non-intersecting)`);
    }

    if (intersectingItems.length === 0) {
      console.log('No Landsat scenes found that intersect with AOI');
      return null;
    }

    // Check if any single scene fully contains the AOI
    const scenesContainingAOI = intersectingItems.filter((item: any) => {
      const itemBbox: BBox = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };
      return bboxContains(itemBbox, bbox);
    });

    let finalItems = intersectingItems;
    if (scenesContainingAOI.length > 0) {
      // At least one scene fully contains the AOI - no mosaic needed
      // Group by date and pick the best scene for each date
      const byDate = new Map<string, any[]>();
      scenesContainingAOI.forEach((item: any) => {
        const date = new Date(item.properties.datetime).toISOString().split('T')[0];
        if (!byDate.has(date)) {
          byDate.set(date, []);
        }
        byDate.get(date)!.push(item);
      });

      // For each date, pick the scene with lowest cloud cover
      finalItems = Array.from(byDate.values()).map(items => {
        return items.sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover'])[0];
      });

      if (scenesContainingAOI.length > finalItems.length) {
        console.log(`AOI fully contained by ${scenesContainingAOI.length} Landsat scenes - selected ${finalItems.length} best scenes (no mosaic needed)`);
      }
    }

    // Calculate date range for logging
    const dates = finalItems.map((item: any) => new Date(item.properties.datetime).toISOString().split('T')[0]);
    const uniqueDates = Array.from(new Set(dates)).sort();
    const dateRange = uniqueDates.length > 1
      ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`
      : uniqueDates[0];

    // Log scenes for diagnostic purposes
    const sceneDescriptions = finalItems.map((item: any) => {
      const path = item.properties['landsat:wrs_path'];
      const row = item.properties['landsat:wrs_row'];
      const pathRowId = `${String(path).padStart(3, '0')}/${String(row).padStart(3, '0')}`;
      const date = new Date(item.properties.datetime).toISOString().split('T')[0];
      const cloudCover = Math.round(item.properties['eo:cloud_cover']);
      const platform = item.properties.platform;
      return `${pathRowId} (${platform}, ${date}, ${cloudCover}% cloud)`;
    });
    console.log(`Selected ${finalItems.length} Landsat scenes from ${dateRange}:`, sceneDescriptions.join(', '));

    // Convert all items to STACItem format
    const stacItems: STACItem[] = [];

    for (const item of finalItems) {
      const path = item.properties['landsat:wrs_path'];
      const row = item.properties['landsat:wrs_row'];
      const pathRowId = `${String(path).padStart(3, '0')}/${String(row).padStart(3, '0')}`;
      
      const itemId = item.id;
      const collectionId = 'landsat-c2-l2';

      // Store metadata for Planetary Computer rendering
      const renderingInfo = {
        collection: collectionId,
        item: itemId,
        assets: ['red', 'green', 'blue']
      };

      const itemBounds = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };

      // Generate preview URL using Planetary Computer's Data API
      // Use preview endpoint with same color formula as full rendering
      const previewParams = new URLSearchParams({
        collection: collectionId,
        item: itemId,
      });
      previewParams.append('assets', 'red');
      previewParams.append('assets', 'green');
      previewParams.append('assets', 'blue');
      previewParams.append('color_formula', 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55');
      previewParams.append('width', '256');
      previewParams.append('height', '256');
      
      const previewUrl = `https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png?${previewParams.toString()}`;

      stacItems.push({
        id: item.id,
        tileId: pathRowId, // Use path/row as tile identifier
        datetime: item.properties.datetime,
        cloudCover: item.properties['eo:cloud_cover'],
        cogUrl: '', // Not used for Planetary Computer rendering
        stacItemUrl: '', // Not used for Planetary Computer rendering
        previewUrl: previewUrl,
        bounds: itemBounds,
        collection: 'landsat-c2-l2',
        properties: { ...item.properties, renderingInfo }
      });
    }

    return stacItems.length > 0 ? stacItems : null;
  } catch (error) {
    console.error('Error searching Landsat mosaic:', error);
    throw error;
  }
}

/**
 * Search Sentinel-1 GRD imagery from Microsoft Planetary Computer
 * Returns multiple scenes for mosaicking when AOI spans multiple relative orbits
 * Supports filtering by acquisition mode and polarization
 */
export async function searchSentinel1Mosaic(
  bbox: BBox,
  targetDate: Date,
  acquisitionMode: string = 'IW',
  polarization: string = 'VV+VH',
  searchWindowDays: number = 30,
  maxCandidatesPerOrbit: number = 6
): Promise<STACItem[] | null> {
  const startDate = formatDateForSTAC(targetDate, -searchWindowDays);
  const endDate = formatDateForSTAC(targetDate, searchWindowDays);

  // Parse polarization string (e.g., "VV+VH" -> ["VV", "VH"])
  const polarizations = polarization.includes('+') 
    ? polarization.split('+')
    : [polarization];

  // Build possible polarization arrays for query
  // For dual-pol, match both orders: ["VV", "VH"] or ["VH", "VV"]
  // For single-pol, match exact: ["VV"]
  const polarizationQuery = polarization.includes('+')
    ? [[...polarizations], [...polarizations].reverse()] // Both orders for dual-pol
    : [polarizations]; // Single array for single-pol

  // Add small buffer to catch scenes at AOI edges
  const searchBody = {
    collections: ['sentinel-1-grd'],
    intersects: bboxToGeometry(bbox, 0.05),
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    // Temporarily remove filters to diagnose
    // query: {
    //   'sar:instrument_mode': {
    //     eq: acquisitionMode
    //   },
    //   'sar:polarizations': {
    //     in: polarizationQuery
    //   }
    // },
    limit: 200,
    sortby: [
      {
        field: 'properties.datetime',
        direction: 'desc'
      }
    ]
  };

  console.log(`Searching Sentinel-1 GRD (mode: ${acquisitionMode}, polarization: ${polarization}) for date ${targetDate.toISOString().split('T')[0]}`);
  console.log('STAC query:', JSON.stringify(searchBody, null, 2));

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
      console.log(`No Sentinel-1 scenes found in STAC API response for ${targetDate.toISOString().split('T')[0]} (search window: ±${searchWindowDays} days, mode: ${acquisitionMode}, polarization: ${polarization})`);
      return null;
    }

    console.log(`STAC API returned ${data.features.length} Sentinel-1 scenes (unfiltered)`);

    // Client-side filter by acquisition mode and polarization
    const filteredFeatures = data.features.filter((item: any) => {
      // Check acquisition mode
      const itemMode = item.properties['sar:instrument_mode'];
      if (itemMode !== acquisitionMode) return false;

      // Check polarization availability
      const itemPolarizations = item.properties['sar:polarizations'] || [];
      if (polarization.includes('+')) {
        // Dual polarization - must have both
        const [pol1, pol2] = polarization.split('+');
        return itemPolarizations.includes(pol1) && itemPolarizations.includes(pol2);
      } else {
        // Single polarization
        return itemPolarizations.includes(polarization);
      }
    });

    if (filteredFeatures.length === 0) {
      console.log(`No Sentinel-1 scenes found after filtering for mode=${acquisitionMode}, polarization=${polarization}`);
      return null;
    }

    console.log(`${filteredFeatures.length} scenes match mode=${acquisitionMode}, polarization=${polarization}`);

    // Find the closest date for reference
    let closestItem = filteredFeatures[0];
    let minDiff = dateDiffDays(new Date(closestItem.properties.datetime), targetDate);

    for (const item of filteredFeatures) {
      const itemDate = new Date(item.properties.datetime);
      const diff = dateDiffDays(itemDate, targetDate);
      if (diff < minDiff) {
        minDiff = diff;
        closestItem = item;
      }
    }

    const closestDateStr = new Date(closestItem.properties.datetime).toISOString().split('T')[0];

    // Group scenes by relative orbit number (SAR equivalent to path)
    const orbitMap = new Map<string, Array<{ item: any; daysDiff: number }>>();

    for (const item of filteredFeatures) {
      // Use sat:relative_orbit as grouping key
      const relativeOrbit = item.properties['sat:relative_orbit'];
      if (!relativeOrbit) continue;

      const orbitId = String(relativeOrbit).padStart(3, '0');
      const itemDate = new Date(item.properties.datetime);
      const daysDiff = dateDiffDays(itemDate, targetDate);

      if (!orbitMap.has(orbitId)) {
        orbitMap.set(orbitId, []);
      }
      orbitMap.get(orbitId)!.push({ item, daysDiff });
    }

    // For each orbit, keep only top N candidates sorted by date proximity
    const allCandidateItems: any[] = [];
    for (const [orbitId, candidates] of orbitMap.entries()) {
      // Sort by date proximity
      candidates.sort((a, b) => a.daysDiff - b.daysDiff);

      // Take top candidates for this orbit
      const topCandidates = candidates.slice(0, maxCandidatesPerOrbit);
      topCandidates.forEach(c => allCandidateItems.push(c.item));
    }

    // Filter out scenes that don't actually intersect with AOI
    const beforeFilterCount = allCandidateItems.length;
    const intersectingItems = allCandidateItems.filter((item: any) => {
      const itemBbox: BBox = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };
      return bboxesIntersect(bbox, itemBbox);
    });

    if (intersectingItems.length < beforeFilterCount) {
      console.log(`Filtered ${beforeFilterCount} → ${intersectingItems.length} Sentinel-1 scenes (removed ${beforeFilterCount - intersectingItems.length} non-intersecting)`);
    }

    if (intersectingItems.length === 0) {
      console.log('No Sentinel-1 scenes found that intersect with AOI');
      return null;
    }

    // Check if any single scene fully contains the AOI
    const scenesContainingAOI = intersectingItems.filter((item: any) => {
      const itemBbox: BBox = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };
      return bboxContains(itemBbox, bbox);
    });

    let finalItems = intersectingItems;
    if (scenesContainingAOI.length > 0) {
      // At least one scene fully contains the AOI - no mosaic needed
      // Group by date and pick the best scene for each date
      const byDate = new Map<string, any[]>();
      scenesContainingAOI.forEach((item: any) => {
        const date = new Date(item.properties.datetime).toISOString().split('T')[0];
        if (!byDate.has(date)) {
          byDate.set(date, []);
        }
        byDate.get(date)!.push(item);
      });

      // For each date, pick the first scene (they're already sorted by proximity)
      finalItems = Array.from(byDate.values()).map(items => items[0]);

      if (scenesContainingAOI.length > finalItems.length) {
        console.log(`AOI fully contained by ${scenesContainingAOI.length} Sentinel-1 scenes - selected ${finalItems.length} best scenes (no mosaic needed)`);
      }
    }

    // Calculate date range for logging
    const dates = finalItems.map((item: any) => new Date(item.properties.datetime).toISOString().split('T')[0]);
    const uniqueDates = Array.from(new Set(dates)).sort();
    const dateRange = uniqueDates.length > 1
      ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`
      : uniqueDates[0];

    // Log scenes for diagnostic purposes
    const sceneDescriptions = finalItems.map((item: any) => {
      const relativeOrbit = item.properties['sat:relative_orbit'];
      const orbitId = String(relativeOrbit).padStart(3, '0');
      const date = new Date(item.properties.datetime).toISOString().split('T')[0];
      const orbitState = item.properties['sat:orbit_state'];
      const platform = item.properties.platform;
      return `Orbit ${orbitId} (${platform}, ${date}, ${orbitState})`;
    });
    console.log(`Selected ${finalItems.length} Sentinel-1 scenes from ${dateRange}:`, sceneDescriptions.join(', '));

    // Convert all items to STACItem format
    const stacItems: STACItem[] = [];

    for (const item of finalItems) {
      const relativeOrbit = item.properties['sat:relative_orbit'];
      const orbitId = `Orbit ${String(relativeOrbit).padStart(3, '0')}`;

      const itemId = item.id;
      const collectionId = 'sentinel-1-grd';

      const itemBounds = {
        west: item.bbox[0],
        south: item.bbox[1],
        east: item.bbox[2],
        north: item.bbox[3]
      };

      // Generate preview URL using PC Data API
      // Use available polarization assets for preview
      const availablePolarizations: string[] = [];
      if (item.assets?.vv) availablePolarizations.push('vv');
      if (item.assets?.vh) availablePolarizations.push('vh');
      if (item.assets?.hh) availablePolarizations.push('hh');
      if (item.assets?.hv) availablePolarizations.push('hv');

      // Build preview URL with PC Data API
      let previewUrl: string | undefined;
      if (availablePolarizations.length > 0) {
        const previewParams = new URLSearchParams();
        const pcItemUrl = `https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png`;
        previewParams.append('collection', collectionId);
        previewParams.append('item', itemId);
        
        // Use first available polarization for preview
        const previewPol = availablePolarizations[0];
        previewParams.append('assets', previewPol);
        previewParams.append('rescale', '0,5000');
        previewParams.append('colormap_name', 'gray');
        previewParams.append('width', '256');
        previewParams.append('height', '256');
        
        previewUrl = `${pcItemUrl}?${previewParams.toString()}`;
      }

      // Store rendering info with polarization assets
      const renderingInfo = {
        collection: collectionId,
        item: itemId,
        assets: availablePolarizations,
        acquisitionMode: item.properties['sar:instrument_mode'],
        polarization: polarization
      };

      stacItems.push({
        id: item.id,
        tileId: orbitId,
        datetime: item.properties.datetime,
        cloudCover: undefined, // SAR doesn't have cloud cover
        cogUrl: '', // Not used for Planetary Computer rendering
        stacItemUrl: '', // Not used for Planetary Computer rendering
        previewUrl: previewUrl,
        bounds: itemBounds,
        collection: 'sentinel-1-grd',
        properties: { ...item.properties, renderingInfo }
      });
    }

    return stacItems.length > 0 ? stacItems : null;
  } catch (error) {
    console.error('Error searching Sentinel-1 mosaic:', error);
    throw error;
  }
}

/**
 * Search Landsat imagery from Microsoft Planetary Computer (single scene)
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
      console.log(`No Landsat scenes found in STAC API response for ${targetDate.toISOString().split('T')[0]} (search window: ±${searchWindowDays} days, cloud cover ≤${maxCloudCover}%)`);
      return null;
    }

    console.log(`Found ${data.features.length} Landsat scenes in time range before AOI filtering`);

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
  sensor: 'sentinel-1' | 'sentinel-2' | 'landsat-8-9' | 'landsat-7' | 'landsat-4-5',
  bbox: BBox,
  targetDate: Date,
  maxCloudCover: number = 20
): Promise<STACItem | null> {
  switch (sensor) {
    case 'sentinel-2':
      return searchSentinel2(bbox, targetDate, maxCloudCover);
    case 'landsat-8-9':
      return searchLandsat(bbox, targetDate, maxCloudCover, 30, ['landsat-9', 'landsat-8']);
    case 'landsat-7':
      return searchLandsat(bbox, targetDate, maxCloudCover, 45, ['landsat-7']); // Wider window due to scan line gaps
    case 'landsat-4-5':
      return searchLandsat(bbox, targetDate, maxCloudCover, 60, ['landsat-5', 'landsat-4']); // Wider window for historical data
    case 'sentinel-1':
      return getSentinel1WMS(bbox, targetDate);
    default:
      throw new Error(`Unknown sensor type: ${sensor}`);
  }
}

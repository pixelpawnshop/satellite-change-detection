import { STACItem, BBox } from '../types';

const EARTH_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';
const COPERNICUS_STAC_URL = 'https://catalogue.dataspace.copernicus.eu/stac';

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
 * Search Sentinel-2 imagery and return ALL scenes from the best date (for mosaicking)
 */
export async function searchSentinel2Mosaic(
  bbox: BBox,
  targetDate: Date,
  maxCloudCover: number,
  searchWindowDays: number = 30
): Promise<STACItem[] | null> {
  const startDate = formatDateForSTAC(targetDate, -searchWindowDays);
  const endDate = formatDateForSTAC(targetDate, searchWindowDays);

  // Add 0.2 degree (~20km) buffer to catch all tiles that might cover the AOI
  // This ensures we find tiles even if the drawn polygon doesn't perfectly intersect
  const searchBody = {
    collections: ['sentinel-2-l2a'],
    intersects: bboxToGeometry(bbox, 0.2),
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    query: {
      'eo:cloud_cover': {
        lte: maxCloudCover
      }
    },
    limit: 100,  // Increased to get more potential mosaic tiles
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

    // Find the closest date
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
    
    // Get the date of the closest item (ignore time - group by date only)
    const closestDateStr = new Date(closestItem.properties.datetime).toISOString().split('T')[0];
    const closestDate = new Date(closestDateStr);
    
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
        .map(([date, tiles]) => `${date}: ${tiles.join(', ')}`)
        .join(' | ')
    );
    
    // Smart mosaic: For each tile ID (spatial location), pick only the closest scene to target date
    // This ensures minimum scenes loaded while covering the full AOI
    const tileMap = new Map<string, any>();
    
    for (const item of data.features) {
      const tileId = item.id.split('_').slice(1, 2).join('_'); // Extract tile ID like "29SPS"
      const itemDate = new Date(item.properties.datetime);
      const daysDiff = dateDiffDays(itemDate, targetDate);
      
      // Keep this tile only if it's the closest we've seen for this tile ID
      if (!tileMap.has(tileId)) {
        tileMap.set(tileId, { item, daysDiff });
      } else {
        const existing = tileMap.get(tileId)!;
        if (daysDiff < existing.daysDiff) {
          tileMap.set(tileId, { item, daysDiff });
        }
      }
    }
    
    // Extract the selected items
    const sameDateItems = Array.from(tileMap.values()).map(v => v.item);

    // Calculate date range for logging
    const dates = sameDateItems.map((item: any) => new Date(item.properties.datetime).toISOString().split('T')[0]);
    const uniqueDates = Array.from(new Set(dates)).sort();
    const dateRange = uniqueDates.length > 1 
      ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`
      : uniqueDates[0];

    // Log tiles for diagnostic purposes
    const tiles = sameDateItems.map((item: any) => {
      const tileId = item.id.split('_').slice(1, 2).join('_'); // Extract tile ID like "29SPS"
      const date = new Date(item.properties.datetime).toISOString().split('T')[0];
      const cloudCover = Math.round(item.properties['eo:cloud_cover']);
      return `${tileId} (${date}, ${cloudCover}% cloud)`;
    });
    console.log(`Selected ${sameDateItems.length} scenes (1 per tile) from ${dateRange}:`, tiles.join(', '));


    // Convert all items to STACItem format
    const stacItems: STACItem[] = [];
    
    for (const item of sameDateItems) {
      const selfLink = item.links?.find((link: any) => link.rel === 'self');
      const stacItemUrl = selfLink?.href || `${EARTH_SEARCH_URL.replace('/search', '')}/collections/sentinel-2-l2a/items/${item.id}`;
      
      const visualAsset = item.assets?.visual;
      if (!visualAsset) {
        console.warn(`Skipping ${item.id} - no visual asset`);
        continue;
      }

      stacItems.push({
        id: item.id,
        datetime: item.properties.datetime,
        cloudCover: item.properties['eo:cloud_cover'],
        cogUrl: visualAsset.href,
        stacItemUrl: stacItemUrl,
        bounds: {
          west: item.bbox[0],
          south: item.bbox[1],
          east: item.bbox[2],
          north: item.bbox[3]
        },
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

    // Find the closest image to target date
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
 * Search Landsat imagery from AWS Earth Search
 */
export async function searchLandsat(
  bbox: BBox,
  targetDate: Date,
  maxCloudCover: number,
  searchWindowDays: number = 30
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
        in: ['landsat-8', 'landsat-9']
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

    // Find the closest image to target date
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

    // Extract STAC item URL and rendered COG URL for Landsat
    console.log('Available Landsat assets:', Object.keys(closestItem.assets || {}));
    
    // Get self link for TiTiler STAC endpoint
    const selfLink = closestItem.links?.find((link: any) => link.rel === 'self');
    const stacItemUrl = selfLink?.href || `${EARTH_SEARCH_URL.replace('/search', '')}/collections/landsat-c2-l2/items/${closestItem.id}`;
    
    // Get rendered/visual asset for Landsat
    const renderedAsset = 
      closestItem.assets?.rendered_preview ||
      closestItem.assets?.visual;
    
    if (!renderedAsset) {
      console.error('No rendered asset found for Landsat');
      console.warn('Available assets:', closestItem.assets);
      return null;
    }

    console.log('Using Landsat STAC item:', stacItemUrl);
    console.log('Landsat COG URL:', renderedAsset.href);

    return {
      id: closestItem.id,
      datetime: closestItem.properties.datetime,
      cloudCover: closestItem.properties['eo:cloud_cover'],
      cogUrl: renderedAsset.href,
      stacItemUrl: stacItemUrl,
      bounds: {
        west: closestItem.bbox[0],
        south: closestItem.bbox[1],
        east: closestItem.bbox[2],
        north: closestItem.bbox[3]
      },
      collection: 'landsat-c2-l2',
      properties: closestItem.properties
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

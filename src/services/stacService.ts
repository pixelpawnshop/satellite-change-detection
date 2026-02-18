import { STACItem, BBox } from '../types';

const EARTH_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';
const COPERNICUS_STAC_URL = 'https://catalogue.dataspace.copernicus.eu/stac';

/**
 * Convert BBox to GeoJSON polygon for STAC queries
 */
function bboxToGeometry(bbox: BBox) {
  return {
    type: 'Polygon',
    coordinates: [[
      [bbox.west, bbox.south],
      [bbox.east, bbox.south],
      [bbox.east, bbox.north],
      [bbox.west, bbox.north],
      [bbox.west, bbox.south]
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
 * Search Sentinel-2 imagery from AWS Earth Search
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

    // Extract preview/thumbnail URL (browser-displayable JPEG/PNG)
    // IMPORTANT: COG files are GeoTIFFs which browsers cannot display directly
    // We need to use thumbnail/preview assets which are JPEGs
    console.log('Available assets:', Object.keys(closestItem.assets || {}));
    
    // First try to get a browser-displayable thumbnail/preview
    const thumbnailLink = closestItem.links?.find((link: any) => 
      link.rel === 'thumbnail' || link.rel === 'preview'
    );
    
    // Check for thumbnail asset or use thumbnail link
    const previewAsset = 
      closestItem.assets?.thumbnail ||
      closestItem.assets?.preview ||
      closestItem.assets?.rendered_preview ||
      (thumbnailLink ? { href: thumbnailLink.href } : null);
    
    if (!previewAsset) {
      console.error('No browser-displayable preview/thumbnail found');
      console.warn('Available assets:', closestItem.assets);
      return null;
    }

    console.log('Using preview/thumbnail:', previewAsset.href);

    return {
      id: closestItem.id,
      datetime: closestItem.properties.datetime,
      cloudCover: closestItem.properties['eo:cloud_cover'],
      cogUrl: previewAsset.href,
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

    // Extract preview/thumbnail URL (browser-displayable JPEG/PNG)
    console.log('Available Landsat assets:', Object.keys(closestItem.assets || {}));
    
    // First try to get a browser-displayable thumbnail/preview
    const thumbnailLink = closestItem.links?.find((link: any) => 
      link.rel === 'thumbnail' || link.rel === 'preview'
    );
    
    // Check for thumbnail asset or use thumbnail link
    const previewAsset = 
      closestItem.assets?.thumbnail ||
      closestItem.assets?.preview ||
      closestItem.assets?.rendered_preview ||
      (thumbnailLink ? { href: thumbnailLink.href } : null);
    
    if (!previewAsset) {
      console.error('No browser-displayable preview/thumbnail found for Landsat');
      console.warn('Available assets:', closestItem.assets);
      return null;
    }

    console.log('Using Landsat preview/thumbnail:', previewAsset.href);

    return {
      id: closestItem.id,
      datetime: closestItem.properties.datetime,
      cloudCover: closestItem.properties['eo:cloud_cover'],
      cogUrl: previewAsset.href,
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

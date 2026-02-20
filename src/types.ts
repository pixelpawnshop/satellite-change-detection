import { GeoJSON } from 'geojson';

export type SensorType = 'sentinel-1' | 'sentinel-2' | 'landsat-8-9' | 'landsat-7' | 'landsat-4-5';

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface STACItem {
  id: string;
  datetime: string;
  cloudCover?: number;
  cogUrl?: string;
  wmsUrl?: string;
  stacItemUrl?: string;  // Full STAC item URL for TiTiler
  previewUrl?: string;  // Thumbnail preview URL
  bounds: BBox;
  collection: string;
  properties: Record<string, any>;
  tileId?: string;  // Sentinel-2 tile ID (e.g., "20QKF")
}

export interface SceneCandidates {
  tileId: string;
  candidates: STACItem[];  // Sorted by date proximity
  selected?: STACItem;  // User's selection (or auto-selected)
}

export interface ImagePair {
  before: STACItem;
  after: STACItem;
}

export interface SearchParams {
  sensor: SensorType;
  aoi: BBox;
  beforeDate: Date;
  afterDate: Date;
  maxCloudCover: number;
  clipToAOI: boolean;
}

export interface AOIGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

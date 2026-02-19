import { GeoJSON } from 'geojson';

export type SensorType = 'sentinel-1' | 'sentinel-2' | 'landsat';

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
  bounds: BBox;
  collection: string;
  properties: Record<string, any>;
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

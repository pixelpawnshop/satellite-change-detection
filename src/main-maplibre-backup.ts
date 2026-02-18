import maplibregl from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { bbox } from '@turf/bbox';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

import './styles.css';
import { ControlPanel } from './components/controlPanel';
import { MetadataPanel } from './components/metadataPanel';
import { SplitScreenControl } from './map/splitScreenControl';
import { LayerManager } from './map/layerManager';
import { searchImagery } from './services/stacService';
import type { BBox, STACItem, SearchParams } from './types';

class SatelliteComparisonApp {
  private map: maplibregl.Map;
  private controlPanel: ControlPanel;
  private metadataPanel: MetadataPanel;
  private splitControl: SplitScreenControl | null = null;
  private layerManager: LayerManager;
  private currentAOI: BBox | null = null;
  private loadingOverlay: HTMLElement;
  private draw?: MapboxDraw;

  constructor() {
    // Initialize map
    this.map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19
          }
        ]
      },
      center: [0, 20],
      zoom: 2
    });

    // Add navigation controls
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    // Initialize components
    this.controlPanel = new ControlPanel();
    this.metadataPanel = new MetadataPanel();
    this.layerManager = new LayerManager(this.map);
    this.loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;

    // Setup event handlers
    this.setupEventHandlers();

    // Initialize drawing tools after map loads
    this.map.on('load', () => {
      this.initializeDrawingTools();
    });
  }

  private setupEventHandlers(): void {
    // Search button click
    this.controlPanel.onSearchClick(async (params) => {
      if (!this.currentAOI) {
        this.controlPanel.showError('Please draw an area of interest on the map first');
        return;
      }
      await this.handleSearch({ ...params, aoi: this.currentAOI });
    });

    // Clear AOI button click
    this.controlPanel.onClearAOIClick(() => {
      this.clearAOI();
    });
  }

  private initializeDrawingTools(): void {
    // Initialize MapboxDraw
    this.draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true
      },
      defaultMode: 'simple_select',
      styles: [
        // Customize drawing styles
        {
          'id': 'gl-draw-polygon-fill',
          'type': 'fill',
          'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          'paint': {
            'fill-color': '#4a9eff',
            'fill-outline-color': '#4a9eff',
            'fill-opacity': 0.1
          }
        },
        {
          'id': 'gl-draw-polygon-stroke-active',
          'type': 'line',
          'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          'paint': {
            'line-color': '#4a9eff',
            'line-width': 2
          }
        },
        {
          'id': 'gl-draw-line-active',
          'type': 'line',
          'filter': ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
          'paint': {
            'line-color': '#4a9eff',
            'line-width': 2
          }
        },
        {
          'id': 'gl-draw-polygon-and-line-vertex-active',
          'type': 'circle',
          'filter': ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
          'paint': {
            'circle-radius': 5,
            'circle-color': '#FFF'
          }
        }
      ]
    });

    this.map.addControl(this.draw as any, 'top-left');

    // Listen for drawn shapes
    this.map.on('draw.create', (e: any) => {
      const feature = e.features[0];
      this.handleAOIDrawn(feature);
    });

    // Listen for shape updates
    this.map.on('draw.update', (e: any) => {
      const feature = e.features[0];
      this.handleAOIDrawn(feature);
    });

    // Listen for deletions
    this.map.on('draw.delete', () => {
      this.clearAOI();
    });
  }

  private handleAOIDrawn(feature: Feature<Polygon | MultiPolygon>): void {
    // Calculate bounding box
    const bounds = bbox(feature);
    this.currentAOI = {
      west: bounds[0],
      south: bounds[1],
      east: bounds[2],
      north: bounds[3]
    };

    // Enable search and clear buttons
    this.controlPanel.setSearchEnabled(true);
    this.controlPanel.setClearAOIEnabled(true);
    this.controlPanel.showInfo('Area of interest selected. Click "Search Images" to find imagery.');
  }

  private clearAOI(): void {
    this.currentAOI = null;

    // Remove all drawn features
    if (this.draw) {
      this.draw.deleteAll();
    }

    // Disable buttons
    this.controlPanel.setSearchEnabled(false);
    this.controlPanel.setClearAOIEnabled(false);
    this.controlPanel.hideStatus();
    this.controlPanel.hideResults();

    // Remove split control if present
    if (this.splitControl) {
      this.splitControl.remove();
      this.splitControl = null;
    }

    // Remove image layers
    this.layerManager.removeLayers();
    this.metadataPanel.hide();
  }

  private async handleSearch(params: SearchParams): Promise<void> {
    try {
      this.showLoading(true);
      this.controlPanel.showInfo('Searching for imagery...');

      // Search for before and after images
      const [beforeItem, afterItem] = await Promise.all([
        searchImagery(params.sensor, params.aoi, params.beforeDate, params.maxCloudCover),
        searchImagery(params.sensor, params.aoi, params.afterDate, params.maxCloudCover)
      ]);

      if (!beforeItem) {
        throw new Error(`No imagery found for before date (${params.beforeDate.toDateString()}). Try expanding the date range.`);
      }

      if (!afterItem) {
        throw new Error(`No imagery found for after date (${params.afterDate.toDateString()}). Try expanding the date range.`);
      }

      // Load images onto map
      await this.loadImagePair(beforeItem, afterItem, params.sensor);

      // Show results
      this.controlPanel.showSuccess('Images loaded successfully!');
      this.controlPanel.showResults(
        beforeItem.datetime,
        afterItem.datetime,
        beforeItem.id,
        afterItem.id
      );

      // Show metadata
      this.metadataPanel.show(beforeItem, afterItem);

    } catch (error) {
      console.error('Search error:', error);
      this.controlPanel.showError(
        error instanceof Error ? error.message : 'Failed to search for imagery'
      );
    } finally {
      this.showLoading(false);
    }
  }

  private async loadImagePair(
    beforeItem: STACItem,
    afterItem: STACItem,
    sensor: string
  ): Promise<void> {
    // Remove existing layers
    this.layerManager.removeLayers();

    // Load appropriate layer type
    if (sensor === 'sentinel-1') {
      await this.layerManager.loadWMSPair(beforeItem, afterItem);
    } else {
      await this.layerManager.loadCOGPair(beforeItem, afterItem);
    }

    // Add split screen control
    if (this.splitControl) {
      this.splitControl.remove();
    }

    this.splitControl = new SplitScreenControl(this.map, (position) => {
      this.layerManager.updateSplitPosition(position);
    });

    this.splitControl.add();
  }

  private showLoading(show: boolean): void {
    this.loadingOverlay.style.display = show ? 'flex' : 'none';
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new SatelliteComparisonApp();
});

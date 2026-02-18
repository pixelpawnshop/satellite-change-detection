import L from 'leaflet';
import 'leaflet-draw';
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
  private map: L.Map;
  private controlPanel: ControlPanel;
  private metadataPanel: MetadataPanel;
  private splitControl: SplitScreenControl | null = null;
  private layerManager: LayerManager;
  private currentAOI: BBox | null = null;
  private loadingOverlay: HTMLElement;
  private drawnItems: L.FeatureGroup;
  private drawControl: L.Control.Draw;

  constructor() {
    // Initialize Leaflet map
    this.map = L.map('map', {
      center: [20, 0],
      zoom: 2,
      zoomControl: false
    });

    // Add OpenStreetMap base layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(this.map);

    // Add zoom control to top-right
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Initialize drawn items layer
    this.drawnItems = new L.FeatureGroup();
    this.map.addLayer(this.drawnItems);

    // Initialize draw control
    this.drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: false,
          drawError: {
            color: '#e1e100',
            message: '<strong>Error:</strong> shape edges cannot cross!'
          },
          shapeOptions: {
            color: '#4a9eff',
            fillOpacity: 0.1,
            weight: 2
          },
          metric: true,
          feet: false,
          nautic: false
        },
        rectangle: {
          showArea: false,
          shapeOptions: {
            color: '#4a9eff',
            fillOpacity: 0.1,
            weight: 2
          },
          metric: true
        },
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false
      },
      edit: {
        featureGroup: this.drawnItems,
        remove: true
      }
    });
    this.map.addControl(this.drawControl);

    // Initialize components
    this.controlPanel = new ControlPanel();
    this.metadataPanel = new MetadataPanel();
    this.layerManager = new LayerManager(this.map);
    this.loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;

    // Setup event handlers
    this.setupEventHandlers();
    this.setupDrawHandlers();
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

  private setupDrawHandlers(): void {
    // When a shape is created
    this.map.on(L.Draw.Event.CREATED, (e: any) => {
      const layer = e.layer;
      
      // Clear previous drawings
      this.drawnItems.clearLayers();
      
      // Add new drawing
      this.drawnItems.addLayer(layer);
      
      // Get GeoJSON feature
      const feature = layer.toGeoJSON() as Feature<Polygon | MultiPolygon>;
      this.handleAOIDrawn(feature);
    });

    // When a shape is edited
    this.map.on(L.Draw.Event.EDITED, (e: any) => {
      const layers = e.layers;
      layers.eachLayer((layer: any) => {
        const feature = layer.toGeoJSON() as Feature<Polygon | MultiPolygon>;
        this.handleAOIDrawn(feature);
      });
    });

    // When shapes are deleted
    this.map.on(L.Draw.Event.DELETED, () => {
      if (this.drawnItems.getLayers().length === 0) {
        this.clearAOI();
      }
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
    this.drawnItems.clearLayers();

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

    // Fit map to imagery bounds
    const bounds = L.latLngBounds(
      [beforeItem.bounds.south, beforeItem.bounds.west],
      [beforeItem.bounds.north, beforeItem.bounds.east]
    );
    this.map.fitBounds(bounds, { padding: [20, 20] });

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

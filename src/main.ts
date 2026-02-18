import L from 'leaflet';
import 'leaflet-draw';
import { bbox } from '@turf/bbox';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

import './styles.css';
import { ControlPanel } from './components/controlPanel';
import { MetadataPanel } from './components/metadataPanel';
import { LayerPanel } from './components/layerPanel';
import type { LayerItem } from './components/layerPanel';
import { LayerManager } from './map/layerManager';
import { searchImagery } from './services/stacService';
import type { BBox, STACItem, SearchParams } from './types';

class SatelliteComparisonApp {
  private map: L.Map;
  private controlPanel: ControlPanel;
  private metadataPanel: MetadataPanel;
  private layerPanel: LayerPanel;
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

    // Initialize layer panel with callbacks
    this.layerPanel = new LayerPanel('layer-panel', {
      onLayerChange: (layers) => this.handleLayerChange(layers),
      onLayerVisibilityChange: (layerId, visible) => this.handleLayerVisibilityChange(layerId, visible),
      onLayerOpacityChange: (layerId, opacity) => this.handleLayerOpacityChange(layerId, opacity),
      onLayerOrderChange: (layers) => this.handleLayerOrderChange(layers)
    });

    // Setup event handlers
    this.setupEventHandlers();
    this.setupDrawHandlers();
    this.setupSidebarResize();
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

  private setupSidebarResize(): void {
    const sidebar = document.getElementById('sidebar');
    const resizeHandle = document.querySelector('.sidebar-resize-handle') as HTMLElement;
    const app = document.getElementById('app') as HTMLElement;
    
    if (!sidebar || !resizeHandle || !app) return;
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizeHandle.classList.add('resizing');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const delta = e.clientX - startX;
      const newWidth = Math.max(280, Math.min(600, startWidth + delta));
      
      app.style.setProperty('--sidebar-width', `${newWidth}px`);
      
      // Invalidate map size to trigger repaint
      this.map.invalidateSize();
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
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
  }

  private async handleSearch(params: SearchParams): Promise<void> {
    try {
      this.showLoading(true);
      this.controlPanel.showInfo('Searching for imagery...');

      // For Sentinel-2, search for all scenes from best date (mosaicking)
      // For other sensors, use single scene
      let beforeItems: STACItem[];
      let afterItems: STACItem[];
      
      if (params.sensor === 'sentinel-2') {
        const { searchSentinel2Mosaic } = await import('./services/stacService');
        const [beforeMosaic, afterMosaic] = await Promise.all([
          searchSentinel2Mosaic(params.aoi, params.beforeDate, params.maxCloudCover),
          searchSentinel2Mosaic(params.aoi, params.afterDate, params.maxCloudCover)
        ]);
        
        if (!beforeMosaic || beforeMosaic.length === 0) {
          throw new Error(`No imagery found for before date (${params.beforeDate.toDateString()}). Try expanding the date range.`);
        }
        if (!afterMosaic || afterMosaic.length === 0) {
          throw new Error(`No imagery found for after date (${params.afterDate.toDateString()}). Try expanding the date range.`);
        }
        
        beforeItems = beforeMosaic;
        afterItems = afterMosaic;
      } else {
        // Single scene for Landsat/Sentinel-1
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
        
        beforeItems = [beforeItem];
        afterItems = [afterItem];
      }

      // Calculate date ranges for display
      const getDateRange = (items: STACItem[]): string => {
        const dates = items.map(item => new Date(item.datetime).toISOString().split('T')[0]);
        const uniqueDates = Array.from(new Set(dates)).sort();
        if (uniqueDates.length > 1) {
          const start = new Date(uniqueDates[0]);
          const end = new Date(uniqueDates[uniqueDates.length - 1]);
          return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        }
        return new Date(uniqueDates[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      };

      const beforeDateRange = getDateRange(beforeItems);
      const afterDateRange = getDateRange(afterItems);

      // For Sentinel-2 with multiple scenes, add as grouped layers
      // Note: True MosaicJSON server-side merging requires hosted MosaicJSON files,
      // which this TiTiler instance doesn't support via inline data URIs.
      // Using UI layer grouping (Option B) instead.
      if (params.sensor === 'sentinel-2') {
        // Add all before scenes as layers (grouped under "Before")
        for (let i = 0; i < beforeItems.length; i++) {
          const layerName = beforeItems.length > 1 
            ? `Scene ${i + 1}/${beforeItems.length}` 
            : `${beforeDateRange}`;
          await this.addImageAsLayer(beforeItems[i], layerName, 'Before');
        }

        // Add all after scenes as layers (grouped under "After")
        for (let i = 0; i < afterItems.length; i++) {
          const layerName = afterItems.length > 1 
            ? `Scene ${i + 1}/${afterItems.length}` 
            : `${afterDateRange}`;
          await this.addImageAsLayer(afterItems[i], layerName, 'After');
        }
      }
      // For other sensors (Landsat, Sentinel-1), use single scene layers
      else {
        await this.addImageAsLayer(beforeItems[0], `Before (${beforeDateRange})`);
        await this.addImageAsLayer(afterItems[0], `After (${afterDateRange})`);
      }

      // Ensure proper layer stacking after all layers are added
      const allLayers = this.layerPanel.getLayers();
      this.layerManager.updateLayerOrder(allLayers);

      // Show results
      const totalScenes = beforeItems.length + afterItems.length;
      this.controlPanel.showSuccess(
        totalScenes > 2 
          ? `Loaded ${beforeItems.length} before + ${afterItems.length} after scenes (mosaic)` 
          : 'Images loaded successfully!'
      );
      this.controlPanel.showResults(
        beforeItems[0].datetime,
        afterItems[0].datetime,
        beforeItems.length > 1 ? `${beforeItems.length} scenes` : beforeItems[0].id,
        afterItems.length > 1 ? `${afterItems.length} scenes` : afterItems[0].id
      );

      // Show metadata for first scene of each
      this.metadataPanel.show(beforeItems[0], afterItems[0]);

    } catch (error) {
      console.error('Search error:', error);
      this.controlPanel.showError(
        error instanceof Error ? error.message : 'Failed to search for imagery'
      );
    } finally {
      this.showLoading(false);
    }
  }

  private async addMosaicAsLayer(items: STACItem[], name: string, mosaicJSON?: any): Promise<void> {
    let layerId: string | null = null;
    try {
      console.log(`Starting to add mosaic layer: ${name} with ${items.length} scenes`);
      
      // Add layer to layer panel first (generates unique ID)
      // Use first item as representative for metadata
      this.layerPanel.addLayer(items[0], name);
      
      // Get the most recently added layer (now at index 0 since we use unshift)
      const layers = this.layerPanel.getLayers();
      const newLayer = layers[0];
      layerId = newLayer.id;
      
      // Add mosaic to map (combines multiple scenes into one layer)
      if (items.length > 1) {
        await this.layerManager.addMosaicLayer(newLayer.id, items, name, newLayer.opacity / 100, mosaicJSON);
      } else {
        await this.layerManager.addLayer(newLayer.id, items[0], newLayer.opacity / 100);
      }
      
      // Mark as loaded
      this.layerPanel.setLayerLoading(newLayer.id, false);
      
      console.log(`Successfully added mosaic layer: ${name}`);
    } catch (error) {
      console.error(`Failed to add mosaic layer ${name}:`, error);
      // Remove failed layer from panel
      if (layerId) {
        this.layerPanel.removeLayer(layerId);
      }
      throw error;
    }
  }

  private async addImageAsLayer(item: STACItem, name: string, group?: string): Promise<void> {
    let layerId: string | null = null;
    try {
      console.log(`Starting to add layer: ${name}${group ? ` (group: ${group})` : ''}`);
      
      // Add layer to layer panel first (generates unique ID)
      this.layerPanel.addLayer(item, name, group);
      
      // Get the most recently added layer (now at index 0 since we use unshift)
      const layers = this.layerPanel.getLayers();
      const newLayer = layers[0];
      layerId = newLayer.id;
      
      // Add to map (this may take time for large images)
      await this.layerManager.addLayer(newLayer.id, item, newLayer.opacity / 100);
      
      // Mark as loaded
      this.layerPanel.setLayerLoading(newLayer.id, false);
      
      console.log(`Successfully added layer: ${name}`);
    } catch (error) {
      console.error(`Failed to add layer ${name}:`, error);
      // Remove failed layer from panel
      if (layerId) {
        this.layerPanel.removeLayer(layerId);
      }
      throw error;
    }
  }

  private handleLayerChange(layers: LayerItem[]): void {
    // When layers are cleared, remove all from map
    if (layers.length === 0) {
      this.layerManager.removeLayers();
      this.metadataPanel.hide();
    }
  }

  private handleLayerVisibilityChange(layerId: string, visible: boolean): void {
    this.layerManager.setLayerVisibility(layerId, visible);
  }

  private handleLayerOpacityChange(layerId: string, opacity: number): void {
    this.layerManager.setLayerOpacity(layerId, opacity);
  }

  private handleLayerOrderChange(layers: LayerItem[]): void {
    this.layerManager.updateLayerOrder(layers);
  }

  private showLoading(show: boolean): void {
    this.loadingOverlay.style.display = show ? 'flex' : 'none';
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new SatelliteComparisonApp();
});

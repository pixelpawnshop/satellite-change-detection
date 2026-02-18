import L from 'leaflet';
import type { STACItem, BBox } from '../types';
import type { LayerItem } from '../components/layerPanel';
import type { MosaicJSON } from '../services/mosaicService';

// Get TiTiler URL from environment variable
const TITILER_URL = import.meta.env.VITE_TITILER_URL || 'https://titiler-1039034665364.europe-west1.run.app';

interface ManagedLayer {
  id: string;
  leafletLayer: L.Layer;
  item: STACItem;
  opacity: number;
  visible: boolean;
  zIndex: number;
}

export class LayerManager {
  private map: L.Map;
  private layers: Map<string, ManagedLayer> = new Map();
  private loadingLayers: Set<string> = new Set(); // Track layers currently loading

  constructor(map: L.Map) {
    this.map = map;
  }

  /**
   * Add a mosaic layer combining multiple scenes into a single tile layer
   */
  async addMosaicLayer(
    layerId: string, 
    items: STACItem[], 
    name: string, 
    opacity: number = 1, 
    mosaicJSON?: MosaicJSON
  ): Promise<void> {
    console.log(`Adding mosaic layer: ${layerId} with ${items.length} scenes`);
    
    if (items.length === 0) {
      throw new Error('Cannot create mosaic layer with no items');
    }
    
    // If only one item, use regular layer
    if (items.length === 1) {
      return this.addLayer(layerId, items[0], opacity);
    }
    
    // Create mosaic layer - prefer MosaicJSON if provided
    const leafletLayer = mosaicJSON 
      ? this.createMosaicJSONTileLayer(mosaicJSON, items)
      : this.createTiTilerMosaicLayer(items);
    
    // Use the first item for metadata/bounds
    const representativeItem = items[0];
    
    // Calculate combined bounds from all items
    const combinedBounds = this.calculateCombinedBounds(items);
    
    const highestZIndex = Math.max(0, ...Array.from(this.layers.values()).map(l => l.zIndex));
    
    const managedLayer: ManagedLayer = {
      id: layerId,
      leafletLayer,
      item: { ...representativeItem, bounds: combinedBounds }, // Use combined bounds
      opacity,
      visible: true,
      zIndex: highestZIndex + 1
    };
    
    this.layers.set(layerId, managedLayer);
    leafletLayer.addTo(this.map);
    
    this.refreshLayerOrder();
    
    console.log(`Mosaic layer ${layerId} added successfully with z-index ${managedLayer.zIndex}`);
    
    // Fit bounds to show the new layer (only for first layer)
    if (this.layers.size === 1) {
      const bounds = L.latLngBounds(
        [combinedBounds.south, combinedBounds.west],
        [combinedBounds.north, combinedBounds.east]
      );
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  /**
   * Add a new layer to the map
   */
  async addLayer(layerId: string, item: STACItem, opacity: number = 1): Promise<void> {
    console.log('Adding layer:', layerId);
    console.log('STAC item URL:', item.stacItemUrl);
    console.log('COG URL:', item.cogUrl);
    
    let leafletLayer: L.Layer;
    
    // Use TiTiler for Sentinel-2 and Landsat (they have STAC item URLs)
    if (item.stacItemUrl && (item.collection === 'sentinel-2-l2a' || item.collection === 'landsat-c2-l2')) {
      console.log('Using TiTiler for high-res tiles');
      leafletLayer = this.createTiTilerLayer(item);
    }
    // Use WMS for Sentinel-1
    else if (item.wmsUrl) {
      console.log('Using WMS for Sentinel-1');
      leafletLayer = this.createImageOverlay(item.wmsUrl, item.bounds);
    }
    // Fallback to image overlay for legacy or unknown items
    else if (item.cogUrl) {
      console.log('Fallback to image overlay');
      leafletLayer = this.createImageOverlay(item.cogUrl, item.bounds);
    }
    else {
      throw new Error('No valid image source found for layer');
    }
    
    // New layers get highest z-index (on top)
    const highestZIndex = Math.max(0, ...Array.from(this.layers.values()).map(l => l.zIndex));
    
    const managedLayer: ManagedLayer = {
      id: layerId,
      leafletLayer,
      item,
      opacity,
      visible: true,
      zIndex: highestZIndex + 1
    };
    
    this.layers.set(layerId, managedLayer);
    leafletLayer.addTo(this.map);
    
    // Refresh layer order to ensure proper stacking
    this.refreshLayerOrder();
    
    console.log(`Layer ${layerId} added successfully with z-index ${managedLayer.zIndex}`);
    
    // Fit bounds to show the new layer (only for first layer)
    if (this.layers.size === 1) {
      const bounds = L.latLngBounds(
        [item.bounds.south, item.bounds.west],
        [item.bounds.north, item.bounds.east]
      );
      this.map.fitBounds(bounds);
    }
  }

  /**
   * Calculate combined bounds from multiple items
   */
  private calculateCombinedBounds(items: STACItem[]): BBox {
    let minWest = items[0].bounds.west;
    let maxEast = items[0].bounds.east;
    let minSouth = items[0].bounds.south;
    let maxNorth = items[0].bounds.north;
    
    for (const item of items) {
      minWest = Math.min(minWest, item.bounds.west);
      maxEast = Math.max(maxEast, item.bounds.east);
      minSouth = Math.min(minSouth, item.bounds.south);
      maxNorth = Math.max(maxNorth, item.bounds.north);
    }
    
    return { west: minWest, east: maxEast, south: minSouth, north: maxNorth };
  }

  /**
   * Create a TiTiler tile layer using MosaicJSON for true server-side mosaicking
   */
  private createMosaicJSONTileLayer(mosaicJSON: MosaicJSON, items: STACItem[]): L.TileLayer {
    // TiTiler's /mosaicjson endpoint has limitations with inline data URIs
    // Instead, we'll use a workaround: Create a virtual mosaic endpoint URL
    // that we'll handle by falling back to the multi-URL approach
    
    const mosaicStr = JSON.stringify(mosaicJSON);
    
    console.log(`MosaicJSON tile layer: ${items.length} scenes, ${Object.keys(mosaicJSON.tiles).length} quadkeys`);
    console.log(`MosaicJSON size: ${(mosaicStr.length / 1024).toFixed(1)} KB`);
    console.warn('Note: TiTiler /mosaicjson endpoint requires hosted MosaicJSON file, not inline data URIs.');
    console.warn('Falling back to multi-layer approach with UI grouping.');
    
    // Fallback to the multi-URL approach since inline MosaicJSON doesn't work
    return this.createTiTilerMosaicLayer(items);
  }

  /**
   * Create a TiTiler mosaic layer from multiple COGs (fallback - multi-url approach)
   * NOTE: This may not work on all TiTiler instances. Prefer MosaicJSON approach.
   */
  private createTiTilerMosaicLayer(items: STACItem[]): L.TileLayer {
    // Build URL with multiple url parameters for TiTiler mosaic
    const urlParams = items.map(item => `url=${encodeURIComponent(item.cogUrl!)}`).join('&');
    
    const maxNativeZoom = items[0].collection === 'landsat-c2-l2' ? 13 : 14;
    
    // TiTiler accepts multiple url parameters and will mosaic them
    // First scene in list gets priority for overlapping pixels
    const tileUrl = `${TITILER_URL}/cog/tiles/{z}/{x}/{y}.png?${urlParams}&resampling_method=nearest`;
    
    console.log(`TiTiler mosaic tile URL with ${items.length} COGs`);
    console.log('Scene order:', items.map(item => item.id).join(', '));
    console.log(`Max native zoom: ${maxNativeZoom} (sensor: ${items[0].collection})`);
    
    const combinedBounds = this.calculateCombinedBounds(items);
    const leafletBounds = L.latLngBounds(
      [combinedBounds.south, combinedBounds.west],
      [combinedBounds.north, combinedBounds.east]
    );
    
    return L.tileLayer(tileUrl, {
      tileSize: 256,
      opacity: 1,
      minZoom: 8,
      maxZoom: 16,
      maxNativeZoom: maxNativeZoom,
      bounds: leafletBounds,
      attribution: '© Copernicus Sentinel data',
      crossOrigin: true,
      keepBuffer: 2,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateInterval: 200,
      className: 'satellite-tiles',
      errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    });
  }

  /**
   * Create a TiTiler tile layer for high-resolution COG rendering
   */
  private createTiTilerLayer(item: STACItem): L.TileLayer {
    // Use direct COG URL for faster tile generation (faster than STAC endpoint)
    const encodedCogUrl = encodeURIComponent(item.cogUrl!);
    
    // Determine max native zoom based on sensor resolution
    // Sentinel-2: 10m resolution = zoom 14
    // Landsat: 30m resolution = zoom 13
    const maxNativeZoom = item.collection === 'landsat-c2-l2' ? 13 : 14;
    
    // Build TiTiler COG tile URL:
    // - .png format: Lossless quality with transparency for nodata pixels
    // - resampling_method=nearest: Fastest resampling, cache-friendly URLs
    // NOTE: Params order matters for caching! Keep consistent.
    const tileUrl = `${TITILER_URL}/cog/tiles/{z}/{x}/{y}.png?url=${encodedCogUrl}&resampling_method=nearest`;
    
    console.log('TiTiler optimized tile URL:', tileUrl);
    console.log(`Max native zoom: ${maxNativeZoom} (sensor: ${item.collection})`);
    
    // Calculate Leaflet bounds for tiles
    const leafletBounds = L.latLngBounds(
      [item.bounds.south, item.bounds.west],
      [item.bounds.north, item.bounds.east]
    );
    
    return L.tileLayer(tileUrl, {
      tileSize: 256,
      opacity: 1,
      minZoom: 8,              // Don't zoom out too far
      maxZoom: 16,             // Max display zoom (can scale tiles)
      maxNativeZoom: maxNativeZoom,  // Max zoom to request from server (13-14)
      bounds: leafletBounds,   // Only request tiles within scene bounds
      attribution: '© Copernicus Sentinel data',
      crossOrigin: true,
      keepBuffer: 2,           // Keep buffer tiles for smooth transitions
      updateWhenIdle: false,   // Update immediately for smooth opacity slider
      updateWhenZooming: false,  // Don't update during zoom animation
      updateInterval: 200,     // Throttle updates to 200ms
      className: 'satellite-tiles',  // For CSS styling
      // Error handling for tiles outside bounds
      errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    });
  }

  /**
   * Create an image overlay for WMS or fallback images
   */
  private createImageOverlay(url: string, bounds: any): L.ImageOverlay {
    const leafletBounds = L.latLngBounds(
      [bounds.south, bounds.west],
      [bounds.north, bounds.east]
    );
    
    return L.imageOverlay(url, leafletBounds, {
      opacity: 1,
      interactive: false,
      crossOrigin: true
    });
  }

  /**
   * Remove a layer from the map
   */
  removeLayer(layerId: string): void {
    const managedLayer = this.layers.get(layerId);
    if (managedLayer) {
      // Remove from map
      this.map.removeLayer(managedLayer.leafletLayer);
      
      // Clean up tile layer resources to free memory
      const tileLayer = managedLayer.leafletLayer as any;
      if (tileLayer._tiles) {
        // Clear tile cache
        Object.keys(tileLayer._tiles).forEach(key => {
          const tile = tileLayer._tiles[key];
          if (tile.el) {
            tile.el.src = '';  // Release image memory
          }
        });
      }
      
      this.layers.delete(layerId);
      this.loadingLayers.delete(layerId);
      console.log(`Layer ${layerId} removed and cleaned up`);
    }
  }
  
  /**
   * Cancel all pending tile requests (for performance when switching layers)
   */
  cancelPendingRequests(): void {
    console.log('Cancelling all pending tile requests...');
    
    this.layers.forEach((managedLayer) => {
      const tileLayer = managedLayer.leafletLayer as any;
      
      // For TileLayer, abort loading tiles
      if (tileLayer._tiles) {
        Object.keys(tileLayer._tiles).forEach(key => {
          const tile = tileLayer._tiles[key];
          if (tile.el && !tile.loaded) {
            // Cancel loading by clearing src
            tile.el.src = '';
          }
        });
      }
    });
    
    this.loadingLayers.clear();
    console.log('Pending requests cancelled');
  }
  
  /**
   * Clean up old layers to prevent memory issues (useful for time series)
   */
  clearOldLayers(keepLatest: number = 5): void {
    const layerArray = Array.from(this.layers.entries());
    
    if (layerArray.length > keepLatest) {
      console.log(`Cleaning up old layers (keeping ${keepLatest} latest)...`);
      
      // Sort by z-index (oldest have lowest z-index)
      const sorted = layerArray.sort((a, b) => a[1].zIndex - b[1].zIndex);
      
      // Remove oldest layers
      const toRemove = sorted.slice(0, sorted.length - keepLatest);
      toRemove.forEach(([id]) => {
        this.removeLayer(id);
      });
      
      console.log(`Removed ${toRemove.length} old layers`);
    }
  }

  /**
   * Set layer visibility
   */
  setLayerVisibility(layerId: string, visible: boolean): void {
    console.log(`LayerManager: Setting visibility for ${layerId} to ${visible}`);
    const managedLayer = this.layers.get(layerId);
    if (managedLayer) {
      managedLayer.visible = visible;
      
      // Directly add/remove this layer without affecting others (prevents flicker)
      if (visible) {
        if (!this.map.hasLayer(managedLayer.leafletLayer as any)) {
          (managedLayer.leafletLayer as any).addTo(this.map);
        }
      } else {
        if (this.map.hasLayer(managedLayer.leafletLayer as any)) {
          this.map.removeLayer(managedLayer.leafletLayer as any);
        }
      }
      
      console.log(`LayerManager: Visibility updated successfully`);
    } else {
      console.error(`LayerManager: Layer ${layerId} not found`);
    }
  }

  /**
   * Set layer opacity
   */
  setLayerOpacity(layerId: string, opacity: number): void {
    const managedLayer = this.layers.get(layerId);
    if (managedLayer) {
      managedLayer.opacity = opacity;
      // Direct opacity update for smooth slider performance
      const layer = managedLayer.leafletLayer as any;
      if (managedLayer.visible && this.map.hasLayer(layer)) {
        if (layer.setOpacity) {
          layer.setOpacity(opacity);
        } else if (layer._image) {
          layer._image.style.opacity = String(opacity);
        }
      }
    }
  }

  /**
   * Update layer order based on array of layer items
   */
  updateLayerOrder(layerItems: LayerItem[]): void {
    console.log('Updating layer order...');
    // Layer panel shows top item = top visual layer
    // So first item in array should have highest z-index
    layerItems.forEach((item, index) => {
      const managedLayer = this.layers.get(item.id);
      if (managedLayer) {
        // Reverse z-index: first item gets highest z-index
        managedLayer.zIndex = layerItems.length - index;
        console.log(`Layer ${item.id} assigned z-index ${managedLayer.zIndex}`);
      }
    });
    
    // Refresh all layer z-orders on the map
    this.refreshLayerOrder();
  }

  /**
   * Refresh the visual stacking order of all layers
   */
  private refreshLayerOrder(): void {
    console.log('Refreshing layer order on map...');
    
    // Get all layers sorted by z-index (lowest first)
    const sortedLayers = Array.from(this.layers.values())
      .sort((a, b) => a.zIndex - b.zIndex);
    
    // Remove all layers
    sortedLayers.forEach(layer => {
      if (this.map.hasLayer(layer.leafletLayer as any)) {
        this.map.removeLayer(layer.leafletLayer as any);
      }
    });
    
    // Re-add visible layers in order (lowest z-index first, highest last = on top)
    sortedLayers.forEach(layer => {
      if (layer.visible) {
        (layer.leafletLayer as any).addTo(this.map);
        // Also update opacity while we're at it
        this.updateLayerStyle(layer.id);
      }
    });
    
    console.log('Layer order refreshed');
  }

  /**
   * Update layer style (opacity and visibility)
   */
  private updateLayerStyle(layerId: string): void {
    const managedLayer = this.layers.get(layerId);
    if (!managedLayer) {
      console.error(`updateLayerStyle: Layer ${layerId} not found`);
      return;
    }
    
    const layer = managedLayer.leafletLayer as any;
    
    // Only update opacity - visibility and order handled by refreshLayerOrder
    if (managedLayer.visible && this.map.hasLayer(layer)) {
      // Set opacity for L.TileLayer or L.ImageOverlay
      if (layer.setOpacity) {
        layer.setOpacity(managedLayer.opacity);
      } else if (layer._image) {
        // Direct image element manipulation for ImageOverlay
        layer._image.style.opacity = managedLayer.opacity.toString();
      } else if (layer.options) {
        layer.options.opacity = managedLayer.opacity;
      }
      
      // Force redraw
      if (layer.redraw) {
        layer.redraw();
      } else if (layer._updateOpacity) {
        layer._updateOpacity();
      }
    }
  }

  /**
   * Remove all layers
   */
  removeLayers(): void {
    // Cancel pending requests first
    this.cancelPendingRequests();
    
    // Remove all layers with cleanup
    const layerIds = Array.from(this.layers.keys());
    layerIds.forEach(id => this.removeLayer(id));
    
    console.log('All layers removed');
  }

  /**
   * Get all layer IDs
   */
  getLayerIds(): string[] {
    return Array.from(this.layers.keys());
  }
}

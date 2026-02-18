import L from 'leaflet';
import type { STACItem } from '../types';
import type { LayerItem } from '../components/layerPanel';

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

  constructor(map: L.Map) {
    this.map = map;
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
   * Create a TiTiler tile layer for high-resolution COG rendering
   */
  private createTiTilerLayer(item: STACItem): L.TileLayer {
    // Use direct COG URL for faster tile generation (faster than STAC endpoint)
    const encodedCogUrl = encodeURIComponent(item.cogUrl!);
    
    // Build TiTiler COG tile URL with visual asset (TCI = True Color Image for Sentinel-2)
    // This is MUCH faster than /stac/tiles because it directly reads the COG
    const tileUrl = `${TITILER_URL}/cog/tiles/{z}/{x}/{y}?url=${encodedCogUrl}`;
    
    console.log('TiTiler COG tile URL template:', tileUrl);
    
    // Calculate Leaflet bounds for tiles
    const leafletBounds = L.latLngBounds(
      [item.bounds.south, item.bounds.west],
      [item.bounds.north, item.bounds.east]
    );
    
    return L.tileLayer(tileUrl, {
      tileSize: 256,
      opacity: 1,
      minZoom: 8,    // Don't zoom out too far (tiles get huge)
      maxZoom: 18,   // Max zoom for 10m resolution
      bounds: leafletBounds,  // Only request tiles within scene bounds (prevents 404s)
      attribution: '© Copernicus Sentinel data',
      crossOrigin: true,
      keepBuffer: 2,  // Keep tiles in buffer for smooth panning (default is 2)
      updateWhenIdle: false,  // Update tiles while panning (smoother but more requests)
      updateWhenZooming: false,  // Don't update during zoom animation
      // Error handling for tiles outside bounds
      errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='  // 1x1 transparent PNG
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
      this.map.removeLayer(managedLayer.leafletLayer);
      this.layers.delete(layerId);
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
      // Refresh entire layer order to ensure proper stacking
      this.refreshLayerOrder();
      console.log(`LayerManager: Visibility updated successfully`);
    } else {
      console.error(`LayerManager: Layer ${layerId} not found`);
    }
  }

  /**
   * Set layer opacity
   */
  setLayerOpacity(layerId: string, opacity: number): void {
    console.log(`LayerManager: Setting opacity for ${layerId} to ${opacity}`);
    const managedLayer = this.layers.get(layerId);
    if (managedLayer) {
      managedLayer.opacity = opacity;
      // Only update style for this specific layer (no need to reorder all)
      this.updateLayerStyle(layerId);
      console.log(`LayerManager: Opacity updated successfully`);
    } else {
      console.error(`LayerManager: Layer ${layerId} not found`);
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
    this.layers.forEach((managedLayer) => {
      this.map.removeLayer(managedLayer.leafletLayer);
    });
    this.layers.clear();
  }

  /**
   * Get all layer IDs
   */
  getLayerIds(): string[] {
    return Array.from(this.layers.keys());
  }
}

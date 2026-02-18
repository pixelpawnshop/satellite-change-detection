import L from 'leaflet';
import type { STACItem } from '../types';
import type { LayerItem } from '../components/layerPanel';

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
    console.log('Adding layer:', layerId, item.cogUrl);
    
    const url = item.cogUrl;
    let leafletLayer: L.Layer;
    
    // Use simple image overlay for better performance
    // COG rendering with georaster is too slow for real-time use
    leafletLayer = this.createImageOverlay(url, item.bounds);
    
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
   * Create an image overlay for images
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
      // Set opacity for L.ImageOverlay
      if (layer.setOpacity) {
        layer.setOpacity(managedLayer.opacity);
      } else if (layer._image) {
        // Direct image element manipulation
        layer._image.style.opacity = managedLayer.opacity.toString();
      } else if (layer.options) {
        layer.options.opacity = managedLayer.opacity;
      }
      
      // Force redraw
      if (layer._updateOpacity) {
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

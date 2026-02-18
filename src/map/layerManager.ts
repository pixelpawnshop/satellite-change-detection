import L from 'leaflet';
import parseGeoraster from 'georaster';
// @ts-ignore
import GeoRasterLayer from 'georaster-layer-for-leaflet';
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
    
    // Check if URL is a COG/TIFF or a regular image
    const url = item.cogUrl;
    const isCOG = url.toLowerCase().endsWith('.tif') || 
                  url.toLowerCase().endsWith('.tiff') ||
                  url.includes('visual') ||
                  url.includes('B04'); // Common band indicator
    
    let leafletLayer: L.Layer;
    
    if (isCOG) {
      // Render COG using georaster
      try {
        leafletLayer = await this.createGeoRasterLayer(url, item.bounds);
      } catch (error) {
        console.error('Failed to load COG, falling back to image overlay:', error);
        leafletLayer = this.createImageOverlay(url, item.bounds);
      }
    } else {
      // Use regular image overlay for JPEGs/PNGs
      leafletLayer = this.createImageOverlay(url, item.bounds);
    }
    
    const managedLayer: ManagedLayer = {
      id: layerId,
      leafletLayer,
      item,
      opacity,
      visible: true,
      zIndex: this.layers.size
    };
    
    this.layers.set(layerId, managedLayer);
    leafletLayer.addTo(this.map);
    this.updateLayerStyle(layerId);
    
    // Fit bounds to show the new layer
    const bounds = L.latLngBounds(
      [item.bounds.south, item.bounds.west],
      [item.bounds.north, item.bounds.east]
    );
    this.map.fitBounds(bounds);
  }

  /**
   * Create a georaster layer for COG files
   */
  private async createGeoRasterLayer(url: string, bounds: any): Promise<L.Layer> {
    console.log('Creating georaster layer for:', url);
    
    // Fetch and parse the georaster
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const georaster = await parseGeoraster(arrayBuffer);
    
    // Create the layer
    const layer = new GeoRasterLayer({
      georaster: georaster,
      opacity: 1,
      resolution: 256, // Adjust for performance vs quality
      pixelValuesToColorFn: function(values: number[]) {
        // For RGB imagery
        if (values.length >= 3) {
          return `rgb(${values[0]},${values[1]},${values[2]})`;
        }
        // For single band
        return `rgb(${values[0]},${values[0]},${values[0]})`;
      }
    });
    
    return layer;
  }

  /**
   * Create an image overlay for regular images
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
    const managedLayer = this.layers.get(layerId);
    if (managedLayer) {
      managedLayer.visible = visible;
      this.updateLayerStyle(layerId);
    }
  }

  /**
   * Set layer opacity
   */
  setLayerOpacity(layerId: string, opacity: number): void {
    const managedLayer = this.layers.get(layerId);
    if (managedLayer) {
      managedLayer.opacity = opacity;
      this.updateLayerStyle(layerId);
    }
  }

  /**
   * Update layer order based on array of layer items
   */
  updateLayerOrder(layerItems: LayerItem[]): void {
    // Update z-index for each layer based on position in array
    layerItems.forEach((item, index) => {
      const managedLayer = this.layers.get(item.id);
      if (managedLayer) {
        managedLayer.zIndex = index;
        this.updateLayerZIndex(item.id);
      }
    });
  }

  /**
   * Update z-index of a layer
   */
  private updateLayerZIndex(layerId: string): void {
    const managedLayer = this.layers.get(layerId);
    if (!managedLayer) return;
    
    const layer = managedLayer.leafletLayer as any;
    
    // Remove and re-add to change z-order
    this.map.removeLayer(layer);
    if (managedLayer.visible) {
      layer.addTo(this.map);
    }
  }

  /**
   * Update layer style (opacity and visibility)
   */
  private updateLayerStyle(layerId: string): void {
    const managedLayer = this.layers.get(layerId);
    if (!managedLayer) return;
    
    const layer = managedLayer.leafletLayer as any;
    
    if (!managedLayer.visible) {
      if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
    } else {
      if (!this.map.hasLayer(layer)) {
        layer.addTo(this.map);
      }
      
      // Set opacity
      if (layer.setOpacity) {
        layer.setOpacity(managedLayer.opacity);
      } else if (layer.options) {
        layer.options.opacity = managedLayer.opacity;
        if (layer._image) {
          layer._image.style.opacity = managedLayer.opacity.toString();
        }
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

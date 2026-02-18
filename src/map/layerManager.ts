import L from 'leaflet';
import type { STACItem } from '../types';

export class LayerManager {
  private map: L.Map;
  private beforeLayer: L.ImageOverlay | L.TileLayer.WMS | null = null;
  private afterLayer: L.ImageOverlay | L.TileLayer.WMS | null = null;
  private splitPosition = 0.5;

  constructor(map: L.Map) {
    this.map = map;
  }

  /**
   * Load a pair of COG/tile images for comparison
   */
  async loadCOGPair(beforeItem: STACItem, afterItem: STACItem): Promise<void> {
    this.removeLayers();

    if (!beforeItem.cogUrl || !afterItem.cogUrl) {
      throw new Error('COG URLs are required for image loading');
    }

    // Create image overlays with bounds
    const beforeBounds = L.latLngBounds(
      [beforeItem.bounds.south, beforeItem.bounds.west],
      [beforeItem.bounds.north, beforeItem.bounds.east]
    );

    const afterBounds = L.latLngBounds(
      [afterItem.bounds.south, afterItem.bounds.west],
      [afterItem.bounds.north, afterItem.bounds.east]
    );

    // Use imageOverlay for single images
    console.log('Loading before image:', beforeItem.cogUrl);
    console.log('Before bounds:', beforeBounds);
    
    this.beforeLayer = L.imageOverlay(beforeItem.cogUrl, beforeBounds, {
      opacity: 1,
      interactive: false,
      crossOrigin: true,
      errorOverlayUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2ZmMDAwMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiPkVycm9yPC90ZXh0Pjwvc3ZnPg=='
    }).addTo(this.map);

    console.log('Loading after image:', afterItem.cogUrl);
    console.log('After bounds:', afterBounds);
    
    this.afterLayer = L.imageOverlay(afterItem.cogUrl, afterBounds, {
      opacity: 1,
      interactive: false,
      crossOrigin: true,
      errorOverlayUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2ZmMDAwMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiPkVycm9yPC90ZXh0Pjwvc3ZnPg=='
    }).addTo(this.map);

    // Wait for images to load
    await Promise.all([
      new Promise((resolve, reject) => {
        const beforeImg = (this.beforeLayer as any)._image;
        if (beforeImg) {
          beforeImg.onload = () => {
            console.log('Before image loaded successfully');
            resolve(null);
          };
          beforeImg.onerror = (err: any) => {
            console.error('Before image failed to load:', err);
            console.error('Before image src:', beforeImg.src);
            reject(err);
          };
        } else {
          resolve(null);
        }
      }),
      new Promise((resolve, reject) => {
        const afterImg = (this.afterLayer as any)._image;
        if (afterImg) {
          afterImg.onload = () => {
            console.log('After image loaded successfully');
            resolve(null);
          };
          afterImg.onerror = (err: any) => {
            console.error('After image failed to load:', err);
            console.error('After image src:', afterImg.src);
            reject(err);
          };
        } else {
          resolve(null);
        }
      })
    ]).catch(err => {
      console.error('Error loading one or both images:', err);
      throw new Error('Failed to load satellite imagery. Images may not be accessible or in an unsupported format.');
    });

    this.updateSplitPosition(this.splitPosition);
  }

  /**
   * Load a pair of WMS images for Sentinel-1
   */
  async loadWMSPair(beforeItem: STACItem, afterItem: STACItem): Promise<void> {
    this.removeLayers();

    if (!beforeItem.wmsUrl || !afterItem.wmsUrl) {
      throw new Error('WMS URLs are required for Sentinel-1 loading');
    }

    // Parse WMS URL and create Leaflet WMS layer
    this.beforeLayer = L.tileLayer.wms(beforeItem.wmsUrl, {
      layers: 'AWS_VH_DB',
      format: 'image/png',
      transparent: true,
      attribution: 'Copernicus Sentinel-1',
      maxZoom: 18
    }).addTo(this.map);

    this.afterLayer = L.tileLayer.wms(afterItem.wmsUrl, {
      layers: 'AWS_VH_DB',
      format: 'image/png',
      transparent: true,
      attribution: 'Copernicus Sentinel-1',
      maxZoom: 18
    }).addTo(this.map);

    this.updateSplitPosition(this.splitPosition);
  }

  /**
   * Update the split position to show before/after comparison
   */
  updateSplitPosition(position: number): void {
    this.splitPosition = position;

    if (!this.beforeLayer || !this.afterLayer) return;

    const mapContainer = this.map.getContainer();
    const width = mapContainer.clientWidth;
    const splitX = position * width;

    // Get the image elements for imageOverlay
    const beforeElement = (this.beforeLayer as any)._image;
    const afterElement = (this.afterLayer as any)._image;

    if (beforeElement) {
      beforeElement.style.clipPath = `polygon(0 0, ${splitX}px 0, ${splitX}px 100%, 0 100%)`;
    }

    if (afterElement) {
      afterElement.style.clipPath = `polygon(${splitX}px 0, 100% 0, 100% 100%, ${splitX}px 100%)`;
    }
  }

  /**
   * Remove all comparison layers
   */
  removeLayers(): void {
    if (this.beforeLayer) {
      this.map.removeLayer(this.beforeLayer);
      this.beforeLayer = null;
    }

    if (this.afterLayer) {
      this.map.removeLayer(this.afterLayer);
      this.afterLayer = null;
    }
  }

  /**
   * Check if layers are currently loaded
   */
  hasLayers(): boolean {
    return this.beforeLayer !== null && this.afterLayer !== null;
  }
}

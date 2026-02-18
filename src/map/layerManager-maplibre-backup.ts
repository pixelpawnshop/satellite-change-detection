import type { Map as MapLibreMap } from 'maplibre-gl';
import type { STACItem } from '../types';

export class LayerManager {
  private map: MapLibreMap;
  private beforeLayerId = 'before-layer';
  private afterLayerId = 'after-layer';
  private splitPosition = 0.5;

  constructor(map: MapLibreMap) {
    this.map = map;
  }

  /**
   * Load a pair of COG images for comparison
   */
  async loadCOGPair(beforeItem: STACItem, afterItem: STACItem): Promise<void> {
    // Remove existing layers first
    this.removeLayers();

    if (!beforeItem.cogUrl || !afterItem.cogUrl) {
      throw new Error('COG URLs are required for image loading');
    }

    // Add before image (left side)
    this.map.addSource(this.beforeLayerId, {
      type: 'raster',
      tiles: [beforeItem.cogUrl],
      tileSize: 256,
      bounds: [
        beforeItem.bounds.west,
        beforeItem.bounds.south,
        beforeItem.bounds.east,
        beforeItem.bounds.north
      ]
    });

    this.map.addLayer({
      id: this.beforeLayerId,
      type: 'raster',
      source: this.beforeLayerId,
      paint: {
        'raster-opacity': 1
      }
    });

    // Add after image (right side)
    this.map.addSource(this.afterLayerId, {
      type: 'raster',
      tiles: [afterItem.cogUrl],
      tileSize: 256,
      bounds: [
        afterItem.bounds.west,
        afterItem.bounds.south,
        afterItem.bounds.east,
        afterItem.bounds.north
      ]
    });

    this.map.addLayer({
      id: this.afterLayerId,
      type: 'raster',
      source: this.afterLayerId,
      paint: {
        'raster-opacity': 1
      }
    });

    // Fit map to the imagery bounds (use the union of both)
    const bounds: [[number, number], [number, number]] = [
      [
        Math.min(beforeItem.bounds.west, afterItem.bounds.west),
        Math.min(beforeItem.bounds.south, afterItem.bounds.south)
      ],
      [
        Math.max(beforeItem.bounds.east, afterItem.bounds.east),
        Math.max(beforeItem.bounds.north, afterItem.bounds.north)
      ]
    ];

    this.map.fitBounds(bounds, { padding: 20 });

    // Apply initial split
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

    // Add before WMS layer
    this.map.addSource(this.beforeLayerId, {
      type: 'raster',
      tiles: [beforeItem.wmsUrl.replace('GetMap', 'GetTile')],
      tileSize: 256
    });

    this.map.addLayer({
      id: this.beforeLayerId,
      type: 'raster',
      source: this.beforeLayerId,
      paint: {
        'raster-opacity': 1
      }
    });

    // Add after WMS layer
    this.map.addSource(this.afterLayerId, {
      type: 'raster',
      tiles: [afterItem.wmsUrl.replace('GetMap', 'GetTile')],
      tileSize: 256
    });

    this.map.addLayer({
      id: this.afterLayerId,
      type: 'raster',
      source: this.afterLayerId,
      paint: {
        'raster-opacity': 1
      }
    });

    // Fit to bounds
    const bounds: [[number, number], [number, number]] = [
      [beforeItem.bounds.west, beforeItem.bounds.south],
      [beforeItem.bounds.east, beforeItem.bounds.north]
    ];

    this.map.fitBounds(bounds, { padding: 20 });

    this.updateSplitPosition(this.splitPosition);
  }

  /**
   * Update the split position to show before/after comparison
   */
  updateSplitPosition(position: number): void {
    this.splitPosition = position;

    // Calculate clip bounds based on split position
    const container = this.map.getContainer();
    const width = container.clientWidth;
    const splitX = position * width;

    // Clip before layer to left side
    if (this.map.getLayer(this.beforeLayerId)) {
      // Use CSS clip-path for the split effect
      const canvas = this.map.getCanvas();
      const beforeCanvas = canvas.parentElement?.querySelector(`.${this.beforeLayerId}`) as HTMLElement;
      if (beforeCanvas) {
        beforeCanvas.style.clipPath = `polygon(0 0, ${splitX}px 0, ${splitX}px 100%, 0 100%)`;
      }
    }

    // Clip after layer to right side
    if (this.map.getLayer(this.afterLayerId)) {
      const canvas = this.map.getCanvas();
      const afterCanvas = canvas.parentElement?.querySelector(`.${this.afterLayerId}`) as HTMLElement;
      if (afterCanvas) {
        afterCanvas.style.clipPath = `polygon(${splitX}px 0, 100% 0, 100% 100%, ${splitX}px 100%)`;
      }
    }
  }

  /**
   * Remove all comparison layers
   */
  removeLayers(): void {
    if (this.map.getLayer(this.beforeLayerId)) {
      this.map.removeLayer(this.beforeLayerId);
    }
    if (this.map.getSource(this.beforeLayerId)) {
      this.map.removeSource(this.beforeLayerId);
    }

    if (this.map.getLayer(this.afterLayerId)) {
      this.map.removeLayer(this.afterLayerId);
    }
    if (this.map.getSource(this.afterLayerId)) {
      this.map.removeSource(this.afterLayerId);
    }
  }

  /**
   * Check if layers are currently loaded
   */
  hasLayers(): boolean {
    return this.map.getLayer(this.beforeLayerId) !== undefined;
  }
}

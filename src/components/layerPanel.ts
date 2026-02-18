import { STACItem } from '../types';

export interface LayerItem {
  id: string;
  name: string;
  item: STACItem;
  visible: boolean;
  opacity: number;
  order: number;
}

export class LayerPanel {
  private container: HTMLElement;
  private layers: LayerItem[] = [];
  private draggedIndex: number | null = null;
  private onLayerChange: (layers: LayerItem[]) => void;
  private onLayerVisibilityChange: (layerId: string, visible: boolean) => void;
  private onLayerOpacityChange: (layerId: string, opacity: number) => void;
  private onLayerOrderChange: (layers: LayerItem[]) => void;

  constructor(
    containerId: string,
    callbacks: {
      onLayerChange: (layers: LayerItem[]) => void;
      onLayerVisibilityChange: (layerId: string, visible: boolean) => void;
      onLayerOpacityChange: (layerId: string, opacity: number) => void;
      onLayerOrderChange: (layers: LayerItem[]) => void;
    }
  ) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element with id "${containerId}" not found`);
    }
    this.container = container;
    this.onLayerChange = callbacks.onLayerChange;
    this.onLayerVisibilityChange = callbacks.onLayerVisibilityChange;
    this.onLayerOpacityChange = callbacks.onLayerOpacityChange;
    this.onLayerOrderChange = callbacks.onLayerOrderChange;
    
    this.render();
  }

  addLayer(item: STACItem, name: string): void {
    const layerId = `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newLayer: LayerItem = {
      id: layerId,
      name,
      item,
      visible: true,
      opacity: 100,
      order: this.layers.length
    };
    
    this.layers.push(newLayer);
    this.render();
    this.onLayerChange(this.layers);
  }

  removeLayer(layerId: string): void {
    this.layers = this.layers.filter(layer => layer.id !== layerId);
    this.updateLayerOrders();
    this.render();
    this.onLayerChange(this.layers);
  }

  clearLayers(): void {
    this.layers = [];
    this.render();
    this.onLayerChange(this.layers);
  }

  getLayers(): LayerItem[] {
    return [...this.layers];
  }

  private updateLayerOrders(): void {
    this.layers.forEach((layer, index) => {
      layer.order = index;
    });
  }

  private render(): void {
    if (this.layers.length === 0) {
      this.container.innerHTML = `
        <div class="layer-panel-empty">
          <p>No layers loaded</p>
          <p class="layer-panel-hint">Search for images to add layers</p>
        </div>
      `;
      return;
    }

    this.container.innerHTML = `
      <div class="layer-panel-header">
        <h3>Layers</h3>
        <button class="clear-layers-btn" id="clear-layers">Clear All</button>
      </div>
      <div class="layer-list" id="layer-list">
        ${this.layers.map((layer, index) => this.renderLayerItem(layer, index)).join('')}
      </div>
    `;

    this.attachEventListeners();
  }

  private renderLayerItem(layer: LayerItem, index: number): string {
    const date = new Date(layer.item.datetime).toLocaleDateString();
    const collection = layer.item.collection.includes('sentinel-2') ? 'Sentinel-2' :
                      layer.item.collection.includes('landsat') ? 'Landsat' :
                      layer.item.collection.includes('sentinel-1') ? 'Sentinel-1' : 'Unknown';
    
    return `
      <div class="layer-item" draggable="true" data-index="${index}" data-layer-id="${layer.id}">
        <div class="layer-drag-handle">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="6" cy="4" r="1.5"/>
            <circle cx="10" cy="4" r="1.5"/>
            <circle cx="6" cy="8" r="1.5"/>
            <circle cx="10" cy="8" r="1.5"/>
            <circle cx="6" cy="12" r="1.5"/>
            <circle cx="10" cy="12" r="1.5"/>
          </svg>
        </div>
        <div class="layer-visibility">
          <input type="checkbox" id="visibility-${layer.id}" ${layer.visible ? 'checked' : ''}>
        </div>
        <div class="layer-content">
          <div class="layer-name">${layer.name}</div>
          <div class="layer-info">${collection} - ${date}</div>
          <div class="layer-opacity-control">
            <label>Opacity: <span id="opacity-value-${layer.id}">${layer.opacity}%</span></label>
            <input type="range" 
                   id="opacity-${layer.id}" 
                   min="0" 
                   max="100" 
                   value="${layer.opacity}"
                   class="opacity-slider">
          </div>
        </div>
        <button class="layer-delete-btn" data-layer-id="${layer.id}">×</button>
      </div>
    `;
  }

  private attachEventListeners(): void {
    // Clear all button
    const clearBtn = document.getElementById('clear-layers');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearLayers());
    }

    // Layer items
    const layerItems = this.container.querySelectorAll('.layer-item');
    layerItems.forEach(item => {
      const element = item as HTMLElement;
      const layerId = element.dataset.layerId!;
      const index = parseInt(element.dataset.index!);

      // Drag and drop
      element.addEventListener('dragstart', () => this.handleDragStart(index));
      element.addEventListener('dragover', (e) => this.handleDragOver(e));
      element.addEventListener('drop', (e) => this.handleDrop(e, index));
      element.addEventListener('dragend', () => this.handleDragEnd());

      // Visibility toggle
      const visibilityCheckbox = element.querySelector(`#visibility-${layerId}`) as HTMLInputElement;
      if (visibilityCheckbox) {
        visibilityCheckbox.addEventListener('change', (e) => {
          const target = e.target as HTMLInputElement;
          const layer = this.layers.find(l => l.id === layerId);
          if (layer) {
            layer.visible = target.checked;
            this.onLayerVisibilityChange(layerId, target.checked);
          }
        });
      }

      // Opacity slider
      const opacitySlider = element.querySelector(`#opacity-${layerId}`) as HTMLInputElement;
      const opacityValue = element.querySelector(`#opacity-value-${layerId}`) as HTMLElement;
      if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
          const target = e.target as HTMLInputElement;
          const opacity = parseInt(target.value);
          const layer = this.layers.find(l => l.id === layerId);
          if (layer) {
            layer.opacity = opacity;
            if (opacityValue) {
              opacityValue.textContent = `${opacity}%`;
            }
            this.onLayerOpacityChange(layerId, opacity / 100);
          }
        });
      }

      // Delete button
      const deleteBtn = element.querySelector(`button[data-layer-id="${layerId}"]`);
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => this.removeLayer(layerId));
      }
    });
  }

  private handleDragStart(index: number): void {
    this.draggedIndex = index;
    const items = this.container.querySelectorAll('.layer-item');
    if (items[index]) {
      items[index].classList.add('dragging');
    }
  }

  private handleDragOver(e: Event): void {
    e.preventDefault();
  }

  private handleDrop(e: Event, dropIndex: number): void {
    e.preventDefault();
    
    if (this.draggedIndex === null || this.draggedIndex === dropIndex) {
      return;
    }

    // Reorder layers array
    const draggedLayer = this.layers[this.draggedIndex];
    this.layers.splice(this.draggedIndex, 1);
    this.layers.splice(dropIndex, 0, draggedLayer);
    
    this.updateLayerOrders();
    this.render();
    this.onLayerOrderChange(this.layers);
  }

  private handleDragEnd(): void {
    this.draggedIndex = null;
    const items = this.container.querySelectorAll('.layer-item');
    items.forEach(item => item.classList.remove('dragging'));
  }

  show(): void {
    this.container.style.display = 'block';
  }

  hide(): void {
    this.container.style.display = 'none';
  }
}

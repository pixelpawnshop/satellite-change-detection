import { STACItem } from '../types';

export interface LayerItem {
  id: string;
  name: string;
  item: STACItem;
  visible: boolean;
  opacity: number;
  order: number;
  loading?: boolean;
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
      order: 0, // New layers get order 0, will be adjusted
      loading: true
    };
    
    // Add new layer at the BEGINNING so it appears at top of list
    // This matches the visual z-order where newer layers are on top
    this.layers.unshift(newLayer);
    this.updateLayerOrders();
    this.render();
    this.onLayerChange(this.layers);
  }

  setLayerLoading(layerId: string, loading: boolean): void {
    const layer = this.layers.find(l => l.id === layerId);
    if (layer) {
      layer.loading = loading;
      this.render();
    }
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

  /**
   * Get all layers in display order (first item = topmost visual layer)
   */
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
    
    const loadingIndicator = layer.loading ? '<span class="layer-loading-spinner"></span>' : '';
    
    return `
      <div class="layer-item ${layer.loading ? 'loading' : ''}" draggable="false" data-index="${index}" data-layer-id="${layer.id}">
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
          <input type="checkbox" id="visibility-${layer.id}" ${layer.visible ? 'checked' : ''} ${layer.loading ? 'disabled' : ''}>
        </div>
        <div class="layer-content">
          <div class="layer-name">${layer.name} ${loadingIndicator}</div>
          <div class="layer-info">${collection} - ${date}</div>
          <div class="layer-opacity-control">
            <label>Opacity: <span id="opacity-value-${layer.id}">${layer.opacity}%</span></label>
            <input type="range" 
                   id="opacity-${layer.id}" 
                   min="0" 
                   max="100" 
                   value="${layer.opacity}"
                   class="opacity-slider"
                   ${layer.loading ? 'disabled' : ''}>
          </div>
        </div>
        <button class="layer-delete-btn" data-layer-id="${layer.id}" ${layer.loading ? 'disabled' : ''}>×</button>
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

      // Drag and drop - only allow from drag handle
      const dragHandle = element.querySelector('.layer-drag-handle') as HTMLElement;
      if (dragHandle) {
        dragHandle.addEventListener('mousedown', () => {
          element.setAttribute('draggable', 'true');
        });
      }
      
      element.addEventListener('dragstart', (e) => this.handleDragStart(index, e as DragEvent));
      element.addEventListener('dragover', (e) => this.handleDragOver(e as DragEvent));
      element.addEventListener('drop', (e) => this.handleDrop(e as DragEvent));
      element.addEventListener('dragend', () => {
        this.handleDragEnd();
        element.setAttribute('draggable', 'false');
      });

      // Visibility toggle
      const visibilityCheckbox = element.querySelector(`#visibility-${layerId}`) as HTMLInputElement;
      const visibilityContainer = element.querySelector('.layer-visibility') as HTMLElement;
      
      if (visibilityContainer) {
        // Prevent drag on visibility container
        visibilityContainer.addEventListener('mousedown', (e) => e.stopPropagation());
        visibilityContainer.addEventListener('dragstart', (e) => e.preventDefault());
      }
      
      if (visibilityCheckbox) {
        // Prevent drag when clicking checkbox
        visibilityCheckbox.addEventListener('mousedown', (e) => e.stopPropagation());
        visibilityCheckbox.addEventListener('click', (e) => e.stopPropagation());
        visibilityCheckbox.addEventListener('dragstart', (e) => e.preventDefault());
        
        visibilityCheckbox.addEventListener('change', (e) => {
          e.stopPropagation();
          const target = e.target as HTMLInputElement;
          const layer = this.layers.find(l => l.id === layerId);
          if (layer) {
            layer.visible = target.checked;
            console.log(`Layer ${layerId} visibility changed to ${target.checked}`);
            this.onLayerVisibilityChange(layerId, target.checked);
          }
        });
      }

      // Opacity slider
      const opacitySlider = element.querySelector(`#opacity-${layerId}`) as HTMLInputElement;
      const opacityValue = element.querySelector(`#opacity-value-${layerId}`) as HTMLElement;
      const opacityControl = element.querySelector('.layer-opacity-control') as HTMLElement;
      
      if (opacityControl) {
        // Prevent drag on entire opacity control area
        opacityControl.addEventListener('mousedown', (e) => e.stopPropagation());
        opacityControl.addEventListener('dragstart', (e) => e.preventDefault());
      }
      
      if (opacitySlider) {
        // Prevent drag when interacting with slider
        opacitySlider.addEventListener('mousedown', (e) => e.stopPropagation());
        opacitySlider.addEventListener('click', (e) => e.stopPropagation());
        opacitySlider.addEventListener('dragstart', (e) => e.preventDefault());
        
        opacitySlider.addEventListener('input', (e) => {
          e.stopPropagation();
          const target = e.target as HTMLInputElement;
          const opacity = parseInt(target.value);
          const layer = this.layers.find(l => l.id === layerId);
          if (layer) {
            layer.opacity = opacity;
            if (opacityValue) {
              opacityValue.textContent = `${opacity}%`;
            }
            console.log(`Layer ${layerId} opacity changed to ${opacity / 100}`);
            this.onLayerOpacityChange(layerId, opacity / 100);
          }
        });
      }

      // Delete button
      const deleteBtn = element.querySelector(`button[data-layer-id="${layerId}"]`);
      if (deleteBtn) {
        // Prevent drag when clicking delete
        deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeLayer(layerId);
        });
      }
      
      // Prevent drag on the entire layer content area (sliders, etc)
      const layerContent = element.querySelector('.layer-content');
      if (layerContent) {
        layerContent.addEventListener('mousedown', (e) => {
          // Only stop propagation if clicking on interactive elements
          const target = e.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'LABEL' || target.closest('.layer-opacity-control')) {
            e.stopPropagation();
          }
        });
      }
    });
  }

  private handleDragStart(index: number, e: DragEvent): void {
    this.draggedIndex = index;
    const items = this.container.querySelectorAll('.layer-item');
    if (items[index]) {
      items[index].classList.add('dragging');
    }
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    
    const target = (e.target as HTMLElement).closest('.layer-item') as HTMLElement;
    if (!target || this.draggedIndex === null) return;
    
    const allItems = Array.from(this.container.querySelectorAll('.layer-item'));
    const draggedElement = allItems[this.draggedIndex] as HTMLElement;
    const dropIndex = allItems.indexOf(target);
    
    if (dropIndex === -1 || dropIndex === this.draggedIndex) return;
    
    // Create live preview by reordering DOM
    if (dropIndex < this.draggedIndex) {
      // Moving up
      target.parentNode?.insertBefore(draggedElement, target);
    } else {
      // Moving down
      target.parentNode?.insertBefore(draggedElement, target.nextSibling);
    }
    
    // Update temporary index tracking
    this.draggedIndex = dropIndex;
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    
    if (this.draggedIndex === null) return;
    
    // Get the current visual order from DOM
    const items = Array.from(this.container.querySelectorAll('.layer-item')) as HTMLElement[];
    const newOrder: LayerItem[] = [];
    
    items.forEach(item => {
      const layerId = item.dataset.layerId!;
      const layer = this.layers.find(l => l.id === layerId);
      if (layer) {
        newOrder.push(layer);
      }
    });
    
    // Update layers array to match visual order
    this.layers = newOrder;
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

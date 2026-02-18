import { STACItem } from '../types';

export interface LayerItem {
  id: string;
  name: string;
  item: STACItem;
  visible: boolean;
  opacity: number;
  order: number;
  loading?: boolean;
  group?: string; // Group name for organizing layers (e.g., "Before", "After")
}

export class LayerPanel {
  private container: HTMLElement;
  private layers: LayerItem[] = [];
  private draggedIndex: number | null = null;
  private draggedGroup: string | null = null; // Track which group is being dragged
  private expandedGroups: Set<string> = new Set(); // Groups collapsed by default
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

  addLayer(item: STACItem, name: string, group?: string): void {
    const layerId = `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newLayer: LayerItem = {
      id: layerId,
      name,
      item,
      visible: true,
      opacity: 100,
      order: 0, // New layers get order 0, will be adjusted
      loading: true,
      group // Optional group for organizing layers
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
    console.log('updateLayerOrders - layers:', this.layers.map(l => `${l.group || 'ungrouped'}: ${l.name}`));
    this.layers.forEach((layer, index) => {
      layer.order = index;
    });
    // Notify the map to update layer stacking order
    this.onLayerOrderChange(this.layers);
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

    // Group layers by 'group' property
    const grouped = new Map<string, LayerItem[]>();
    const ungrouped: LayerItem[] = [];
    
    this.layers.forEach(layer => {
      if (layer.group) {
        if (!grouped.has(layer.group)) {
          grouped.set(layer.group, []);
        }
        grouped.get(layer.group)!.push(layer);
      } else {
        ungrouped.push(layer);
      }
    });

    // Render grouped and ungrouped layers
    const groupedHTML = Array.from(grouped.entries())
      .map(([groupName, groupLayers]) => this.renderGroup(groupName, groupLayers))
      .join('');
    
    const ungroupedHTML = ungrouped
      .map((layer, index) => this.renderLayerItem(layer, this.layers.indexOf(layer)))
      .join('');

    this.container.innerHTML = `
      <div class="layer-panel-header">
        <h3>Layers</h3>
        <button class="clear-layers-btn" id="clear-layers">Clear All</button>
      </div>
      <div class="layer-list" id="layer-list">
        ${groupedHTML}
        ${ungroupedHTML}
      </div>
    `;

    this.attachEventListeners();
  }

  private renderGroup(groupName: string, groupLayers: LayerItem[]): string {
    const isExpanded = this.expandedGroups.has(groupName);
    const allVisible = groupLayers.every(l => l.visible);
    const someVisible = groupLayers.some(l => l.visible);
    const avgOpacity = Math.round(groupLayers.reduce((sum, l) => sum + l.opacity, 0) / groupLayers.length);
    const hasLoading = groupLayers.some(l => l.loading);
    
    const expandIcon = isExpanded ? '▼' : '▶';
    const layersHTML = isExpanded 
      ? groupLayers.map((layer, idx) => this.renderLayerItem(layer, this.layers.indexOf(layer), true)).join('')
      : '';
    
    return `
      <div class="layer-group" data-group="${groupName}" draggable="false">
        <div class="layer-group-header">
          <div class="layer-drag-handle group-drag-handle">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="6" cy="4" r="1.5"/>
              <circle cx="10" cy="4" r="1.5"/>
              <circle cx="6" cy="8" r="1.5"/>
              <circle cx="10" cy="8" r="1.5"/>
              <circle cx="6" cy="12" r="1.5"/>
              <circle cx="10" cy="12" r="1.5"/>
            </svg>
          </div>
          <button class="layer-group-toggle" data-group="${groupName}">
            <span class="expand-icon">${expandIcon}</span>
            <span class="group-name">${groupName}</span>
          </button>
          <div class="layer-group-controls">
            <div class="group-visibility">
              <input type="checkbox" 
                     id="group-visibility-${groupName}" 
                     ${allVisible ? 'checked' : ''}
                     ${!someVisible ? '' : (!allVisible ? 'class="indeterminate"' : '')}
                     ${hasLoading ? 'disabled' : ''}>
            </div>
            <div class="group-opacity-control">
              <input type="range" 
                     id="group-opacity-${groupName}" 
                     min="0" 
                     max="100" 
                     value="${avgOpacity}"
                     class="opacity-slider"
                     title="Group opacity: ${avgOpacity}%"
                     ${hasLoading ? 'disabled' : ''}>
              <span class="group-opacity-value">${avgOpacity}%</span>
            </div>
          </div>
        </div>
        <div class="layer-group-items ${isExpanded ? 'expanded' : 'collapsed'}">
          ${layersHTML}
        </div>
      </div>
    `;
  }

  private renderLayerItem(layer: LayerItem, index: number, isInGroup: boolean = false): string {
    const date = new Date(layer.item.datetime).toLocaleDateString();
    const collection = layer.item.collection.includes('sentinel-2') ? 'Sentinel-2' :
                      layer.item.collection.includes('landsat') ? 'Landsat' :
                      layer.item.collection.includes('sentinel-1') ? 'Sentinel-1' : 'Unknown';
    
    const loadingIndicator = layer.loading ? '<span class="layer-loading-spinner"></span>' : '';
    const groupClass = isInGroup ? 'grouped-layer' : '';
    
    return `
      <div class="layer-item ${groupClass} ${layer.loading ? 'loading' : ''}" draggable="false" data-index="${index}" data-layer-id="${layer.id}">
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

    // Group expand/collapse toggles
    const groupToggles = this.container.querySelectorAll('.layer-group-toggle');
    groupToggles.forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupName = (toggle as HTMLElement).dataset.group!;
        if (this.expandedGroups.has(groupName)) {
          this.expandedGroups.delete(groupName);
        } else {
          this.expandedGroups.add(groupName);
        }
        this.render();
      });
    });

    // Group visibility toggles
    const groupVisibilityBoxes = this.container.querySelectorAll('[id^="group-visibility-"]');
    groupVisibilityBoxes.forEach(checkbox => {
      const input = checkbox as HTMLInputElement;
      const groupName = input.id.replace('group-visibility-', '');
      
      input.addEventListener('change', (e) => {
        e.stopPropagation();
        const checked = (e.target as HTMLInputElement).checked;
        const groupLayers = this.layers.filter(l => l.group === groupName);
        
        groupLayers.forEach(layer => {
          layer.visible = checked;
          this.onLayerVisibilityChange(layer.id, checked);
        });
        
        this.render();
      });
    });

    // Group opacity sliders
    const groupOpacitySliders = this.container.querySelectorAll('[id^="group-opacity-"]');
    groupOpacitySliders.forEach(slider => {
      const input = slider as HTMLInputElement;
      const groupName = input.id.replace('group-opacity-', '');
      
      input.addEventListener('input', (e) => {
        e.stopPropagation();
        const opacity = parseInt((e.target as HTMLInputElement).value);
        const groupLayers = this.layers.filter(l => l.group === groupName);
        
        groupLayers.forEach(layer => {
          layer.opacity = opacity;
          this.onLayerOpacityChange(layer.id, opacity / 100);
        });
        
        // Update display without full re-render for smooth slider
        const valueSpan = input.parentElement?.querySelector('.group-opacity-value');
        if (valueSpan) {
          valueSpan.textContent = `${opacity}%`;
        }
        
        // Update individual layer sliders if group is expanded
        groupLayers.forEach(layer => {
          const layerSlider = document.getElementById(`opacity-${layer.id}`) as HTMLInputElement;
          const layerValue = document.getElementById(`opacity-value-${layer.id}`);
          if (layerSlider) layerSlider.value = opacity.toString();
          if (layerValue) layerValue.textContent = `${opacity}%`;
        });
      });
    });

    // Group drag and drop
    const layerGroups = this.container.querySelectorAll('.layer-group');
    layerGroups.forEach(groupElement => {
      const element = groupElement as HTMLElement;
      const groupName = element.dataset.group!;
      
      // Enable drag from drag handle only
      const dragHandle = element.querySelector('.group-drag-handle') as HTMLElement;
      if (dragHandle) {
        dragHandle.addEventListener('mousedown', () => {
          element.setAttribute('draggable', 'true');
        });
      }
      
      element.addEventListener('dragstart', (e) => {
        this.draggedGroup = groupName;
        element.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
        }
        console.log(`Started dragging group: ${groupName}`);
      });
      
      element.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!this.draggedGroup || this.draggedGroup === groupName) return;
        
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        
        // Get the dragged element and create live preview by reordering DOM
        const draggedElement = this.container.querySelector(`[data-group="${this.draggedGroup}"]`) as HTMLElement;
        const targetElement = element;
        
        if (!draggedElement || !targetElement) return;
        
        const allGroups = Array.from(this.container.querySelectorAll('.layer-group')) as HTMLElement[];
        const draggedIndex = allGroups.indexOf(draggedElement);
        const targetIndex = allGroups.indexOf(targetElement);
        
        if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;
        
        // Create live preview by physically moving DOM elements (same as layer dragging)
        const layerList = this.container.querySelector('.layer-list');
        if (!layerList) return;
        
        if (targetIndex < draggedIndex) {
          // Moving up - insert before target
          layerList.insertBefore(draggedElement, targetElement);
        } else {
          // Moving down - insert after target
          layerList.insertBefore(draggedElement, targetElement.nextSibling);
        }
      });
      
      element.addEventListener('dragend', () => {
        console.log('Dragend fired for group:', groupName);
        if (!this.draggedGroup) {
          console.log('No dragged group, skipping');
          return;
        }
        
        // DOM is already reordered from dragover, just sync the data
        const groupNames = Array.from(this.container.querySelectorAll('.layer-group'))
          .map(g => (g as HTMLElement).dataset.group!);
        
        console.log('Group order from DOM:', groupNames);
        
        // Rebuild layers array to match DOM order
        const newLayers: LayerItem[] = [];
        groupNames.forEach(gName => {
          const groupLayers = this.layers.filter(l => l.group === gName);
          newLayers.push(...groupLayers);
        });
        
        // Add ungrouped layers at the end
        const ungroupedLayers = this.layers.filter(l => !l.group);
        newLayers.push(...ungroupedLayers);
        
        console.log('New layers order:', newLayers.map(l => `${l.group || 'ungrouped'}: ${l.name}`));
        
        this.layers = newLayers;
        this.updateLayerOrders();
        
        // Reset drag state and re-render
        this.draggedGroup = null;
        element.setAttribute('draggable', 'false');
        element.classList.remove('dragging');
        this.render();
      });
    });

    // Layer items (existing individual layer controls)
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
            // Call directly without logging for smooth performance
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
    
    // Get the current visual order from DOM (only visible layer items)
    const visibleItems = Array.from(this.container.querySelectorAll('.layer-item')) as HTMLElement[];
    const newVisibleOrder: LayerItem[] = [];
    
    visibleItems.forEach(item => {
      const layerId = item.dataset.layerId!;
      const layer = this.layers.find(l => l.id === layerId);
      if (layer) {
        newVisibleOrder.push(layer);
      }
    });
    
    // Check if dragged layer belongs to a group
    const draggedLayer = newVisibleOrder[0]; // The first one should be our dragged layer
    if (draggedLayer && draggedLayer.group) {
      // Reordering within a group - only update layers in that group
      const groupName = draggedLayer.group;
      const groupLayersReordered = newVisibleOrder.filter(l => l.group === groupName);
      const otherLayers = this.layers.filter(l => l.group !== groupName);
      
      // Maintain the position of the group by finding where it starts
      const firstGroupLayerIndex = this.layers.findIndex(l => l.group === groupName);
      
      // Rebuild layers array: layers before group + reordered group + layers after group
      const beforeGroup = this.layers.slice(0, firstGroupLayerIndex);
      const afterGroupIndex = firstGroupLayerIndex + this.layers.filter(l => l.group === groupName).length;
      const afterGroup = this.layers.slice(afterGroupIndex);
      
      this.layers = [...beforeGroup, ...groupLayersReordered, ...afterGroup];
    } else {
      // Reordering ungrouped layers - use the full visible order
      // But we need to preserve any layers from collapsed groups
      const collapsedGroupLayers = this.layers.filter(l => {
        if (!l.group) return false;
        return !this.expandedGroups.has(l.group);
      });
      
      // Merge: preserved collapsed layers + reordered visible layers
      // We need to maintain relative positions
      const result: LayerItem[] = [...this.layers];
      
      // Remove visible layers from result
      const visibleIds = new Set(newVisibleOrder.map(l => l.id));
      const preserved = result.filter(l => !visibleIds.has(l.id));
      
      // Add back in new order
      this.layers = [...newVisibleOrder, ...preserved];
    }
    
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

import { STACItem } from '../types';

export interface SceneSelectorOptions {
  onConfirm: (selectedScenes: STACItem[]) => void;
  onCancel: () => void;
}

export class SceneSelector {
  private modal: HTMLElement | null = null;
  private selectedScenes: Map<string, STACItem> = new Map();
  private autoSelectMode: boolean = true;
  private allBeforeScenes: STACItem[] = [];
  private allAfterScenes: STACItem[] = [];

  /**
   * Show scene selection modal with thumbnails
   */
  public showSelectionModal(
    beforeScenes: STACItem[],
    afterScenes: STACItem[],
    options: SceneSelectorOptions
  ): void {
    // Store all candidates
    this.allBeforeScenes = beforeScenes;
    this.allAfterScenes = afterScenes;

    // Group scenes by tile ID
    const beforeByTile = this.groupByTile(beforeScenes);
    const afterByTile = this.groupByTile(afterScenes);

    // Auto-select first (best) scene for each tile
    this.selectedScenes.clear();
    beforeScenes.forEach(scene => {
      if (!this.selectedScenes.has(scene.tileId!)) {
        this.selectedScenes.set(scene.tileId!, scene);
      }
    });
    afterScenes.forEach(scene => {
      const key = `after_${scene.tileId}`;
      if (!this.selectedScenes.has(key)) {
        this.selectedScenes.set(key, scene);
      }
    });

    this.createModal(beforeByTile, afterByTile, options);
  }

  private groupByTile(scenes: STACItem[]): Map<string, STACItem[]> {
    const grouped = new Map<string, STACItem[]>();
    scenes.forEach(scene => {
      const tileId = scene.tileId!;
      if (!grouped.has(tileId)) {
        grouped.set(tileId, []);
      }
      grouped.get(tileId)!.push(scene);
    });
    return grouped;
  }

  private createModal(
    beforeByTile: Map<string, STACItem[]>,
    afterByTile: Map<string, STACItem[]>,
    options: SceneSelectorOptions
  ): void {
    // Detect if we might have incomplete coverage
    // Show warning if before/after have different tile counts (suggests missing tiles due to cloud filter)
    // But don't show for Sentinel-1 (SAR doesn't have cloud cover)
    const beforeTileCount = beforeByTile.size;
    const afterTileCount = afterByTile.size;
    const firstScene = this.allBeforeScenes[0] || this.allAfterScenes[0];
    const isSentinel1 = firstScene?.collection === 'sentinel-1-grd';
    const showWarning = beforeTileCount !== afterTileCount && !isSentinel1;

    // Create modal overlay
    this.modal = document.createElement('div');
    this.modal.className = 'scene-selector-modal';
    this.modal.innerHTML = `
      <div class="scene-selector-content">
        <div class="scene-selector-header">
          <h2>Select Scenes</h2>
          <label class="auto-select-toggle">
            <input type="checkbox" id="auto-select-checkbox" ${this.autoSelectMode ? 'checked' : ''}>
            <span>Auto-select best scenes</span>
          </label>
          <button class="close-btn" id="close-selector">&times;</button>
        </div>
        
        ${showWarning ? `
        <div class="scene-selector-warning">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm.93 4.588l-.03 3.86a.75.75 0 0 1-1.41.284l-.03-.081-.03-3.86a.75.75 0 0 1 1.5-.203zm-1.43 6.66a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
          </svg>
          <span>Missing tiles? Try increasing the <strong>Max Cloud Cover</strong> filter and search again.</span>
        </div>
        ` : ''}
        
        <div class="scene-selector-body">
          <div class="scenes-section">
            <h3>Before Date</h3>
            <div class="tiles-grid" id="before-tiles"></div>
          </div>
          
          <div class="scenes-section">
            <h3>After Date</h3>
            <div class="tiles-grid" id="after-tiles"></div>
          </div>
        </div>
        
        <div class="scene-selector-footer">
          <div class="selection-info" id="selection-info"></div>
          <div class="actions">
            <button class="btn-secondary" id="cancel-btn">Cancel</button>
            <button class="btn-primary" id="confirm-btn">Load Selected Scenes</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);

    // Populate tiles
    const beforeContainer = this.modal.querySelector('#before-tiles') as HTMLElement;
    const afterContainer = this.modal.querySelector('#after-tiles') as HTMLElement;

    this.populateTiles(beforeContainer, beforeByTile, 'before');
    this.populateTiles(afterContainer, afterByTile, 'after');

    // Setup event listeners
    this.setupEventListeners(options);
    this.updateSelectionInfo();

    // If auto-select, show brief notification
    if (this.autoSelectMode) {
      this.showAutoSelectInfo();
    }
  }

  private populateTiles(
    container: HTMLElement,
    tileMap: Map<string, STACItem[]>,
    prefix: string
  ): void {
    if (tileMap.size === 0) {
      container.innerHTML = '<p class="no-scenes">No scenes available</p>';
      return;
    }

    tileMap.forEach((scenes, tileId) => {
      const tileCard = document.createElement('div');
      tileCard.className = 'tile-card';
      
      const selectedScene = this.selectedScenes.get(
        prefix === 'after' ? `after_${tileId}` : tileId
      ) || scenes[0];

      tileCard.innerHTML = `
        <div class="tile-header">
          <strong>Tile ${tileId}</strong>
          <span class="scene-count">${scenes.length} scene${scenes.length > 1 ? 's' : ''} available</span>
        </div>
        <div class="scenes-carousel" data-tile="${tileId}" data-prefix="${prefix}">
          ${scenes.map((scene, idx) => this.createSceneCard(scene, idx === 0, tileId, prefix)).join('')}
        </div>
      `;

      container.appendChild(tileCard);
    });

    // Add click handlers for scene selection
    container.querySelectorAll('.scene-option').forEach(card => {
      card.addEventListener('click', (e) => {
        const sceneId = (e.currentTarget as HTMLElement).dataset.sceneId!;
        const tileId = (e.currentTarget as HTMLElement).dataset.tileId!;
        const prefix = (e.currentTarget as HTMLElement).dataset.prefix!;
        this.selectScene(sceneId, tileId, prefix);
      });
    });
  }

  private createSceneCard(
    scene: STACItem,
    isSelected: boolean,
    tileId: string,
    prefix: string
  ): string {
    const date = new Date(scene.datetime).toLocaleDateString();
    const isSentinel1 = scene.collection === 'sentinel-1-grd';
    const cloudCover = scene.cloudCover?.toFixed(1) || 'N/A';
    
    return `
      <div class="scene-option ${isSelected ? 'selected' : ''}" 
           data-scene-id="${scene.id}"
           data-tile-id="${tileId}"
           data-prefix="${prefix}">
        <div class="scene-thumbnail">
          <img src="${scene.previewUrl}" 
               alt="Scene preview"
               loading="lazy"
               onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22256%22%3E%3Crect width=%22256%22 height=%22256%22 fill=%22%23ddd%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22%3ENo preview%3C/text%3E%3C/svg%3E'">
          <div class="scene-selected-badge">✓</div>
        </div>
        <div class="scene-info">
          <div class="scene-date">${date}</div>
          ${!isSentinel1 ? `<div class="scene-cloud">${cloudCover}% clouds</div>` : ''}
        </div>
      </div>
    `;
  }

  private selectScene(sceneId: string, tileId: string, prefix: string): void {
    // If in auto mode, disable it when user manually selects
    if (this.autoSelectMode) {
      this.autoSelectMode = false;
      const checkbox = this.modal?.querySelector('#auto-select-checkbox') as HTMLInputElement;
      if (checkbox) checkbox.checked = false;
      this.modal?.classList.remove('auto-select-mode');
    }

    // Find the scene from all available candidates
    const allCandidates = prefix === 'after' ? this.allAfterScenes : this.allBeforeScenes;
    const scene = allCandidates.find(s => s.id === sceneId);
    
    if (!scene) {
      console.warn(`Scene ${sceneId} not found in candidates`);
      return;
    }

    // Update selection
    const key = prefix === 'after' ? `after_${tileId}` : tileId;
    this.selectedScenes.set(key, scene);

    // Update UI
    const carousel = this.modal?.querySelector(`[data-tile="${tileId}"][data-prefix="${prefix}"]`);
    if (carousel) {
      carousel.querySelectorAll('.scene-option').forEach(card => {
        if ((card as HTMLElement).dataset.sceneId === sceneId) {
          card.classList.add('selected');
        } else {
          card.classList.remove('selected');
        }
      });
    }

    this.updateSelectionInfo();
  }

  private setupEventListeners(options: SceneSelectorOptions): void {
    const autoSelectCheckbox = this.modal?.querySelector('#auto-select-checkbox') as HTMLInputElement;
    const confirmBtn = this.modal?.querySelector('#confirm-btn') as HTMLButtonElement;
    const cancelBtn = this.modal?.querySelector('#cancel-btn') as HTMLButtonElement;
    const closeBtn = this.modal?.querySelector('#close-selector') as HTMLButtonElement;

    autoSelectCheckbox?.addEventListener('change', (e) => {
      this.autoSelectMode = (e.target as HTMLInputElement).checked;
      this.modal?.classList.toggle('auto-select-mode', this.autoSelectMode);
      if (this.autoSelectMode) {
        this.showAutoSelectInfo();
      }
    });

    confirmBtn?.addEventListener('click', () => {
      const selectedScenes = Array.from(this.selectedScenes.values());
      this.close();
      options.onConfirm(selectedScenes);
    });

    cancelBtn?.addEventListener('click', () => {
      this.close();
      options.onCancel();
    });

    closeBtn?.addEventListener('click', () => {
      this.close();
      options.onCancel();
    });

    // Close on background click
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
        options.onCancel();
      }
    });

    // ESC key to close
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        options.onCancel();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  private updateSelectionInfo(): void {
    const infoEl = this.modal?.querySelector('#selection-info');
    if (!infoEl) return;

    const count = this.selectedScenes.size;
    infoEl.textContent = this.autoSelectMode 
      ? `Auto-selected ${count} scenes (best match per tile)`
      : `${count} scenes selected`;
  }

  private showAutoSelectInfo(): void {
    // Brief notification that scenes were auto-selected
    const info = document.createElement('div');
    info.className = 'auto-select-info';
    info.textContent = 'Automatically selected the best scene for each tile based on date proximity and cloud cover';
    this.modal?.querySelector('.scene-selector-body')?.prepend(info);
    
    setTimeout(() => info.remove(), 5000);
  }

  private close(): void {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }
}

import L from 'leaflet';

export class SplitScreenControl {
  private map: L.Map;
  private divider: HTMLElement | null = null;
  private isDragging = false;
  private splitPosition = 0.5;
  private onSplitChange?: (position: number) => void;

  constructor(map: L.Map, onSplitChange?: (position: number) => void) {
    this.map = map;
    this.onSplitChange = onSplitChange;
  }

  /**
   * Add the split screen divider to the map
   */
  add(): void {
    if (this.divider) return;

    const container = this.map.getContainer();
    
    this.divider = document.createElement('div');
    this.divider.className = 'split-divider';
    this.updateDividerPosition();

    // Mouse events
    this.divider.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);

    // Touch events for mobile
    this.divider.addEventListener('touchstart', this.handleTouchStart);
    document.addEventListener('touchmove', this.handleTouchMove);
    document.addEventListener('touchend', this.handleTouchEnd);

    container.appendChild(this.divider);
  }

  /**
   * Remove the split screen divider
   */
  remove(): void {
    if (!this.divider) return;

    this.divider.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    
    this.divider.removeEventListener('touchstart', this.handleTouchStart);
    document.removeEventListener('touchmove', this.handleTouchMove);
    document.removeEventListener('touchend', this.handleTouchEnd);

    this.divider.remove();
    this.divider = null;
  }

  /**
   * Get current split position (0 to 1)
   */
  getPosition(): number {
    return this.splitPosition;
  }

  /**
   * Set split position programmatically (0 to 1)
   */
  setPosition(position: number): void {
    this.splitPosition = Math.max(0, Math.min(1, position));
    this.updateDividerPosition();
    this.onSplitChange?.(this.splitPosition);
  }

  private updateDividerPosition(): void {
    if (!this.divider) return;
    const container = this.map.getContainer();
    const width = container.clientWidth;
    this.divider.style.left = `${this.splitPosition * width}px`;
  }

  private handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    this.isDragging = true;
    if (this.divider) {
      this.divider.style.cursor = 'col-resize';
    }
    document.body.style.cursor = 'col-resize';
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isDragging) return;
    this.updatePosition(e.clientX);
  };

  private handleMouseUp = (): void => {
    this.isDragging = false;
    if (this.divider) {
      this.divider.style.cursor = 'col-resize';
    }
    document.body.style.cursor = '';
  };

  private handleTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.isDragging = true;
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (!this.isDragging || e.touches.length === 0) return;
    this.updatePosition(e.touches[0].clientX);
  };

  private handleTouchEnd = (): void => {
    this.isDragging = false;
  };

  private updatePosition(clientX: number): void {
    const container = this.map.getContainer();
    const rect = container.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    this.splitPosition = Math.max(0, Math.min(1, relativeX / rect.width));
    this.updateDividerPosition();
    this.onSplitChange?.(this.splitPosition);
  }
}

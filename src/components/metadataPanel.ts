import type { STACItem } from '../types';

export class MetadataPanel {
  private panel: HTMLElement;
  private beforeMetadata: HTMLElement;
  private afterMetadata: HTMLElement;

  constructor() {
    this.panel = document.getElementById('metadata-panel') as HTMLElement;
    this.beforeMetadata = document.getElementById('before-metadata') as HTMLElement;
    this.afterMetadata = document.getElementById('after-metadata') as HTMLElement;
  }

  /**
   * Show metadata for image pair
   */
  show(beforeItem: STACItem, afterItem: STACItem): void {
    this.beforeMetadata.innerHTML = this.formatMetadata(beforeItem);
    this.afterMetadata.innerHTML = this.formatMetadata(afterItem);
    this.panel.style.display = 'block';
  }

  /**
   * Hide metadata panel
   */
  hide(): void {
    this.panel.style.display = 'none';
  }

  /**
   * Format metadata item for display
   */
  private formatMetadata(item: STACItem): string {
    const date = new Date(item.datetime);
    const dateStr = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short'
    });

    let html = `
      <div class="metadata-item">
        <span class="metadata-label">Date:</span> ${dateStr}
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Scene ID:</span> ${item.id}
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Collection:</span> ${item.collection}
      </div>
    `;

    if (item.cloudCover !== undefined) {
      html += `
        <div class="metadata-item">
          <span class="metadata-label">Cloud Cover:</span> ${item.cloudCover.toFixed(1)}%
        </div>
      `;
    }

    if (item.properties?.sensor) {
      html += `
        <div class="metadata-item">
          <span class="metadata-label">Sensor:</span> ${item.properties.sensor}
        </div>
      `;
    }

    if (item.properties?.note) {
      html += `
        <div class="metadata-item" style="font-size: 11px; color: #888; margin-top: 8px;">
          ${item.properties.note}
        </div>
      `;
    }

    return html;
  }
}

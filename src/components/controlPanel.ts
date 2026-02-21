import type { SensorType, SearchParams, S1AcquisitionMode, S1Polarization } from '../types';

export class ControlPanel {
  private sensorSelect: HTMLSelectElement;
  private cloudCoverSection: HTMLElement;
  private cloudCoverInput: HTMLInputElement;
  private cloudValueDisplay: HTMLElement;
  private dateBeforeInput: HTMLInputElement;
  private dateAfterInput: HTMLInputElement;
  private searchBtn: HTMLButtonElement;
  private clearAOIBtn: HTMLButtonElement;
  private clipToAOICheckbox: HTMLInputElement;
  private statusMessage: HTMLElement;
  private resultsPanel: HTMLElement;
  private resultsContent: HTMLElement;
  // Sentinel-1 specific controls
  private s1AcquisitionModeSection: HTMLElement;
  private s1AcquisitionModeSelect: HTMLSelectElement;
  private s1PolarizationSection: HTMLElement;
  private s1PolarizationSelect: HTMLSelectElement;

  private onSearch?: (params: SearchParams) => void;
  private onClearAOI?: () => void;

  constructor() {
    // Get DOM elements
    this.sensorSelect = document.getElementById('sensor-select') as HTMLSelectElement;
    this.cloudCoverSection = document.getElementById('cloud-cover-section') as HTMLElement;
    this.cloudCoverInput = document.getElementById('cloud-cover') as HTMLInputElement;
    this.cloudValueDisplay = document.getElementById('cloud-value') as HTMLElement;
    this.dateBeforeInput = document.getElementById('date-before') as HTMLInputElement;
    this.dateAfterInput = document.getElementById('date-after') as HTMLInputElement;
    this.searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
    this.clearAOIBtn = document.getElementById('clear-aoi') as HTMLButtonElement;
    this.clipToAOICheckbox = document.getElementById('clip-to-aoi') as HTMLInputElement;
    this.statusMessage = document.getElementById('status-message') as HTMLElement;
    this.resultsPanel = document.getElementById('results-panel') as HTMLElement;
    this.resultsContent = document.getElementById('results-content') as HTMLElement;
    // Sentinel-1 controls
    this.s1AcquisitionModeSection = document.getElementById('s1-acquisition-mode-section') as HTMLElement;
    this.s1AcquisitionModeSelect = document.getElementById('s1-acquisition-mode') as HTMLSelectElement;
    this.s1PolarizationSection = document.getElementById('s1-polarization-section') as HTMLElement;
    this.s1PolarizationSelect = document.getElementById('s1-polarization') as HTMLSelectElement;

    this.initializeEventListeners();
    this.initializeDates();
    this.updateCloudCoverVisibility();
  }

  private initializeEventListeners(): void {
    // Sensor change
    this.sensorSelect.addEventListener('change', () => {
      this.updateCloudCoverVisibility();
    });

    // Cloud cover slider
    this.cloudCoverInput.addEventListener('input', () => {
      this.cloudValueDisplay.textContent = this.cloudCoverInput.value;
    });

    // Search button
    this.searchBtn.addEventListener('click', () => {
      this.handleSearch();
    });

    // Clear AOI button
    this.clearAOIBtn.addEventListener('click', () => {
      this.onClearAOI?.();
    });
  }

  private initializeDates(): void {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    this.dateBeforeInput.value = this.formatDateInput(oneYearAgo);
    this.dateAfterInput.value = this.formatDateInput(today);
    this.dateBeforeInput.max = this.formatDateInput(today);
    this.dateAfterInput.max = this.formatDateInput(today);
  }

  private formatDateInput(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private updateCloudCoverVisibility(): void {
    const sensor = this.sensorSelect.value;
    if (sensor === 'sentinel-1') {
      this.cloudCoverSection.style.display = 'none';
      this.s1AcquisitionModeSection.style.display = 'block';
      this.s1PolarizationSection.style.display = 'block';
    } else {
      this.cloudCoverSection.style.display = 'block';
      this.s1AcquisitionModeSection.style.display = 'none';
      this.s1PolarizationSection.style.display = 'none';
    }
  }

  private handleSearch(): void {
    const sensor = this.sensorSelect.value as SensorType;
    const beforeDateStr = this.dateBeforeInput.value;
    const afterDateStr = this.dateAfterInput.value;
    
    console.log('Date input values:', { beforeDateStr, afterDateStr });
    
    const beforeDate = new Date(beforeDateStr);
    const afterDate = new Date(afterDateStr);
    
    console.log('Parsed dates:', { beforeDate, afterDate });
    
    const maxCloudCover = parseInt(this.cloudCoverInput.value);
    const clipToAOI = this.clipToAOICheckbox.checked;

    // Get Sentinel-1 specific parameters
    const s1AcquisitionMode = sensor === 'sentinel-1' 
      ? this.s1AcquisitionModeSelect.value as S1AcquisitionMode
      : undefined;
    const s1Polarization = sensor === 'sentinel-1'
      ? this.s1PolarizationSelect.value as S1Polarization
      : undefined;

    // Validation
    if (!this.dateBeforeInput.value || !this.dateAfterInput.value) {
      this.showError('Please select both dates');
      return;
    }

    if (afterDate <= beforeDate) {
      this.showError('After date must be later than before date');
      return;
    }

    // Trigger search callback (AOI will be provided by the map component)
    this.onSearch?.({
      sensor,
      aoi: { west: 0, south: 0, east: 0, north: 0 }, // Will be set by main app
      beforeDate,
      afterDate,
      maxCloudCover,
      clipToAOI,
      s1AcquisitionMode,
      s1Polarization
    });
  }

  /**
   * Enable/disable search button
   */
  setSearchEnabled(enabled: boolean): void {
    this.searchBtn.disabled = !enabled;
  }

  /**
   * Enable/disable clear AOI button
   */
  setClearAOIEnabled(enabled: boolean): void {
    this.clearAOIBtn.disabled = !enabled;
  }

  /**
   * Show info message
   */
  showInfo(message: string): void {
    this.statusMessage.textContent = message;
    this.statusMessage.className = 'status-message info';
  }

  /**
   * Show error message
   */
  showError(message: string): void {
    this.statusMessage.textContent = message;
    this.statusMessage.className = 'status-message error';
  }

  /**
   * Show success message
   */
  showSuccess(message: string): void {
    this.statusMessage.textContent = message;
    this.statusMessage.className = 'status-message success';
  }

  /**
   * Hide status message
   */
  hideStatus(): void {
    this.statusMessage.style.display = 'none';
    this.statusMessage.className = 'status-message';
  }

  /**
   * Show search results
   */
  showResults(beforeDate: string, afterDate: string, beforeId: string, afterId: string): void {
    this.resultsContent.innerHTML = `
      <div class="result-item">
        <div><span class="result-label">Before:</span> ${new Date(beforeDate).toLocaleDateString()}</div>
        <div style="font-size: 11px; color: #888;">${beforeId}</div>
      </div>
      <div class="result-item">
        <div><span class="result-label">After:</span> ${new Date(afterDate).toLocaleDateString()}</div>
        <div style="font-size: 11px; color: #888;">${afterId}</div>
      </div>
    `;
    this.resultsPanel.style.display = 'block';
  }

  /**
   * Hide search results
   */
  hideResults(): void {
    this.resultsPanel.style.display = 'none';
  }

  /**
   * Register search callback
   */
  onSearchClick(callback: (params: SearchParams) => void): void {
    this.onSearch = callback;
  }

  /**
   * Register clear AOI callback
   */
  onClearAOIClick(callback: () => void): void {
    this.onClearAOI = callback;
  }

  /**
   * Get current search parameters (without AOI)
   */
  getSensor(): SensorType {
    return this.sensorSelect.value as SensorType;
  }

  getBeforeDate(): Date {
    return new Date(this.dateBeforeInput.value);
  }

  getAfterDate(): Date {
    return new Date(this.dateAfterInput.value);
  }

  getMaxCloudCover(): number {
    return parseInt(this.cloudCoverInput.value);
  }
}

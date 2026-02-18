# Satellite Imagery Comparison Tool

A web-based before/after satellite imagery comparison tool supporting Sentinel-1 SAR, Sentinel-2 optical, and Landsat 8/9 data. Features interactive split-screen visualization for change detection and temporal analysis.

![Satellite Comparison Tool](https://img.shields.io/badge/Built%20with-TypeScript-blue) ![MapLibre GL JS](https://img.shields.io/badge/MapLibre-GL%20JS-green) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Features

- **Multiple Satellite Sensors**: Support for Sentinel-1 (SAR), Sentinel-2 (optical), and Landsat 8/9
- **Cloud Cover Filtering**: Filter optical imagery by maximum cloud cover percentage
- **Interactive AOI Selection**: Draw rectangles or polygons to define your area of interest
- **Automatic Image Matching**: Finds closest available imagery to selected dates
- **Split-Screen Comparison**: Smooth draggable divider for before/after visualization
- **Cloud-Optimized Imagery**: Streams COG (Cloud Optimized GeoTIFF) data directly from AWS Open Data
- **Responsive Design**: Works on desktop and mobile devices
- **No Backend Required**: Pure client-side application using public STAC APIs

## Technology Stack

- **Framework**: TypeScript with Vite build system
- **Mapping**: MapLibre GL JS v4
- **Drawing Tools**: Geoman Free for MapLibre
- **Data Sources**:
  - AWS Earth Search STAC API (Sentinel-2, Landsat)
  - Copernicus Data Space (Sentinel-1 visualizations)
- **Geospatial**: Turf.js for geometry operations

## Installation

### Prerequisites

- Node.js 18+ and npm

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd satellite-comparison-tool
```

2. Install dependencies:
```bash
npm install
```

3. Start development server:
```bash
npm run dev
```

The application will open in your browser at `http://localhost:3000`.

## Usage

### Basic Workflow

1. **Select Satellite Sensor**
   - Choose from Sentinel-1 (SAR), Sentinel-2 (optical), or Landsat 8/9
   - For optical sensors, optionally set maximum cloud cover threshold

2. **Select Dates**
   - Choose "Before" date for baseline imagery
   - Choose "After" date for comparison imagery
   - Application will find closest available imagery within ±30 days

3. **Draw Area of Interest (AOI)**
   - Use drawing tools in top-left corner
   - Draw a rectangle or polygon over your region of interest
   - AOI will be highlighted in blue

4. **Search Images**
   - Click "Search Images" button
   - Application queries STAC APIs for matching imagery
   - Loading overlay displays progress

5. **Compare Images**
   - Split-screen view automatically loads
   - Drag the white divider left/right to compare before and after
   - View acquisition dates and metadata in bottom panel

### Example Use Cases

#### Hurricane Damage Assessment
- **Location**: Florida coastline
- **Dates**: Before (Sept 26, 2022) / After (Sept 29, 2022)
- **Sensor**: Sentinel-2
- **Cloud Cover**: <20%

#### Flood Monitoring
- **Location**: Major river basins
- **Dates**: Before (dry season) / After (flood event)
- **Sensor**: Sentinel-1 (SAR - works through clouds)

#### Urban Expansion
- **Location**: Growing cities
- **Dates**: 5-year interval
- **Sensor**: Landsat (longer historical archive)

#### Wildfire Analysis
- **Location**: Fire-affected regions
- **Dates**: Pre-fire / Post-fire
- **Sensor**: Sentinel-2 (best resolution)

## Data Sources

### Sentinel-2 (Optical)
- **Provider**: AWS Open Data / Element 84 Earth Search
- **Resolution**: 10m (visible bands)
- **Revisit**: 5 days (2 satellites)
- **Coverage**: Global (land areas)
- **Format**: Cloud-Optimized GeoTIFF (COG)
- **Processing**: Level 2A (surface reflectance)

### Landsat 8/9 (Optical)
- **Provider**: AWS Open Data / USGS
- **Resolution**: 30m (visible/NIR), 15m (panchromatic)
- **Revisit**: 8 days per satellite (16-day combined)
- **Coverage**: Global
- **Format**: Cloud-Optimized GeoTIFF (COG)
- **Processing**: Collection 2 Level 2 (surface reflectance)

### Sentinel-1 (SAR)
- **Provider**: Copernicus Data Space
- **Resolution**: 10m (IW mode)
- **Revisit**: 6 days (2 satellites)
- **Coverage**: Global
- **Format**: Pre-rendered WMS visualizations
- **Note**: Raw SAR processing requires significant preprocessing; this tool uses pre-rendered VH/VV visualizations

## Project Structure

```
satellite-comparison-tool/
├── src/
│   ├── main.ts                    # Main application entry point
│   ├── types.ts                   # TypeScript interfaces
│   ├── styles.css                 # Global styles
│   ├── components/
│   │   ├── controlPanel.ts        # UI controls sidebar
│   │   └── metadataPanel.ts       # Image metadata display
│   ├── map/
│   │   ├── layerManager.ts        # COG/WMS layer handling
│   │   └── splitScreenControl.ts  # Split-screen divider
│   └── services/
│       └── stacService.ts         # STAC API queries
├── index.html                     # HTML template
├── package.json                   # Dependencies
├── tsconfig.json                  # TypeScript config
├── vite.config.ts                 # Vite build config
└── README.md                      # This file
```

## Development

### Build for Production

```bash
npm run build
```

Output in `dist/` directory. Deploy to any static hosting service (Netlify, Vercel, GitHub Pages).

### Type Checking

```bash
npm run typecheck
```

### Preview Production Build

```bash
npm run preview
```

## Known Limitations

### Sentinel-1 Processing
Sentinel-1 SAR data requires significant preprocessing (speckle filtering, radiometric calibration). This tool uses pre-rendered visualizations from Copernicus Data Space for simplicity. For advanced SAR analysis, consider dedicated tools like SNAP or Google Earth Engine.

### CORS Issues
Some STAC endpoints may have CORS restrictions. Current implementation uses:
- AWS Earth Search (CORS-enabled)
- Copernicus Data Space (limited CORS)

If you encounter CORS errors, consider deploying a simple proxy server.

### Search Window
Image search uses ±30 days from target date. If no imagery found, you'll see an error message. Consider:
- Expanding date range
- Reducing cloud cover threshold
- Trying different sensor

### Large AOIs
Very large areas (>50,000 km²) may result in slow searches or timeout errors. For continental/global analysis, consider tile-based approaches or pre-processed datasets.

## Browser Requirements

- **WebGL 2.0**: Required for MapLibre GL JS rendering
- **Modern JavaScript**: ES2022 features (async/await, optional chaining)
- **Recommended Browsers**:
  - Chrome 100+
  - Firefox 100+
  - Safari 15.4+
  - Edge 100+

## API Rate Limits

### AWS Earth Search
- No authentication required
- No explicit rate limits for reasonable use
- Recommended: <100 requests/minute

### Copernicus Data Space
- WMS visualizations: No authentication for viewing
- For production use, consider registering for API key

## Contributing

Contributions welcome! Please open issues for bugs or feature requests.

### Development Priorities
- [ ] Add band combination selector for optical imagery
- [ ] Support for additional sensors (MODIS, Planet)
- [ ] Export comparison as image/GIF
- [ ] Time series animation (>2 images)
- [ ] Offline mode with cached tiles

## License

MIT License - see LICENSE file for details

## Acknowledgments

- **Data Providers**: ESA/Copernicus (Sentinel program), USGS/NASA (Landsat program)
- **Infrastructure**: AWS Open Data, Element 84 Earth Search
- **Inspiration**: [anymap-ts](https://github.com/opengeos/anymap-ts) by OpenGeoHub
- **Mapping**: MapLibre GL JS community

## Support

For questions or issues:
- Open a GitHub issue
- Check existing discussions
- Review STAC API documentation: [stacspec.org](https://stacspec.org)

---

**Built for GIS professionals and remote sensing enthusiasts**

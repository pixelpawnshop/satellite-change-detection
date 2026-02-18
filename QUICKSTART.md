# Quick Start Guide

## Development Server Running

Your satellite comparison tool is now live at: **http://localhost:3000**

## How to Use

### 1. Select Your Sensor
- **Sentinel-2**: Best for optical imagery, 10m resolution
- **Landsat 8/9**: Good for long-term analysis, 30m resolution  
- **Sentinel-1**: SAR (works through clouds), 10m resolution

### 2. Set Cloud Cover (Optical Only)
- Adjust slider for Sentinel-2/Landsat (0-100%)
- Not applicable for Sentinel-1 SAR

### 3. Choose Dates
- **Before Date**: Baseline imagery date
- **After Date**: Comparison imagery date
- App finds closest available imagery within ±30 days

### 4. Draw Area of Interest
- Use the drawing tools in the top-left corner of the map
- Draw a rectangle or polygon over your region
- Keep AOI reasonable sized for best performance

### 5. Search & Compare
- Click "Search Images" button
- Wait for imagery to load
- Drag the white divider to compare before/after

## Example Test Locations

### Florida Hurricane (2022)
- **Location**: Florida coastline (around Fort Myers)
- **Coordinates**: Draw AOI around [-82.0, 26.5] to [-81.5, 27.0]
- **Before**: 2022-09-20
- **After**: 2022-10-01
- **Sensor**: Sentinel-2
- **Cloud**: <30%

### Urban Growth
- **Location**: Dubai, UAE
- **Coordinates**: Draw AOI around [55.0, 24.8] to [55.5, 25.3]
- **Before**: 2020-01-01
- **After**: 2024-01-01
- **Sensor**: Landsat

## Project Structure

```
c:\coding\open/
├── src/
│   ├── main.ts                    # Main app
│   ├── types.ts                   # TypeScript types
│   ├── styles.css                 # Styling
│   ├── components/
│   │   ├── controlPanel.ts        # UI controls
│   │   └── metadataPanel.ts       # Image info display
│   ├── map/
│   │   ├── layerManager.ts        # Image layer handling
│   │   └── splitScreenControl.ts  # Split screen divider
│   └── services/
│       └── stacService.ts         # STAC API queries
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

## Available Commands

```bash
npm run dev        # Start development server (currently running)
npm run build      # Build for production
npm run preview    # Preview production build
npm run typecheck  # Type check without compilation
```

## Data Sources

- **Sentinel-2 & Landsat**: AWS Earth Search (https://earth-search.aws.element84.com)
- **Sentinel-1**: Copernicus Data Space WMS
- **Basemap**: OpenStreetMap

## Known Issues & Tips

### If Search Returns No Results
- Try expanding the date range
- Reduce cloud cover threshold (increase the percentage)
- Try a different sensor
- Ensure AOI isn't too large

### Performance Tips
- Keep AOI under 50,000 km² for best performance
- Sentinel-2 typically has more frequent coverage than Landsat
- Sentinel-1 works in all weather conditions

### Browser Requirements
- Modern browser with WebGL 2 support
- Chrome, Firefox, Safari, or Edge (latest versions)

## Next Steps

1. Open http://localhost:3000 in your browser
2. Test the drawing tools
3. Try a sample search with a known location
4. Experiment with different sensors

## Troubleshooting

**CORS Errors**: Some STAC endpoints may have CORS restrictions. The app uses CORS-enabled endpoints by default.

**Slow Loading**: Large COG files may take time to stream. Progress indicator shows while loading.

**No Imagery Found**: The search window is ±30 days. If no imagery available, you'll see an error message suggesting to expand the range.

---

Built with TypeScript + MapLibre GL JS + Vite

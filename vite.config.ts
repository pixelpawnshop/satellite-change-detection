import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'leaflet': ['leaflet', 'leaflet-draw']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['leaflet', 'leaflet-draw']
  }
});

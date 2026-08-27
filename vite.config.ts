import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'msal': ['@azure/msal-browser', '@azure/msal-react'],
          'maps': ['azure-maps-control'],
          'xlsx': ['xlsx'],
        },
      },
    },
  },
});

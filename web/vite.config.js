import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI lives in web/ and talks to the Express API on 4317. In dev, Vite
// proxies /api through so the frontend never needs to know the port.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 4316,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 4317}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

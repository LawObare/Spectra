import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7860',
        changeOrigin: true,
      },
      '/hips-irsa': {
        target: 'https://irsa.ipac.caltech.edu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hips-irsa/, '/data/hips'),
        secure: false,
      },
    },
  },
});

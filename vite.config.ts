// vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

// Shared headers that enable cross-origin isolation so SharedArrayBuffer works without flags
const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
};

export default defineConfig({
  resolve: {
    alias: {
      '@shared/realearthstreetwar': path.resolve(__dirname, './shared/src/index.ts'),
    },
  },
  server: {
    headers: crossOriginHeaders,
  },
  preview: {
    headers: crossOriginHeaders,
  },
});

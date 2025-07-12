// vite.config.ts
import { defineConfig } from 'vite';

// Shared headers that enable cross-origin isolation so SharedArrayBuffer works without flags
const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
};

export default defineConfig({
  server: {
    headers: crossOriginHeaders,
  },
  preview: {
    headers: crossOriginHeaders,
  },
});

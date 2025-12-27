// Global switches & tweakables for the whole game.
// -----------------------------------------------------------------
export const GTA1_STYLE_TOP_DOWN = true;   // ← flip to false for 3-D mode

// NPC rendering path selection
// - 'webgl': High-performance WebGL instanced rendering (best for Mercator projection)
// - 'canvas': Canvas-based rendering (works with any projection, including Globe)
export const NPC_RENDER_PATH: 'webgl' | 'canvas' = 'canvas';

// Map projection type: 'mercator' (default), 'globe', or 'vertical-perspective'
// Note: MapLibre GL JS v5.6.1 only supports these three projections.
// - 'mercator': Default flat map, consistent movement, best performance
// - 'globe': 3D sphere view, accurate sizes
// - 'vertical-perspective': 3D perspective view (experimental)
// 
// Note: WebGL rendering path works best with 'mercator' projection.
// Canvas rendering path works with any projection.
export const MAP_PROJECTION: 'mercator' | 'globe' | 'vertical-perspective' = 'mercator';

// Toggle developer performance overlay (fps / frame time / CPU)
export const SHOW_PERF_OVERLAY = true;

// Toggle collision bounds visualization (shows collision circles around NPCs)
export const SHOW_COLLISION_BOUNDS = false; // Set to true to enable

// Network configuration
// Vite uses import.meta.env instead of process.env in the browser
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8080';
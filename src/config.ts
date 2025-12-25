// Global switches & tweakables for the whole game.
// -----------------------------------------------------------------
export const GTA1_STYLE_TOP_DOWN = true;   // ← flip to false for 3-D mode
// export const ENABLE_GLOBE = new URLSearchParams(window.location.search).has('globe');
export const ENABLE_GLOBE = true;
// Toggle developer performance overlay (fps / frame time / CPU)
export const SHOW_PERF_OVERLAY = true;
// Toggle collision bounds visualization (shows collision circles around NPCs)
export const SHOW_COLLISION_BOUNDS = false; // Set to true to enable

// Map projection type: 'mercator' (default), 'globe', or 'vertical-perspective'
// Note: MapLibre GL JS v5.6.1 only supports these three projections.
// - 'mercator': Default flat map, consistent movement, best performance
// - 'globe': 3D sphere view, accurate sizes, but falls back to Canvas for NPCs
// - 'vertical-perspective': 3D perspective view (experimental)
export const MAP_PROJECTION: 'mercator' | 'globe' | 'vertical-perspective' = 'mercator';

// Network configuration
// Vite uses import.meta.env instead of process.env in the browser
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8080';
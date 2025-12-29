// Global switches & tweakables for the whole game.
// -----------------------------------------------------------------
export const GTA1_STYLE_TOP_DOWN = true;   // ← flip to false for 3-D mode

// 'dom': DOM-based rendering with CSS transforms (works with any projection, including Globe)
// 'canvas': Canvas-based rendering (works with any projection, including Globe)
// 'webgl': WebGL-based rendering (best performance) (best for Mercator projection)
export const PLAYER_RENDER_PATH: 'dom' | 'canvas' | 'webgl' = 'webgl';
export const NPC_RENDER_PATH: 'dom' | 'canvas' | 'webgl' = 'webgl';

// Note: WebGL rendering path works best with 'mercator' projection.
// Canvas rendering path works with any projection.
export const MAP_PROJECTION: 'mercator' | 'globe' | 'vertical-perspective' = 'mercator';

// Toggle developer performance overlay (fps / frame time / CPU)
export const SHOW_PERF_OVERLAY = true;

// NPC sprite size multiplier (applies to both Canvas and WebGL paths)
// Higher values = larger sprites, lower values = smaller sprites
// Default: 0.06
// 
// Both Canvas and WebGL paths now use the same scaling formula:
// - Reference zoom: 10
// - Scale factor: 1.2
// - Min size: 1px, Max size: 200px
// - Formula: size = baseSize * multiplier * 2^((zoom - 10) / 1.2)
// 
// The multiplier works the same way for both paths, ensuring consistent visual size.
export const NPC_SPRITE_SIZE_MULTIPLIER = 0.06;

// Toggle collision bounds visualization (shows collision circles around NPCs)
export const SHOW_COLLISION_BOUNDS = false; // Set to true to enable

// Toggle building layer visibility
export const SHOW_BUILDINGS = true; // Set to false to hide building footprints (outlines)
export const SHOW_BUILDINGS_3D = true; // Set to false to hide 3D building extrusions

// Network configuration
// Vite uses import.meta.env instead of process.env in the browser
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8080';
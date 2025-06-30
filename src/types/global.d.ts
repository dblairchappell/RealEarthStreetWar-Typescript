declare const pmtiles: any;

// The UMD build of MapLibre loaded in index.html exposes a global `maplibregl`.
// We only need a minimal type for compile-time; import its public types if available.
import type * as _mapLibre from 'maplibre-gl';
declare const maplibregl: typeof _mapLibre; 
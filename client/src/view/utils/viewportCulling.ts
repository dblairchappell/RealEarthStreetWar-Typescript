/**
 * Viewport culling utilities
 * Checks if entities are within the visible map viewport
 */

/**
 * Checks if a lat/lng coordinate is within the visible viewport bounds
 * Includes a padding margin to account for sprites that might be partially visible
 * 
 * @param lng - Longitude in degrees
 * @param lat - Latitude in degrees
 * @param bounds - MapLibre bounds object (from map.getBounds())
 * @param paddingDegrees - Padding in degrees to account for sprite size (default: 0.001)
 * @returns true if entity is visible, false if culled
 */
export function isEntityVisible(
  lng: number,
  lat: number,
  bounds: { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number },
  paddingDegrees: number = 0.001
): boolean {
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  
  // Account for map wrapping at 180/-180 longitude
  // If viewport crosses the date line, we need special handling
  const crossesDateLine = east < west;
  
  if (crossesDateLine) {
    // Viewport spans across the date line (e.g., west = 170, east = -170)
    // Entity is visible if it's in either the western or eastern region
    return (lng >= west || lng <= east) && lat >= south - paddingDegrees && lat <= north + paddingDegrees;
  } else {
    // Normal case: viewport doesn't cross date line
    return lng >= west - paddingDegrees && 
           lng <= east + paddingDegrees && 
           lat >= south - paddingDegrees && 
           lat <= north + paddingDegrees;
  }
}

/**
 * Gets viewport bounds with padding for sprite size
 * 
 * @param map - MapLibre map instance
 * @param spriteSizePixels - Sprite size in pixels
 * @param zoom - Current zoom level
 * @returns Padding in degrees to account for sprite size
 */
export function calculateSpritePaddingDegrees(
  map: any,
  spriteSizePixels: number,
  zoom: number
): number {
  // Convert sprite size from pixels to degrees at current zoom
  // Approximate: 1 degree ≈ 111km, and pixels scale with zoom
  // More accurate: use map's meters per pixel calculation
  const centerLat = map.getCenter().lat;
  const metersPerPixel = 156543.03392 * Math.cos((centerLat * Math.PI) / 180) / Math.pow(2, zoom);
  const spriteSizeMeters = spriteSizePixels * metersPerPixel;
  const spriteSizeDegrees = spriteSizeMeters / 111000; // Convert meters to degrees
  
  // Add some extra padding for safety (50% more)
  return spriteSizeDegrees * 1.5;
}


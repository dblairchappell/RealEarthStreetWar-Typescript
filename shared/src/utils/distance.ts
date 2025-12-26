/**
 * Distance calculation utilities
 * 
 * Provides functions for calculating distances between geographic coordinates
 * and converting between degrees and meters.
 */

/**
 * Calculate distance between two points in degrees
 * Simple Euclidean distance (sufficient for small distances)
 */
export function calculateDistanceDeg(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const lngDiff = lng2 - lng1;
  const latDiff = lat2 - lat1;
  return Math.sqrt(lngDiff * lngDiff + latDiff * latDiff);
}

/**
 * Convert degrees to meters
 * Approximate conversion that accounts for latitude
 * 
 * @param degrees - Distance in degrees
 * @param latitude - Latitude for accurate conversion (degrees vary by latitude)
 * @returns Distance in meters
 */
export function degreesToMeters(degrees: number, latitude: number): number {
  // At equator: 1 degree ≈ 111,320 meters
  // Adjust for latitude (degrees get shorter as you move away from equator)
  const metersPerDegree = 111320 * Math.cos(latitude * Math.PI / 180);
  return degrees * metersPerDegree;
}

/**
 * Convert meters to degrees
 * Approximate conversion that accounts for latitude
 * 
 * @param meters - Distance in meters
 * @param latitude - Latitude for accurate conversion (degrees vary by latitude)
 * @returns Distance in degrees
 */
export function metersToDegrees(meters: number, latitude: number): number {
  // At equator: 1 degree ≈ 111,320 meters
  // Adjust for latitude (degrees get shorter as you move away from equator)
  const metersPerDegree = 111320 * Math.cos(latitude * Math.PI / 180);
  return meters / metersPerDegree;
}

/**
 * Calculate distance between two points in meters
 */
export function calculateDistanceMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const distanceDeg = calculateDistanceDeg(lng1, lat1, lng2, lat2);
  return degreesToMeters(distanceDeg, lat1);
}


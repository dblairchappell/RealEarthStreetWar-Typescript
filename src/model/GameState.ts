// model/GameState.ts
import * as turf from '@turf/turf';

export interface HQPosition { 
  lng: number; 
  lat: number; 
}

export default class GameState {
  /* ----- persistent data ----- */
  bankBalance = 0;
  gameDate: Date = new Date(2023, 0, 1);
  wageOffer = 50;
  maxGangMembers = 0;
  totalResidents = 0;
  hqs: HQPosition[] = [];
  playerUnion: turf.helpers.Polygon | turf.helpers.MultiPolygon | null = null;
  controlledFeatures: turf.helpers.Feature<turf.helpers.LineString>[] = [];
  controlledBuildingIds = new Set<string | number>();
  controlledBuildingFeatures: turf.helpers.Feature<turf.helpers.Polygon>[] = [];
  isPlanting = false;

  /* ----- constants ----- */
  static readonly INFLUENCE_RADIUS_KM = 0.6;
  static readonly INCOME_PER_RESIDENT_PER_DAY = 1;
  static readonly SECONDS_PER_DAY = 1;
  static readonly AREA_PER_RESIDENT = 25;
  static readonly METERS_PER_FLOOR_DEFAULT = 3;
  static readonly MIN_WAGE = 50;
  static readonly PERCENT_PER_INCREMENT = 0.01;

  /* ----- pure helpers ----- */
  computeMaxGangMembers(): number {
    if (this.wageOffer < GameState.MIN_WAGE) return 0;
    const increments = Math.floor((this.wageOffer - GameState.MIN_WAGE) / 10) + 1;
    const willingPercent = increments * GameState.PERCENT_PER_INCREMENT;
    const calc = Math.floor(this.totalResidents * willingPercent);
    return Math.max(1, calc);
  }

  buildingAllowed(point: [number, number]): boolean {
    if (this.hqs.length === 0) {
      return true; // first flag anywhere
    }
    
    const radiusKm = GameState.INFLUENCE_RADIUS_KM;
    
    // Check if point is within influence radius of any existing HQ
    for (let i = 0; i < this.hqs.length; i++) {
      const hqCenter = [this.hqs[i].lng, this.hqs[i].lat];
      const distance = turf.distance(turf.point(point), turf.point(hqCenter), { units: 'kilometers' });
      
      if (distance <= radiusKm) {
        return true;
      }
    }
    
    return false;
  }

  /* ----- geometry utils ----- */
  static pointsEqual(p1: [number, number], p2: [number, number]): boolean {
    const tolerance = 1e-9;
    return Math.abs(p1[0] - p2[0]) < tolerance && Math.abs(p1[1] - p2[1]) < tolerance;
  }

  static dist2(p1: [number, number], p2: [number, number]): number {
    return Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2);
  }

  static pointToSegmentDistance(p: [number, number], p1: [number, number], p2: [number, number]): number {
    const l2 = GameState.dist2(p1, p2);
    if (l2 === 0) return GameState.dist2(p, p1);
    let t = ((p[0] - p1[0]) * (p2[0] - p1[0]) + (p[1] - p1[1]) * (p2[1] - p1[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const projection: [number, number] = [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
    return GameState.dist2(p, projection);
  }
}
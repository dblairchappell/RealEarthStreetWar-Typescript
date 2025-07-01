// model/GameState.ts
import * as turf from '@turf/turf';
import { Polygon, MultiPolygon } from 'geojson';

export type HQType = 'producer' | 'trafficker' | 'retailer';

export interface HQ { 
  id: string;
  lng: number; 
  lat: number;
  type: HQType;
}

export default class GameState {
  /* ----- persistent data ----- */
  hqs: HQ[] = [];
  playerUnion: Polygon | MultiPolygon | null = null;
  plantingType: HQType | null = null;

  commodities = 0;
  money = 1000; // Start with some cash

  /* ----- constants ----- */
  static readonly INFLUENCE_RADIUS_KM = 0.08;
}
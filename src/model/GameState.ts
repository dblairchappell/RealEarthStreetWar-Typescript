// model/GameState.ts
import * as turf from '@turf/turf';
import { Polygon, MultiPolygon } from 'geojson';

export interface HQPosition { 
  lng: number; 
  lat: number; 
}

export default class GameState {
  /* ----- persistent data ----- */
  hqs: HQPosition[] = [];
  playerUnion: Polygon | MultiPolygon | null = null;
  isPlanting = false;

  /* ----- constants ----- */
  static readonly INFLUENCE_RADIUS_KM = 0.6;
}
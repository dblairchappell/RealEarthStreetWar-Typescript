/**
 * Network Message Types
 * 
 * Defines all message types for client-server communication.
 * Messages are JSON-serialized and sent over WebSocket.
 */

import type { InputState } from '../shared/input';
import type { HQ } from '../shared/models';

/**
 * Messages sent from client to server
 */
export type ClientMessage =
  | { type: 'input'; input: InputState }
  | { type: 'spawn_npc'; count: number }
  | { type: 'place_hq'; hq: HQ }
  | { type: 'ping'; timestamp: number };

/**
 * Messages sent from server to client
 */
export type ServerMessage =
  | { type: 'state_snapshot'; state: GameStateSnapshot; timestamp: number }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'pong'; timestamp: number }
  | { type: 'error'; message: string };

/**
 * Snapshot of game state sent to clients
 * Contains all data needed for rendering and gameplay
 */
export interface GameStateSnapshot {
  /** Current game time */
  gameDate: string; // ISO string
  
  /** Player data */
  players: PlayerSnapshot[];
  
  /** NPC data */
  npcs: NpcSnapshot[];
  
  /** Headquarters */
  hqs: HQ[];
  
  /** Resources */
  money: number;
  commodities: number;
}

/**
 * Player state snapshot
 */
export interface PlayerSnapshot {
  /** Unique player identifier */
  id: string;
  
  /** Position */
  lng: number;
  lat: number;
  
  /** Rotation in degrees */
  rotation: number;
  
  /** Whether player is moving */
  isMoving: boolean;
}

/**
 * NPC state snapshot
 */
export interface NpcSnapshot {
  /** Entity ID */
  eid: number;
  
  /** Position */
  lng: number;
  lat: number;
  
  /** Rotation in degrees */
  rotation: number;
  
  /** Velocity */
  velocityX: number;
  velocityY: number;
  
  /** Sprite ID */
  spriteId: number;
}


/**
 * PlayerManager - Manages connected players
 * 
 * Tracks all connected players, their WebSocket connections,
 * and their current input state.
 */

import { WebSocket } from 'ws';
import type { InputState } from '../shared/input';

export interface Player {
  /** Unique player identifier */
  id: string;
  
  /** WebSocket connection */
  ws: WebSocket;
  
  /** Current input state */
  input: InputState;
  
  /** Last ping timestamp */
  lastPing: number;
  
  /** Whether player is connected */
  connected: boolean;
}

/**
 * Manages all connected players
 */
export class PlayerManager {
  private players: Map<string, Player> = new Map();
  private nextPlayerId = 1;

  /**
   * Add a new player connection
   */
  addPlayer(ws: WebSocket): Player {
    const id = `player_${this.nextPlayerId++}`;
    const player: Player = {
      id,
      ws,
      input: {
        forward: false,
        backward: false,
        left: false,
        right: false,
        rotateLeft: false,
        rotateRight: false,
        running: false,
      },
      lastPing: Date.now(),
      connected: true,
    };
    
    this.players.set(id, player);
    console.log(`[PlayerManager] Player ${id} connected`);
    return player;
  }

  /**
   * Remove a player
   */
  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) {
      player.connected = false;
      this.players.delete(id);
      console.log(`[PlayerManager] Player ${id} disconnected`);
    }
  }

  /**
   * Update player input state
   */
  updateInput(playerId: string, input: InputState): void {
    const player = this.players.get(playerId);
    if (player) {
      player.input = input;
    }
  }

  /**
   * Update player ping timestamp
   */
  updatePing(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.lastPing = Date.now();
    }
  }

  /**
   * Get all connected players
   */
  getAllPlayers(): Player[] {
    return Array.from(this.players.values()).filter(p => p.connected);
  }

  /**
   * Get a specific player
   */
  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  /**
   * Get player count
   */
  getPlayerCount(): number {
    return this.players.size;
  }

  /**
   * Broadcast message to all players
   */
  broadcast(message: string): void {
    for (const player of this.players.values()) {
      if (player.connected && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(message);
      }
    }
  }

  /**
   * Send message to specific player
   */
  sendToPlayer(playerId: string, message: string): boolean {
    const player = this.players.get(playerId);
    if (player && player.connected && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
      return true;
    }
    return false;
  }
}


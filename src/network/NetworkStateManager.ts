/**
 * NetworkStateManager - Manages synchronization between server state and client ECS
 * 
 * Applies server state snapshots to the local ECS world and GameState.
 * Handles entity creation/removal, position updates, and state synchronization.
 */

import { GameStateSnapshot, PlayerSnapshot, NpcSnapshot } from './types';
import GameState from '../model/GameState';
import { world, Position, Rotation, Velocity, PlayerTag } from '../ecs/world';
import { NpcTag } from '../ecs/components/NpcTag';
import { SpriteRef } from '../ecs/components/SpriteRef';
import { addComponent, addEntity, defineQuery } from 'bitecs';

/**
 * Manages synchronization of server state to client ECS world
 */
export class NetworkStateManager {
  private gameState: GameState;
  private playerEid: number | null = null;
  private npcEntityMap: Map<number, number> = new Map(); // Maps server eid -> client eid
  private playerQuery = defineQuery([PlayerTag, Position, Rotation]);
  private npcQuery = defineQuery([NpcTag, Position, Rotation, Velocity]);
  private onPlayerEntityCreated?: (eid: number) => void;

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  /**
   * Set callback for when player entity is created
   */
  setOnPlayerEntityCreated(callback: (eid: number) => void): void {
    this.onPlayerEntityCreated = callback;
  }

  /**
   * Set the player entity ID (called when player entity is created locally)
   */
  setPlayerEntity(eid: number): void {
    this.playerEid = eid;
  }

  /**
   * Apply server state snapshot to client
   */
  applySnapshot(snapshot: GameStateSnapshot): void {
    // Update game time directly from server - server is authoritative
    this.gameState.gameDate = new Date(snapshot.gameDate);

    // Update players
    this.updatePlayers(snapshot.players);

    // Update NPCs
    this.updateNpcs(snapshot.npcs);
  }

  /**
   * Update player entities from server snapshot
   */
  private updatePlayers(players: PlayerSnapshot[]): void {
    // For now, handle single player (local player)
    // In multiplayer, we'd iterate through all players
    if (players.length === 0) return;

    const player = players[0]; // Get first player (should be local player)
    
    if (this.playerEid === null) {
      // Create player entity if it doesn't exist
      this.playerEid = addEntity(world);
      addComponent(world, Position, this.playerEid);
      addComponent(world, Rotation, this.playerEid);
      addComponent(world, Velocity, this.playerEid);
      addComponent(world, PlayerTag, this.playerEid);
      addComponent(world, SpriteRef, this.playerEid);
      SpriteRef.id[this.playerEid] = 0;
      
      // Notify that player entity was created
      if (this.onPlayerEntityCreated) {
        this.onPlayerEntityCreated(this.playerEid);
      }
    }

    // Update player position and rotation from server
    const oldLng = Position.x[this.playerEid];
    const oldLat = Position.y[this.playerEid];
    
    Position.x[this.playerEid] = player.lng;
    Position.y[this.playerEid] = player.lat;
    Rotation.angle[this.playerEid] = player.rotation;
    Velocity.x[this.playerEid] = 0; // Server doesn't send velocity for players
    Velocity.y[this.playerEid] = 0;

    // Log if position changed significantly
    if (Math.abs(player.lng - oldLng) > 0.000001 || Math.abs(player.lat - oldLat) > 0.000001) {
      console.log('[NetworkStateManager] Updated player position:', {
        from: { lng: oldLng.toFixed(8), lat: oldLat.toFixed(8) },
        to: { lng: player.lng.toFixed(8), lat: player.lat.toFixed(8) }
      });
    }

    // Update GameState player data
    this.gameState.player.lng = player.lng;
    this.gameState.player.lat = player.lat;
    this.gameState.player.rotation = player.rotation;
    this.gameState.player.isMoving = player.isMoving;
  }

  /**
   * Update NPC entities from server snapshot
   */
  private updateNpcs(npcs: NpcSnapshot[]): void {
    const serverEids = new Set(npcs.map(npc => npc.eid));
    const clientEids = new Set(this.npcEntityMap.values());

    // Remove NPCs that no longer exist on server
    for (const [serverEid, clientEid] of this.npcEntityMap.entries()) {
      if (!serverEids.has(serverEid)) {
        // Entity removed on server - mark for removal
        // Note: bitecs doesn't have removeEntity, so we'll just stop updating it
        // In production, you'd want proper entity removal
        this.npcEntityMap.delete(serverEid);
      }
    }

    // Update or create NPCs
    for (const npc of npcs) {
      let clientEid = this.npcEntityMap.get(npc.eid);

      if (clientEid === undefined) {
        // Create new NPC entity
        clientEid = addEntity(world);
        addComponent(world, Position, clientEid);
        addComponent(world, Rotation, clientEid);
        addComponent(world, Velocity, clientEid);
        addComponent(world, NpcTag, clientEid);
        addComponent(world, SpriteRef, clientEid);
        
        this.npcEntityMap.set(npc.eid, clientEid);
      }

      // Update NPC state from server
      Position.x[clientEid] = npc.lng;
      Position.y[clientEid] = npc.lat;
      Rotation.angle[clientEid] = npc.rotation;
      Velocity.x[clientEid] = npc.velocityX;
      Velocity.y[clientEid] = npc.velocityY;
      SpriteRef.id[clientEid] = npc.spriteId;
    }
  }

  /**
   * Get player entity ID
   */
  getPlayerEntityId(): number | null {
    return this.playerEid;
  }
}


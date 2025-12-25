/**
 * NetworkStateManager - Manages synchronization between server state and client ECS
 * 
 * Applies server state snapshots to the local ECS world and GameState (for non-entity state like gameDate).
 * Handles entity creation/removal, position updates, and state synchronization.
 * 
 * Player and NPC state is stored in ECS components (Position, Rotation, Velocity).
 * Views read directly from ECS for rendering.
 */

import { GameStateSnapshot, PlayerSnapshot, NpcSnapshot } from './types';
import { GameState } from '@shared/realearthstreetwar';
import { world, Position, Rotation, Velocity, PlayerTag } from '../ecs/world';
import { NpcTag, SpriteRef } from '@shared/realearthstreetwar';
import { addComponent, addEntity, defineQuery, removeComponent } from 'bitecs';

/**
 * Manages synchronization of server state to client ECS world
 */
export class NetworkStateManager {
  private gameState: GameState;
  private playerEid: number | null = null;
  private playerEntityCreated = false; // Track if player entity creation callback has been called
  private npcEntityMap: Map<number, number> = new Map(); // Maps server eid -> client eid
  private playerQuery = defineQuery([PlayerTag, Position, Rotation]);
  private npcQuery = defineQuery([NpcTag, Position, Rotation, Velocity]);
  private onPlayerEntityCreated?: (eid: number, playerData: PlayerSnapshot) => void;

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  /**
   * Set callback for when player entity is created
   */
  setOnPlayerEntityCreated(callback: (eid: number, playerData: PlayerSnapshot) => void): void {
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
   * Note: For local player, position is managed by ClientPrediction for client-side prediction.
   * This method only creates the entity if needed; reconciliation happens in GameController.
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
      
      // Set initial position from server
      Position.x[this.playerEid] = player.lng;
      Position.y[this.playerEid] = player.lat;
      Rotation.angle[this.playerEid] = player.rotation;
      Velocity.x[this.playerEid] = 0;
      Velocity.y[this.playerEid] = 0;
    } else {
      // Client-side prediction DISABLED - update position directly from server
      // Server is authoritative for player position
      Position.x[this.playerEid] = player.lng;
      Position.y[this.playerEid] = player.lat;
      Rotation.angle[this.playerEid] = player.rotation;
    }

    // Notify that player entity was created (after position is set)
    // Only call once on first snapshot when entity is newly created
    if (!this.playerEntityCreated && this.onPlayerEntityCreated) {
      this.playerEntityCreated = true;
      this.onPlayerEntityCreated(this.playerEid, player);
    }

    // Player state is now stored only in ECS components (Position, Rotation, Velocity)
    // No need to duplicate in GameState - views read directly from ECS
  }

  /**
   * Update NPC entities from server snapshot
   */
  private updateNpcs(npcs: NpcSnapshot[]): void {
    const serverEids = new Set(npcs.map(npc => npc.eid));

    // Remove NPCs that no longer exist on server
    for (const [serverEid, clientEid] of this.npcEntityMap.entries()) {
      if (!serverEids.has(serverEid)) {
        // Entity removed on server - properly remove all components
        // This removes the entity from ECS queries, so it won't be rendered
        this.removeNpcEntity(clientEid);
        this.npcEntityMap.delete(serverEid);
        console.log(`[NetworkStateManager] Removed NPC entity ${clientEid} (server eid: ${serverEid})`);
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
        console.log(`[NetworkStateManager] Created NPC entity ${clientEid} (server eid: ${npc.eid})`);
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
   * Remove a single NPC entity by removing all its components
   * This effectively removes it from ECS queries, so it won't be rendered
   */
  private removeNpcEntity(clientEid: number): void {
    // Remove all components - this removes the entity from queries
    removeComponent(world, Position, clientEid);
    removeComponent(world, Rotation, clientEid);
    removeComponent(world, Velocity, clientEid);
    removeComponent(world, NpcTag, clientEid);
    removeComponent(world, SpriteRef, clientEid);
  }

  /**
   * Get player entity ID
   */
  getPlayerEntityId(): number | null {
    return this.playerEid;
  }
}


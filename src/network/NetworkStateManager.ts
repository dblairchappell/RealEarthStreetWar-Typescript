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
  private playerEid: number | null = null; // Client entity ID for player
  private playerServerEid: number | null = null; // Server entity ID for player (for mapping)
  private playerId: string | null = null; // Player ID string from server (e.g., "player_1")
  private playerEntityCreated = false; // Track if player entity creation callback has been called
  private npcEntityMap: Map<number, number> = new Map(); // Maps server eid -> client eid
  private npcEntityMapReverse: Map<number, number> = new Map(); // Maps client eid -> server eid (reverse lookup)
  private playerQuery = defineQuery([PlayerTag, Position, Rotation]);
  private npcQuery = defineQuery([NpcTag, Position, Rotation, Velocity]);
  private onPlayerEntityCreated?: (eid: number, playerData: PlayerSnapshot) => void;
  private npcLayer: any = null; // Reference to NpcLayer for speed updates (Canvas path)
  private npcController: any = null; // Reference to NpcController for speed updates (WebGL path)

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  /**
   * Set player ID string (from server, e.g., "player_1")
   */
  setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  /**
   * Set callback for when player entity is created
   */
  setOnPlayerEntityCreated(callback: (eid: number, playerData: PlayerSnapshot) => void): void {
    this.onPlayerEntityCreated = callback;
  }
  
  /**
   * Set reference to NpcLayer for speed updates (Canvas rendering path)
   */
  setNpcLayer(npcLayer: any): void {
    this.npcLayer = npcLayer;
  }

  /**
   * Set reference to NpcController for speed updates (WebGL rendering path)
   */
  setNpcController(npcController: any): void {
    this.npcController = npcController;
  }

  /**
   * Set the player entity ID (called when player entity is created locally)
   * @param eid - Client entity ID
   */
  setPlayerEntity(eid: number): void {
    this.playerEid = eid;
  }

  /**
   * Transfer player control to a different entity (possession)
   * Maps server entity IDs to client entity IDs
   * @param newServerEid - Server entity ID of the new player entity
   * @param oldServerEid - Server entity ID of the old player entity
   */
  transferPlayerEntity(newServerEid: number, oldServerEid: number): void {
    // Find client entity ID for the new server entity ID
    // The new entity should already exist as an NPC in npcEntityMap
    const newClientEid = this.npcEntityMap.get(newServerEid);
    
    if (newClientEid === undefined) {
      console.error(`[NetworkStateManager] Cannot find client entity for server eid ${newServerEid}`);
      return;
    }

    // Convert old player entity to NPC on client side (match server state)
    const oldClientEid = this.playerEid;
    if (oldClientEid !== null) {
      // Remove PlayerTag and add NpcTag to match server state
      removeComponent(world, PlayerTag, oldClientEid);
      addComponent(world, NpcTag, oldClientEid);
      
      // Reset velocity for old player entity (now NPC) - stops any movement
      Velocity.x[oldClientEid] = 0;
      Velocity.y[oldClientEid] = 0;
      
      // Add to npcEntityMap so future NPC updates work correctly
      this.npcEntityMap.set(oldServerEid, oldClientEid);
      this.npcEntityMapReverse.set(oldClientEid, oldServerEid); // Store reverse mapping
      
      console.log(`[NetworkStateManager] Converted old player entity ${oldClientEid} (server ${oldServerEid}) to NPC`);
    }

    // Update player entity tracking
    this.playerEid = newClientEid;
    this.playerServerEid = newServerEid;
    
    // Remove new entity from npcEntityMap (it's now a player, not an NPC)
    this.npcEntityMap.delete(newServerEid);
    this.npcEntityMapReverse.delete(newClientEid); // Remove reverse mapping
    
    // Add PlayerTag and remove NpcTag from new entity (match server state)
    removeComponent(world, NpcTag, newClientEid);
    addComponent(world, PlayerTag, newClientEid);
    
    // Reset velocity for new player entity - stops NPC wandering movement
    Velocity.x[newClientEid] = 0;
    Velocity.y[newClientEid] = 0;
    
    console.log(`[NetworkStateManager] Transferred player entity: ${oldClientEid} (server ${oldServerEid}) -> ${newClientEid} (server ${newServerEid})`);
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
    if (players.length === 0) return;

    // Find the local player by matching player ID string
    // If playerId is not set yet, use first player (for initial connection)
    let player: PlayerSnapshot | null = null;
    if (this.playerId) {
      player = players.find(p => p.id === this.playerId) || null;
    } else {
      // No player ID set yet - use first player (will be set when player_joined message arrives)
      player = players[0];
    }

    if (!player) {
      console.warn('[NetworkStateManager] Local player not found in snapshot');
      return;
    }
    
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
      // Only update if this is still the correct entity (possession might have changed it)
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
        this.npcEntityMapReverse.delete(clientEid); // Remove reverse mapping
        
        // Remove NPC speed (both rendering paths)
        if (this.npcLayer && typeof this.npcLayer.removeNpcSpeed === 'function') {
          this.npcLayer.removeNpcSpeed(clientEid);
        }
        if (this.npcController && typeof this.npcController.removeNpcSpeed === 'function') {
          this.npcController.removeNpcSpeed(clientEid);
        }
        
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
        this.npcEntityMapReverse.set(clientEid, npc.eid); // Store reverse mapping
        //console.log(`[NetworkStateManager] Created NPC entity ${clientEid} (server eid: ${npc.eid})`);
      }

      // Update NPC state from server
      Position.x[clientEid] = npc.lng;
      Position.y[clientEid] = npc.lat;
      Rotation.angle[clientEid] = npc.rotation;
      Velocity.x[clientEid] = npc.velocityX;
      Velocity.y[clientEid] = npc.velocityY;
      SpriteRef.id[clientEid] = npc.spriteId;
      
      // Update NPC speed for animation scaling (both rendering paths)
      if (this.npcLayer && typeof this.npcLayer.updateNpcSpeed === 'function') {
        this.npcLayer.updateNpcSpeed(clientEid, npc.speed);
      }
      if (this.npcController && typeof this.npcController.updateNpcSpeed === 'function') {
        this.npcController.updateNpcSpeed(clientEid, npc.speed);
      }
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
   * Get player entity ID (client entity ID)
   */
  getPlayerEntityId(): number | null {
    return this.playerEid;
  }

  /**
   * Get server entity ID for a client entity ID (for NPCs)
   * Returns null if entity is not found or is a player
   */
  getServerEntityId(clientEid: number): number | null {
    return this.npcEntityMapReverse.get(clientEid) ?? null;
  }
}


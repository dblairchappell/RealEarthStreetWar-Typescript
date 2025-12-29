/**
 * GameWorld - Authoritative game state on server
 * 
 * Maintains the single source of truth for all game state.
 * This is what clients sync to.
 */

import { addComponent, addEntity, createWorld, defineQuery, IWorld, removeComponent } from 'bitecs';
import { Position, Rotation, Velocity, PlayerTag, NpcTag, SpriteRef, entityCollisionSystem, SpatialGrid, GameState, GameStateConstants, calculateDistanceMeters, BuildingCollider, buildingCollisionSystem, buildingCollisionPreventSystem } from '@shared/realearthstreetwar';
import { randomWalkSystem, initializeNpcSpeedMultiplier, getNpcSpeed, cleanupNpcData } from './systems/randomWalkSystem';
import { movementSystem } from './systems/movementSystem';
import { GameStateSnapshot, PlayerSnapshot, NpcSnapshot } from '../network/types';
import { PlayerManager } from '../players/PlayerManager';
import { BuildingDataLoader } from '../data/BuildingDataLoader';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * Authoritative game world running on server
 */
export class GameWorld {
  /** ECS world instance */
  public readonly world = createWorld();
  
  /** Game state */
  public readonly state = new GameState();
  
  /** Spatial grid for collision detection */
  private spatialGrid = new SpatialGrid();
  
  /** Building data loader for building collision detection */
  private buildingLoader: BuildingDataLoader | null = null;
  
  /** Building collider wrapper */
  private buildingCollider: BuildingCollider | null = null;
  
  /** Player entity IDs mapped by player ID */
  private playerEntities: Map<string, number> = new Map();
  
  /** NPC entity IDs */
  private npcEntities: Set<number> = new Set();
  
  /** Queries */
  private playerQuery = defineQuery([PlayerTag, Position, Rotation]);
  private npcQuery = defineQuery([NpcTag, Position, Velocity, Rotation]);

  /** Reference to PlayerManager for accessing input state */
  private playerManager: PlayerManager | null = null;

  constructor() {
    console.log('[GameWorld] Initialized');
    
    // Initialize building loader with local PMTiles file
    try {
      // Get the directory where this file is located (server/src/game/)
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      
      // Try multiple possible paths - server might run from root or server directory
      const possiblePaths = [
        path.join(process.cwd(), 'map_data', 'tiles', 'nj-complete.pmtiles'),
        path.join(process.cwd(), '..', 'map_data', 'tiles', 'nj-complete.pmtiles'),
        path.resolve(__dirname, '..', '..', '..', 'map_data', 'tiles', 'nj-complete.pmtiles'),
      ];
      
      let pmtilesPath: string | null = null;
      for (const testPath of possiblePaths) {
        const resolved = path.resolve(testPath);
        if (fs.existsSync(resolved)) {
          pmtilesPath = resolved;
          break;
        }
      }
      
      if (!pmtilesPath) {
        throw new Error(`PMTiles file not found. Checked paths: ${possiblePaths.map(p => path.resolve(p)).join(', ')}`);
      }
      this.buildingLoader = new BuildingDataLoader(pmtilesPath);
      
      // Create building collider wrapper
      this.buildingCollider = new BuildingCollider(
        (lat: number, lng: number, radiusDegrees?: number) => {
          return this.buildingLoader!.getBuildingsNearPoint(lat, lng, radiusDegrees);
        }
      );
      
      console.log('[GameWorld] Building collision system initialized');
    } catch (error) {
      console.error('[GameWorld] Failed to initialize building collision system:', error);
      console.warn('[GameWorld] Building collision will be disabled');
    }
  }

  /**
   * Set PlayerManager reference (needed to process player input every frame)
   */
  setPlayerManager(playerManager: PlayerManager): void {
    this.playerManager = playerManager;
  }

  /**
   * Create a player entity
   */
  createPlayer(playerId: string, lng: number, lat: number, rotationDeg: number): number {
    const eid = addEntity(this.world);
    addComponent(this.world, Position, eid);
    addComponent(this.world, Rotation, eid);
    addComponent(this.world, Velocity, eid);
    addComponent(this.world, PlayerTag, eid);
    addComponent(this.world, SpriteRef, eid);

    Position.x[eid] = lng;
    Position.y[eid] = lat;
    Rotation.angle[eid] = rotationDeg;
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    SpriteRef.id[eid] = 0;

    this.playerEntities.set(playerId, eid);
    console.log(`[GameWorld] Created player entity ${eid} for player ${playerId}`);
    return eid;
  }

  /**
   * Remove a player entity
   * Note: This is kept for potential future use, but currently not called
   * on disconnect to preserve player position across browser refreshes
   */
  removePlayer(playerId: string): void {
    const eid = this.playerEntities.get(playerId);
    if (eid !== undefined) {
      // Note: bitecs doesn't have removeEntity, so we'll mark as inactive
      // In a production system, you'd want proper entity removal
      this.playerEntities.delete(playerId);
      console.log(`[GameWorld] Removed player entity ${eid} for player ${playerId}`);
    }
  }

  /**
   * Get all player entities (for reconnection logic)
   * Returns the map of playerId -> entityId
   */
  getPlayerEntities(): Map<string, number> {
    return this.playerEntities;
  }

  /**
   * Update player entity mapping (for reconnection)
   * Reuses existing entity instead of creating a new one
   */
  updatePlayerMapping(playerId: string, eid: number): void {
    // Remove old mapping if it exists (for the old player ID)
    for (const [pid, existingEid] of this.playerEntities.entries()) {
      if (existingEid === eid && pid !== playerId) {
        this.playerEntities.delete(pid);
        break;
      }
    }
    
    // Set new mapping
    this.playerEntities.set(playerId, eid);
    console.log(`[GameWorld] Updated player mapping: ${playerId} -> entity ${eid}`);
  }

  /**
   * Transfer player control to a different entity (possession)
   * The current player entity becomes an NPC, and the target entity becomes the player
   */
  transferPossession(playerId: string, targetEid: number): { success: boolean; oldEid?: number; reason?: string } {
    const currentEid = this.playerEntities.get(playerId);
    if (currentEid === undefined) {
      return { success: false, reason: 'Player not found' };
    }

    // Check if target entity exists and has required components
    if (Position.x[targetEid] === undefined || Position.y[targetEid] === undefined) {
      return { success: false, reason: 'Target entity does not exist' };
    }

    // Check if target is already a player (can't possess another player's body)
    // We need to check if targetEid is in playerEntities values
    for (const [pid, eid] of this.playerEntities.entries()) {
      if (eid === targetEid && pid !== playerId) {
        return { success: false, reason: 'Cannot possess another player\'s body' };
      }
    }

    // Check distance (must be within possession range)
    // Use meters-based calculation for accuracy (accounts for latitude)
    const currentLng = Position.x[currentEid];
    const currentLat = Position.y[currentEid];
    const targetLng = Position.x[targetEid];
    const targetLat = Position.y[targetEid];
    
    const distanceMeters = calculateDistanceMeters(currentLng, currentLat, targetLng, targetLat);
    
    if (distanceMeters > GameStateConstants.POSSESSION_RANGE_METERS) {
      return { success: false, reason: `Target entity too far away (${distanceMeters.toFixed(1)}m, max ${GameStateConstants.POSSESSION_RANGE_METERS}m)` };
    }

    // Transfer possession:
    // 1. Remove PlayerTag from current entity, add NpcTag
    removeComponent(this.world, PlayerTag, currentEid);
    addComponent(this.world, NpcTag, currentEid);
    this.npcEntities.add(currentEid);
    // Reset velocity for old player entity (now NPC) - stops any movement
    Velocity.x[currentEid] = 0;
    Velocity.y[currentEid] = 0;

    // 2. Remove NpcTag from target entity (if it has it), add PlayerTag
    if (this.npcEntities.has(targetEid)) {
      removeComponent(this.world, NpcTag, targetEid);
      this.npcEntities.delete(targetEid);
    }
    addComponent(this.world, PlayerTag, targetEid);
    // Reset velocity for new player entity - stops NPC wandering movement
    Velocity.x[targetEid] = 0;
    Velocity.y[targetEid] = 0;

    // 3. Update player entity mapping
    this.playerEntities.set(playerId, targetEid);

    console.log(`[GameWorld] Transferred possession for player ${playerId}: entity ${currentEid} -> ${targetEid}`);
    return { success: true, oldEid: currentEid };
  }

  /**
   * Get current NPC count
   */
  getNpcCount(): number {
    return this.npcEntities.size;
  }

  /**
   * Remove NPCs (removes excess NPCs to match target count)
   */
  removeNpcs(count: number): void {
    if (count <= 0) {
      // Remove all NPCs
      const npcArray = Array.from(this.npcEntities);
      for (const eid of npcArray) {
        this.removeNpcEntity(eid);
      }
      console.log(`[GameWorld] Removed all NPCs`);
      return;
    }

    const currentCount = this.npcEntities.size;
    if (count >= currentCount) {
      console.log(`[GameWorld] No NPCs to remove (current: ${currentCount}, target: ${count})`);
      return;
    }

    const toRemove = currentCount - count;
    const npcArray = Array.from(this.npcEntities);
    
    // Remove NPCs (remove from end of array)
    for (let i = 0; i < toRemove; i++) {
      const eid = npcArray[npcArray.length - 1 - i];
      this.removeNpcEntity(eid);
    }
    
    console.log(`[GameWorld] Removed ${toRemove} NPCs (${currentCount} -> ${count})`);
  }

  /**
   * Remove a single NPC entity by removing all its components
   */
  private removeNpcEntity(eid: number): void {
    // Remove all components - this effectively removes the entity from queries
    removeComponent(this.world, Position, eid);
    removeComponent(this.world, Rotation, eid);
    removeComponent(this.world, Velocity, eid);
    removeComponent(this.world, NpcTag, eid);
    removeComponent(this.world, SpriteRef, eid);
    
    // Clean up random walk system data (prevents memory leak)
    cleanupNpcData(eid);
    
    // Remove from tracking set
    this.npcEntities.delete(eid);
  }

  /**
   * Spawn NPCs
   */
  spawnNpcs(count: number, centerLng: number, centerLat: number, radius: number = 0.001): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      const lng = centerLng + Math.cos(angle) * dist;
      const lat = centerLat + Math.sin(angle) * dist;
      
      const eid = addEntity(this.world);
      addComponent(this.world, Position, eid);
      addComponent(this.world, Rotation, eid);
      addComponent(this.world, Velocity, eid);
      addComponent(this.world, NpcTag, eid);
      addComponent(this.world, SpriteRef, eid);
      
      Position.x[eid] = lng;
      Position.y[eid] = lat;
      Rotation.angle[eid] = 0;
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      SpriteRef.id[eid] = 0;
      
      // Initialize random walk speed multiplier for this NPC
      initializeNpcSpeedMultiplier(eid);
      
      this.npcEntities.add(eid);
      
      // Push NPC out if spawned inside a building (iterative push-out for deep spawns)
      if (this.buildingCollider) {
        (async () => {
          let currentLng = lng;
          let currentLat = lat;
          let attempts = 0;
          const maxAttempts = 10; // Try up to 10 pushes (increased from 5)
          
          while (attempts < maxAttempts) {
            const building = await this.buildingCollider!.checkCollision2D(currentLng, currentLat);
            if (!building) {
              // NPC is outside building - update position and done
              Position.x[eid] = currentLng;
              Position.y[eid] = currentLat;
              break;
            }
            
            // Push out further (with extra multiplier for spawn push-out)
            const pushDir = this.buildingCollider!.findPushDirection(currentLng, currentLat, building);
            // Multiply push distance by 1.5x for spawn push-out to be more aggressive
            currentLng += pushDir.dx * 1.5;
            currentLat += pushDir.dy * 1.5;
            attempts++;
          }
          
          // Final position update (even if still inside, at least we tried)
          Position.x[eid] = currentLng;
          Position.y[eid] = currentLat;
        })().catch(() => {
          // Ignore errors - collision system will handle it next frame
        });
      }
    }
    console.log(`[GameWorld] Spawned ${count} NPCs`);
  }

  /**
   * Adjust NPC count to match target (spawns or removes as needed)
   */
  adjustNpcCount(targetCount: number, centerLng: number, centerLat: number, radius: number = 0.001): void {
    const currentCount = this.npcEntities.size;
    
    if (targetCount > currentCount) {
      // Need to spawn more
      const toSpawn = targetCount - currentCount;
      this.spawnNpcs(toSpawn, centerLng, centerLat, radius);
    } else if (targetCount < currentCount) {
      // Need to remove some
      this.removeNpcs(targetCount);
    }
    // If equal, do nothing
  }

  /**
   * Update player movement based on input (legacy method, kept for compatibility)
   * Input is now stored in PlayerManager and processed every frame in fixedUpdate()
   */
  updatePlayerMovement(playerId: string, input: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    running: boolean;
  }): void {
    // This method is kept for compatibility but input is now processed in fixedUpdate()
  }

  /**
   * Process player movement based on stored input state (called every frame)
   */
  private async processPlayerMovement(playerId: string, input: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    running: boolean;
  }): Promise<void> {
    const eid = this.playerEntities.get(playerId);
    if (eid === undefined) return;

    const deltaSec = 1 / 60; // Fixed timestep

    // Handle rotation
    if (input.rotateLeft) {
      Rotation.angle[eid] -= GameStateConstants.PLAYER_ROTATION_SPEED * deltaSec;
      Rotation.angle[eid] = ((Rotation.angle[eid] % 360) + 360) % 360;
    }
    
    if (input.rotateRight) {
      Rotation.angle[eid] += GameStateConstants.PLAYER_ROTATION_SPEED * deltaSec;
      Rotation.angle[eid] = ((Rotation.angle[eid] % 360) + 360) % 360;
    }

    // Handle movement
    if (input.forward || input.backward || input.left || input.right) {
      const radians = (Rotation.angle[eid] * Math.PI) / 180;
      const moveSpeedDegPerSec = input.running 
        ? GameStateConstants.PLAYER_RUN_SPEED 
        : GameStateConstants.PLAYER_MOVE_SPEED;
      const step = moveSpeedDegPerSec * deltaSec;
      
      let deltaLat = 0;
      let deltaLng = 0;
      
      // Geographic coordinate system: 0° = north
      // Forward should move in the direction the player is facing
      // If player faces north (0°), forward should move north (positive lat)
      // cos(0°) = 1, sin(0°) = 0, so deltaLat = step, deltaLng = 0 ✓
      if (input.forward) {
        // Forward moves in the direction the player is facing
        deltaLat += Math.cos(radians) * step;
        deltaLng += Math.sin(radians) * step;
      }
      
      if (input.backward) {
        // Backward moves opposite to facing direction
        deltaLat -= Math.cos(radians) * step;
        deltaLng -= Math.sin(radians) * step;
      }
      
      if (input.left) {
        const strafeRadians = radians - Math.PI / 2;
        deltaLat += Math.cos(strafeRadians) * step;
        deltaLng += Math.sin(strafeRadians) * step;
      }
      
      if (input.right) {
        const strafeRadians = radians + Math.PI / 2;
        deltaLat += Math.cos(strafeRadians) * step;
        deltaLng += Math.sin(strafeRadians) * step;
      }
      
      const latRadians = (Position.y[eid] * Math.PI) / 180;
      const correctedLng = deltaLng / Math.cos(latRadians);

      // Check for building collision and slide along wall if needed
      if (this.buildingCollider) {
        try {
          const intendedLng = Position.x[eid] + correctedLng;
          const intendedLat = Position.y[eid] + deltaLat;
          
          const building = await this.buildingCollider.checkCollision2D(intendedLng, intendedLat);
          
          if (building) {
            // Get push direction (normal to wall)
            const pushDir = this.buildingCollider.findPushDirection(intendedLng, intendedLat, building);
            
            // Project movement onto wall for sliding
            const slide = this.buildingCollider.projectOntoWall(
              correctedLng,
              deltaLat,
              pushDir.dx,
              pushDir.dy
            );
            
            // Apply sliding movement instead of original movement
            Position.x[eid] += slide.slideX;
            Position.y[eid] += slide.slideY;
            return; // Don't apply original movement
          }
        } catch (error) {
          console.error('[GameWorld] Error checking building collision:', error);
        }
      }

      // Normal movement if no collision
      Position.x[eid] += correctedLng;
      Position.y[eid] += deltaLat;
    }
  }

  /**
   * Run one fixed-timestep update
   */
  async fixedUpdate(): Promise<void> {
    // Update game time
    // Game time advances MINUTES_PER_TICK minutes per second of real time
    // Server runs at 60Hz, so per frame: (MINUTES_PER_TICK * 60 * 1000) / 60 ms
    const msPerFrame = GameStateConstants.MINUTES_PER_TICK * 1000; // ms of game time per frame
    this.state.gameDate.setTime(this.state.gameDate.getTime() + msPerFrame);

    // Process player movement based on stored input state
    if (this.playerManager) {
      const players = this.playerManager.getAllPlayers();
      for (const player of players) {
        await this.processPlayerMovement(player.id, player.input);
      }
    }

    // Run NPC systems
    randomWalkSystem(this.world);
    
    // Get all entities for collision detection (players + NPCs)
    const npcEnts = this.npcQuery(this.world);
    const playerEnts = this.playerQuery(this.world);
    
    // Combine player and NPC entities for collision detection
    // Both players and NPCs have Position, Velocity components (required for collision)
    const allCollidableEntities: number[] = [...playerEnts, ...npcEnts];
    
    // Check building collision BEFORE movement to prevent entities from entering buildings
    // This adjusts velocity to slide along walls instead of moving into buildings
    if (this.buildingCollider && this.buildingLoader) {
      try {
        await buildingCollisionPreventSystem(
          allCollidableEntities,
          this.buildingCollider,
          Position,
          Velocity,
          undefined, // Altitude component - undefined means 2D collision (ground level)
          Rotation, // Rotation component - allows NPCs to change direction when colliding
          NpcTag // NpcTag component - allows distinguishing NPCs from players
        );
      } catch (error) {
        console.error('[GameWorld] Error in building collision prevent system:', error);
      }
    }
    
    // Apply movement with adjusted velocities
    movementSystem(this.world);
    
    // Rebuild spatial grid with all collidable entities (after movement)
    this.spatialGrid.rebuild(allCollidableEntities, Position);
    
    // Run entity-to-entity collision detection (players + NPCs)
    entityCollisionSystem(allCollidableEntities, this.spatialGrid, Position, Velocity);
    
    // Run building collision detection as a safety net (corrects any entities that still ended up inside)
    // This shouldn't happen if preventSystem works correctly, but provides a fallback
    if (this.buildingCollider && this.buildingLoader) {
      try {
        await buildingCollisionSystem(
          allCollidableEntities,
          this.buildingCollider,
          Position,
          Velocity,
          undefined, // Altitude component - undefined means 2D collision (ground level)
          Rotation, // Rotation component - allows NPCs to change direction when colliding
          NpcTag // NpcTag component - allows distinguishing NPCs from players
        );
      } catch (error) {
        console.error('[GameWorld] Error in building collision system:', error);
      }
    }
  }

  /**
   * Create a snapshot of current game state
   */
  createSnapshot(): GameStateSnapshot {
    const players: PlayerSnapshot[] = [];
    const npcs: NpcSnapshot[] = [];

    // Collect player data
    const playerEnts = this.playerQuery(this.world);
    for (const eid of playerEnts) {
      // Find player ID for this entity
      let playerId = '';
      for (const [pid, peid] of this.playerEntities.entries()) {
        if (peid === eid) {
          playerId = pid;
          break;
        }
      }
      
      if (playerId) {
        players.push({
          id: playerId,
          lng: Position.x[eid],
          lat: Position.y[eid],
          rotation: Rotation.angle[eid],
          isMoving: Math.abs(Velocity.x[eid]) > 0.0000001 || Math.abs(Velocity.y[eid]) > 0.0000001,
        });
      }
    }

    // Collect NPC data
    const npcEnts = this.npcQuery(this.world);
    for (const eid of npcEnts) {
      npcs.push({
        eid,
        lng: Position.x[eid],
        lat: Position.y[eid],
        rotation: Rotation.angle[eid],
        velocityX: Velocity.x[eid],
        velocityY: Velocity.y[eid],
        spriteId: SpriteRef.id[eid],
        speed: getNpcSpeed(eid),
      });
    }

    return {
      gameDate: this.state.gameDate.toISOString(),
      players,
      npcs,
    };
  }
}


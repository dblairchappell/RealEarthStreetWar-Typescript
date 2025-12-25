// controller/GameController.ts
import { GameState } from "@shared/realearthstreetwar";
import MapView from "../view/MapView";
import { FixedUpdatable } from "../loop/GameLoop";
import { NetworkStateManager } from "../network/NetworkStateManager";
import { Position, Rotation } from "../ecs/world";

export default class GameController implements FixedUpdatable {
  private networkStateManager: NetworkStateManager;

  constructor(private state: GameState, private view: MapView) {
    this.networkStateManager = new NetworkStateManager(state);
    
    // Set up callback for when player entity is created by network state manager
    this.networkStateManager.setOnPlayerEntityCreated((eid: number, playerData) => {
      // Update view with player entity
      this.view.setPlayerEntity(eid);
      
      // Use player data from snapshot (has correct position)
      // Don't read from ECS components as they may not be updated yet
      const lng = playerData.lng;
      const lat = playerData.lat;
      const rotDeg = playerData.rotation;
      
      // Convert rotation from degrees to radians (Rotation.angle stores degrees)
      const rotRad = (rotDeg * Math.PI) / 180;
      
      // Create visual representation of player character
      // This triggers the cinematic camera swoop-in effect
      this.view.createPlayerCharacter(
        { lng, lat },
        rotRad
      );
    });
  }

  // legacy update kept empty (required by Updatable interface users)
  public update(_deltaMs: number): void {}

  // Fixed-step update (60 Hz)
  // Note: With server-side simulation, this is mainly for UI updates
  // Game state is updated via applyServerState() when snapshots arrive
  public fixedUpdate(): void {
    // Game time is updated directly from server snapshots - no local calculation needed
  }

  /**
   * Handle player input - sends to server instead of processing locally
   * The server will process movement and send back state snapshots
   */
  public handlePlayerInput(input: { 
    forward: boolean, 
    backward: boolean, 
    left: boolean, 
    right: boolean,
    rotateLeft: boolean,
    rotateRight: boolean,
    running: boolean
  }) {
    // Don't modify state locally - server is authoritative
    // Input is sent to server via GameClient (handled in main.ts)
    // Server processes movement and sends back state snapshots
  }

  /**
   * Apply server state snapshot to local game state and ECS
   */
  public applyServerState(snapshot: any): void {
    this.networkStateManager.applySnapshot(snapshot);
  }

  /**
   * Get the network state manager (for setting player entity ID)
   */
  public getNetworkStateManager(): NetworkStateManager {
    return this.networkStateManager;
  }
}
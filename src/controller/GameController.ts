// controller/GameController.ts
import { GameState } from "@shared/realearthstreetwar";
import MapView from "../view/MapView";
import { FixedUpdatable } from "../loop/GameLoop";
import { NetworkStateManager } from "../network/NetworkStateManager";
import { ClientPrediction } from "../network/ClientPrediction";
import { Position, Rotation } from "../ecs/world";

export default class GameController implements FixedUpdatable {
  private networkStateManager: NetworkStateManager;
  private clientPrediction: ClientPrediction;

  constructor(private state: GameState, private view: MapView) {
    this.networkStateManager = new NetworkStateManager(state);
    this.clientPrediction = new ClientPrediction();
    
    // Set up callback for when player entity is created by network state manager
    this.networkStateManager.setOnPlayerEntityCreated((eid: number, playerData) => {
      // Set up client prediction for this player entity
      this.clientPrediction.setPlayerEntity(eid);
      
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
  // Process client-side prediction for local player movement
  public fixedUpdate(): void {
    // Process client-side prediction every fixed timestep
    // This matches the server's fixed timestep processing
    // Movement is processed based on stored input state, matching server behavior
    this.clientPrediction.fixedUpdate();
  }

  /**
   * Handle player input - stores input state for client-side prediction
   * and sends to server for authoritative processing
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
    // Store input state for fixed timestep processing
    // Movement will be processed every fixed timestep in fixedUpdate()
    // This matches server behavior and eliminates jitter
    const sequence = this.clientPrediction.storeInput(input);
    
    // Input is also sent to server via GameClient (handled in main.ts)
    // Server will process and send back authoritative state
    // ClientPrediction will reconcile when server state arrives
  }

  /**
   * Apply server state snapshot to local game state and ECS
   * Reconciles client-side prediction with server-authoritative state
   */
  public applyServerState(snapshot: any): void {
    // Apply snapshot to ECS (updates NPCs and other players)
    this.networkStateManager.applySnapshot(snapshot);
    
    // Reconcile local player prediction with server state
    // NOTE: Reconciliation is only enabled for catastrophic errors (>1km or >90° rotation)
    // Normal movement differences due to network latency are ignored to prevent rubber-banding
    if (snapshot.players && snapshot.players.length > 0) {
      const player = snapshot.players[0];
      this.clientPrediction.reconcile(player.lng, player.lat, player.rotation);
    }
  }

  /**
   * Get the network state manager (for setting player entity ID)
   */
  public getNetworkStateManager(): NetworkStateManager {
    return this.networkStateManager;
  }
}
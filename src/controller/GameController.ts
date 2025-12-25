// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";
import { FixedUpdatable } from "../loop/GameLoop";
import { NetworkStateManager } from "../network/NetworkStateManager";
import { Position, Rotation } from "../ecs/world";

export default class GameController implements FixedUpdatable {
  private networkStateManager: NetworkStateManager;

  constructor(private state: GameState, private view: MapView) {
    this.networkStateManager = new NetworkStateManager(state);
    
    // Set up callback for when player entity is created by network state manager
    this.networkStateManager.setOnPlayerEntityCreated((eid: number) => {
      // Update view with player entity
      this.view.setPlayerEntity(eid);
      
      // Create visual representation of player character
      this.view.createPlayerCharacter(
        { lng: Position.x[eid], lat: Position.y[eid] },
        Rotation.angle[eid]
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
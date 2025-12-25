// controller/GameController.ts
import { GameState, GameStateConstants } from "@shared/realearthstreetwar";
import MapView from "../view/MapView";
import { FixedUpdatable } from "../loop/GameLoop";
import { NetworkStateManager } from "../network/NetworkStateManager";
import { ClientPrediction } from "../network/ClientPrediction";
import { Position, Rotation } from "../ecs/world";
import { EntityInfo } from "../view/EntityClickHandler";
import HUDView from "../view/HUDView";

export default class GameController implements FixedUpdatable {
  private networkStateManager: NetworkStateManager;
  private clientPrediction: ClientPrediction;
  private hud: HUDView | null = null;

  constructor(private state: GameState, private view: MapView) {
    this.networkStateManager = new NetworkStateManager(state);
    this.clientPrediction = new ClientPrediction();
    
    // Set up callback for when player entity is created by network state manager
    this.networkStateManager.setOnPlayerEntityCreated((eid: number, playerData) => {
      // Client-side prediction disabled - no need to set up prediction
      // this.clientPrediction.setPlayerEntity(eid);
      
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

    // Set up entity click handler callbacks
    // Note: EntityClickHandler will be created in MapView after map loads
    // These callbacks will be registered when the handler is set up
  }

  // legacy update kept empty (required by Updatable interface users)
  public update(_deltaMs: number): void {}

  // Fixed-step update (60 Hz)
  // Client-side prediction DISABLED - using server-authoritative movement only
  public fixedUpdate(): void {
    // Client-side prediction disabled to prevent rubber-banding
    // Player position is updated directly from server snapshots
    // this.clientPrediction.fixedUpdate();
  }

  /**
   * Handle player input - sends to server for authoritative processing
   * Client-side prediction DISABLED - server is authoritative
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
    // Client-side prediction disabled - input is sent to server only
    // Server processes movement and sends back authoritative state
    // Player position is updated directly from server snapshots
    // this.clientPrediction.storeInput(input);
    
    // Input is sent to server via GameClient (handled in main.ts)
    // Server will process and send back authoritative state
  }

  /**
   * Apply server state snapshot to local game state and ECS
   * Client-side prediction DISABLED - server state is authoritative
   */
  public applyServerState(snapshot: any): void {
    // Apply snapshot to ECS (updates NPCs, other players, and local player)
    // NetworkStateManager now updates player position directly from server snapshots
    this.networkStateManager.applySnapshot(snapshot);
    
    // Client-side prediction disabled - no reconciliation needed
    // Player position is updated directly from server snapshots in NetworkStateManager
    // if (snapshot.players && snapshot.players.length > 0) {
    //   const player = snapshot.players[0];
    //   this.clientPrediction.reconcile(player.lng, player.lat, player.rotation);
    // }
  }

  /**
   * Get the network state manager (for setting player entity ID)
   */
  public getNetworkStateManager(): NetworkStateManager {
    return this.networkStateManager;
  }

  /**
   * Set HUD view reference
   */
  public setHUDView(hud: HUDView): void {
    this.hud = hud;
    
    // Set up HUD callbacks
    hud.setCallbacks({
      onVacateBody: () => this.handleVacateBody(),
      onPossessBody: (entityId: number) => this.handlePossessBody(entityId),
      onCommandMenu: () => this.handleCommandMenu(),
    });
  }

  /**
   * Handle occupant clicked - show occupant info panel
   * Called by EntityClickHandler when current occupant is clicked
   */
  public handleOccupantClicked(eid: number, info: EntityInfo): void {
    console.log('[GameController] Occupant clicked:', eid, info);
    
    if (this.hud) {
      // TODO: Get current command from entity (will be implemented when command system is added)
      const currentCommand = 'None'; // Placeholder
      this.hud.showOccupantPanel(eid, info, currentCommand);
    }
  }

  /**
   * Handle NPC clicked - show NPC info panel
   * Called by EntityClickHandler when NPC is clicked
   */
  public handleNpcClicked(eid: number, info: EntityInfo, distanceMeters: number): void {
    console.log('[GameController] NPC clicked:', eid, info, `Distance: ${distanceMeters.toFixed(2)}m`);
    
    // Set selected NPC for visual feedback (red outline)
    console.log('[GameController] Setting selected NPC to:', eid);
    this.view.setSelectedNpc(eid);
    
    if (this.hud) {
      // Check if NPC is within possession range
      const inRange = distanceMeters <= GameStateConstants.POSSESSION_RANGE_METERS;
      
      this.hud.showNpcPanel(eid, info, distanceMeters, inRange);
    }
  }

  /**
   * Handle empty click - dismiss any open panels
   * Called by EntityClickHandler when clicking on empty map
   */
  public handleEmptyClick(): void {
    console.log('[GameController] Empty space clicked');
    
    // Clear selected NPC visual feedback
    this.view.setSelectedNpc(null);
    
    if (this.hud) {
      this.hud.hideEntityPanel();
    }
  }

  /**
   * Handle vacate body button clicked
   */
  private handleVacateBody(): void {
    console.log('[GameController] Vacate body requested');
    // TODO: Implement vacate body logic
    // This will send a message to server to vacate current body
  }

  /**
   * Handle possess body button clicked
   */
  private handlePossessBody(entityId: number): void {
    console.log('[GameController] Possess body requested:', entityId);
    // TODO: Implement possess body logic
    // This will send a message to server to possess the target entity
  }

  /**
   * Handle command menu button clicked
   */
  private handleCommandMenu(): void {
    console.log('[GameController] Command menu requested');
    // TODO: Show command menu/UI
    // This will be implemented when command system is added
  }
}
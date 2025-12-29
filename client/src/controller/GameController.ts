// controller/GameController.ts
import { GameState, GameStateConstants } from "@shared/realearthstreetwar";
import MapView from "../view/MapView";
import { FixedUpdatable } from "../loop/GameLoop";
import { NetworkStateManager } from "../network/NetworkStateManager";
import { ClientPrediction } from "../network/ClientPrediction";
import { Position, Rotation } from "../ecs/world";
import { EntityInfo } from "../view/EntityClickHandler";
import HUDView from "../view/HUDView";
import { GameClient } from "../network/GameClient";

export default class GameController implements FixedUpdatable {
  private networkStateManager: NetworkStateManager;
  private clientPrediction: ClientPrediction;
  private hud: HUDView | null = null;
  private gameClient: GameClient | null = null;

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
      onPossessBody: (entityId: number) => this.handlePossessBody(entityId),
      onCommandMenu: () => this.handleCommandMenu(),
    });

    // Set callback for HUD to get player entity ID for distance calculations
    hud.setGetPlayerEntityIdCallback(() => {
      return this.networkStateManager.getPlayerEntityId();
    });
  }

  /**
   * Set GameClient reference for sending messages
   * Note: Callbacks are merged with existing callbacks, not replaced
   */
  public setGameClient(gameClient: GameClient): void {
    this.gameClient = gameClient;
    
    // Add possession callbacks (merged with existing callbacks from main.ts)
    gameClient.setCallbacks({
      onPossessionTransferred: (newEntityId: number, oldEntityId: number) => {
        this.handlePossessionTransferred(newEntityId, oldEntityId);
      },
      onPossessionFailed: (reason: string) => {
        this.handlePossessionFailed(reason);
      },
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
   * Note: eid is client entity ID, we need to convert to server entity ID for possession
   */
  public handleNpcClicked(eid: number, info: EntityInfo, distanceMeters: number): void {
    console.log('[GameController] NPC clicked (client eid):', eid, info, `Distance: ${distanceMeters.toFixed(2)}m`);
    
    // Set selected NPC for visual feedback (red outline)
    console.log('[GameController] Setting selected NPC to:', eid);
    this.view.setSelectedNpc(eid);
    
    if (this.hud) {
      // Check if NPC is within possession range
      const inRange = distanceMeters <= GameStateConstants.POSSESSION_RANGE_METERS;
      
      // Get server entity ID for this client entity ID
      const serverEid = this.networkStateManager.getServerEntityId(eid);
      if (serverEid === null) {
        console.error(`[GameController] Cannot find server entity ID for client eid ${eid}`);
        // Still show panel but disable possess button
        this.hud.showNpcPanel(eid, info, distanceMeters, false);
        return;
      }
      
      console.log(`[GameController] NPC clicked - client eid: ${eid}, server eid: ${serverEid}`);
      
      // Store server entity ID in HUD (will be used when possess button is clicked)
      // Pass server eid for possession, but use client eid for display
      this.hud.showNpcPanel(serverEid, info, distanceMeters, inRange);
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
   * Handle possess body button clicked
   * When possessing a new body, the current body is automatically vacated (becomes an NPC)
   * Note: entityId is the server entity ID (stored in HUD panel)
   */
  private handlePossessBody(entityId: number): void {
    console.log('[GameController] Possess body requested (server eid):', entityId);
    
    if (!this.gameClient || !this.gameClient.isConnected()) {
      console.warn('[GameController] Cannot possess body - not connected to server');
      if (this.hud) {
        // Show error in HUD (could add an error display method)
        alert('Cannot possess body - not connected to server');
      }
      return;
    }
    
    // Send possession request to server with server entity ID
    this.gameClient.sendMessage({
      type: 'possess_entity',
      targetEid: entityId,
    });
  }

  /**
   * Handle successful possession transfer from server
   * Note: newEntityId and oldEntityId are SERVER entity IDs, not client entity IDs
   */
  private handlePossessionTransferred(newEntityId: number, oldEntityId: number): void {
    console.log(`[GameController] Possession transferred (server eids): ${oldEntityId} -> ${newEntityId}`);
    
    // Transfer player entity in NetworkStateManager (maps server eids to client eids)
    this.networkStateManager.transferPlayerEntity(newEntityId, oldEntityId);
    
    // Get the new client entity ID
    const newClientEid = this.networkStateManager.getPlayerEntityId();
    
    if (newClientEid === null) {
      console.error('[GameController] Failed to get new player entity ID after possession transfer');
      return;
    }
    
    // Update view with new player entity (client entity ID)
    this.view.setPlayerEntity(newClientEid);
    
    // Read position from ECS to update sprite immediately
    // Note: This position might be from the NPC snapshot before possession transfer
    // The next server snapshot will update it to the correct player position
    const lng = Position.x[newClientEid];
    const lat = Position.y[newClientEid];
    const rotDeg = Rotation.angle[newClientEid];
    const rotRad = (rotDeg * Math.PI) / 180;
    
    // Reset interpolation state to prevent drift from stale prevPosition
    // This ensures the sprite immediately snaps to the new entity's position
    // We set both prevPosition and playerPosition to the same value so interpolation
    // doesn't cause movement until the next server snapshot updates the position
    this.view.resetInterpolationState({ lng, lat }, rotRad);
    
    // Update character sprite position (without camera swoop)
    // This ensures the sprite is immediately visible at the correct location
    this.view.updatePlayerPosition({ lng, lat }, rotRad, false);
    
    // Smoothly transition camera to new player position
    // This provides a smooth camera movement instead of instant snap
    this.view.smoothTransitionCameraToPlayer(2000); // 2 second transition
    
    // Note: The next server snapshot will update the ECS position via updatePlayers(),
    // and then update() will read it and update playerPosition, and render() will
    // interpolate smoothly between the reset position and the new position
    
    // Hide HUD panel
    if (this.hud) {
      this.hud.hideEntityPanel();
    }
    
    // Clear selected NPC visual feedback
    this.view.setSelectedNpc(null);
  }

  /**
   * Handle failed possession transfer from server
   */
  private handlePossessionFailed(reason: string): void {
    console.warn(`[GameController] Possession failed: ${reason}`);
    
    // Show error to user
    alert(`Cannot possess body: ${reason}`);
    
    // Hide HUD panel
    if (this.hud) {
      this.hud.hideEntityPanel();
    }
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
// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";

export default class GameController {
  private gameClockTimer: number | null = null;
  private movementTimer: number | null = null;
  // Update the input handling method
  private currentInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
    running: false
  };

  constructor(private state: GameState, private view: MapView) {
  }

  public startClock() {
    if (this.gameClockTimer) return; // Prevent multiple timers
    this.gameClockTimer = window.setInterval(() => {
      this.tickClock();
    }, GameState.GAME_TICK_MS);
  }

  public startMovementLoop() {
    if (this.movementTimer) return; // Prevent multiple timers
    
    // 60 FPS movement updates
    this.movementTimer = window.setInterval(() => {
      this.updatePlayerMovement();
    }, 1000 / 60);
  }

  private tickClock() {
    this.state.gameDate.setMinutes(this.state.gameDate.getMinutes() + GameState.MINUTES_PER_TICK);
    this.updateView();
  }

  public handlePlayerInput(input: { 
    forward: boolean, 
    backward: boolean, 
    left: boolean, 
    right: boolean,
    rotateLeft: boolean,
    rotateRight: boolean,
    running: boolean
  }) {
    this.currentInput = { ...input };
    this.state.player.isMoving = input.forward || input.backward || input.left || input.right;
  }

  // Update the movement logic
  private updatePlayerMovement() {
    let positionChanged = false;
    let rotationChanged = false;

    // Handle rotation (shift+left/right arrows)
    if (this.currentInput.rotateLeft) {
      this.state.player.rotation -= GameState.PLAYER_ROTATION_SPEED;
      if (this.state.player.rotation < 0) {
        this.state.player.rotation += 360;
      }
      rotationChanged = true;
    }
    
    if (this.currentInput.rotateRight) {
      this.state.player.rotation += GameState.PLAYER_ROTATION_SPEED;
      if (this.state.player.rotation >= 360) {
        this.state.player.rotation -= 360;
      }
      rotationChanged = true;
    }

    // Handle movement (forward/backward and strafing)
    if (this.currentInput.forward || this.currentInput.backward || this.currentInput.left || this.currentInput.right) {
      const radians = (this.state.player.rotation * Math.PI) / 180;
      
      // Choose speed based on whether player is running
      const moveSpeed = this.currentInput.running ? GameState.PLAYER_RUN_SPEED : GameState.PLAYER_MOVE_SPEED;
      
      let deltaLat = 0;
      let deltaLng = 0;
      
      // Forward/backward movement
      if (this.currentInput.forward) {
        deltaLat += Math.cos(radians) * moveSpeed;
        deltaLng += Math.sin(radians) * moveSpeed;
      }
      
      if (this.currentInput.backward) {
        deltaLat -= Math.cos(radians) * moveSpeed;
        deltaLng -= Math.sin(radians) * moveSpeed;
      }
      
      // Strafing movement (perpendicular to facing direction)
      if (this.currentInput.left) {
        // Strafe left is 90 degrees counter-clockwise from facing direction
        const strafeRadians = radians - Math.PI / 2;
        deltaLat += Math.cos(strafeRadians) * moveSpeed;
        deltaLng += Math.sin(strafeRadians) * moveSpeed;
      }
      
      if (this.currentInput.right) {
        // Strafe right is 90 degrees clockwise from facing direction
        const strafeRadians = radians + Math.PI / 2;
        deltaLat += Math.cos(strafeRadians) * moveSpeed;
        deltaLng += Math.sin(strafeRadians) * moveSpeed;
      }
      
      // Apply latitude correction for longitude movement
      const latRadians = (this.state.player.lat * Math.PI) / 180;
      const correctedDeltaLng = deltaLng / Math.cos(latRadians);
      
      this.state.player.lat += deltaLat;
      this.state.player.lng += correctedDeltaLng;
      
      positionChanged = true;
    }

    // Update view if anything changed
    if (positionChanged || rotationChanged) {
      this.view.updatePlayerPosition(
        { lng: this.state.player.lng, lat: this.state.player.lat },
        this.state.player.rotation
      );
    }
  }

  updateView() {
    this.view.updateStats(
      this.state.hqs.length,
      this.state.commodities,
      this.state.money,
      this.state.gameDate
    );
  }
}
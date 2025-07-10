// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";

export default class GameController {
  private gameClockTimer: number | null = null;
  private movementTimer: number | null = null;
  private lastRotationTime: number = 0;
  private rotationCooldownMs: number = 150; // Throttle rotation changes
  
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
      this.view.continuousCameraRotation = this.state.continuousCameraRotation;
    }, 1000 / 60);
  }

  private tickClock() {
    this.state.gameDate.setMinutes(this.state.gameDate.getMinutes() + GameState.MINUTES_PER_TICK);
    // HUD update should be triggered from main.ts after clock advances
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

    // Handle rotation
    if (this.currentInput.rotateLeft) {
      this.state.player.rotation -= GameState.PLAYER_ROTATION_SPEED;
      this.state.player.rotation = ((this.state.player.rotation % 360) + 360) % 360; // Normalize to 0-360
      rotationChanged = true;
    }
    
    if (this.currentInput.rotateRight) {
      this.state.player.rotation += GameState.PLAYER_ROTATION_SPEED;
      this.state.player.rotation = ((this.state.player.rotation % 360) + 360) % 360; // Normalize to 0-360
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

  public setContinuousCameraRotation(enabled: boolean): void {
    this.state.continuousCameraRotation = enabled;
  }

  // Remove or refactor updateView to not call this.view.updateStats. Instead, update stats from main.ts using hud.updateStats.
  // updateView() {
  //   this.view.updateStats(
  //     this.state.hqs.length,
  //     this.state.commodities,
  //     this.state.money,
  //     this.state.gameDate
  //   );
  // }
}
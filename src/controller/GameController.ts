// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";

export default class GameController {
  /**
   * Accumulates time so we advance the in-game clock in fixed steps of
   * `GameState.GAME_TICK_MS`, regardless of the frame rate.
   */
  private clockAccumulator = 0;
  
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

  /**
   * Called every animation frame by the shared GameLoop. `deltaMs` is the
   * elapsed real time in milliseconds since the previous frame.
   */
  public update(deltaMs: number): void {
    // 1. Accumulate time and advance the in-game clock in discrete ticks.
    this.clockAccumulator += deltaMs;
    while (this.clockAccumulator >= GameState.GAME_TICK_MS) {
      this.clockAccumulator -= GameState.GAME_TICK_MS;
      this.state.gameDate.setMinutes(
        this.state.gameDate.getMinutes() + GameState.MINUTES_PER_TICK
      );
    }

    // 2. Player movement and rotation.
    this.updatePlayerMovement(deltaMs / 1000); // convert to seconds
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

  // Update the movement logic — deltaSec is seconds since last frame
  private updatePlayerMovement(deltaSec: number) {
    let positionChanged = false;
    let rotationChanged = false;

    // Handle rotation
    if (this.currentInput.rotateLeft) {
      this.state.player.rotation -= GameState.PLAYER_ROTATION_SPEED * deltaSec;
      this.state.player.rotation = ((this.state.player.rotation % 360) + 360) % 360; // Normalize to 0-360
      rotationChanged = true;
    }
    
    if (this.currentInput.rotateRight) {
      this.state.player.rotation += GameState.PLAYER_ROTATION_SPEED * deltaSec;
      this.state.player.rotation = ((this.state.player.rotation % 360) + 360) % 360; // Normalize to 0-360
      rotationChanged = true;
    }

    // Handle movement (forward/backward and strafing)
    if (this.currentInput.forward || this.currentInput.backward || this.currentInput.left || this.currentInput.right) {
      const radians = (this.state.player.rotation * Math.PI) / 180;
      
      // Choose speed based on whether player is running
      const moveSpeedDegPerSec = this.currentInput.running ? GameState.PLAYER_RUN_SPEED : GameState.PLAYER_MOVE_SPEED;

      const step = moveSpeedDegPerSec * deltaSec;
      
      let deltaLat = 0;
      let deltaLng = 0;
      
      // Forward/backward movement
      if (this.currentInput.forward) {
        deltaLat += Math.cos(radians) * step;
        deltaLng += Math.sin(radians) * step;
      }
      
      if (this.currentInput.backward) {
        deltaLat -= Math.cos(radians) * step;
        deltaLng -= Math.sin(radians) * step;
      }
      
      // Strafing movement (perpendicular to facing direction)
      if (this.currentInput.left) {
        // Strafe left is 90 degrees counter-clockwise from facing direction
        const strafeRadians = radians - Math.PI / 2;
        deltaLat += Math.cos(strafeRadians) * step;
        deltaLng += Math.sin(strafeRadians) * step;
      }
      
      if (this.currentInput.right) {
        // Strafe right is 90 degrees clockwise from facing direction
        const strafeRadians = radians + Math.PI / 2;
        deltaLat += Math.cos(strafeRadians) * step;
        deltaLng += Math.sin(strafeRadians) * step;
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
}
// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";
import { Position, Rotation, Velocity } from "../ecs/world";
import { FixedUpdatable } from "../loop/GameLoop";

export default class GameController implements FixedUpdatable {
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

  constructor(private state: GameState, private view: MapView) {}

  private playerEid: number | null = null;

  public setPlayerEntity(id: number) {
    this.playerEid = id;
  }

  // legacy update kept empty (required by Updatable interface users)
  public update(_deltaMs: number): void {}

  // Fixed-step update (60 Hz)
  public fixedUpdate(): void {
    const deltaSec = 1 / 60;

    // Accumulate game clock (still 1 sec tickrate)
    this.clockAccumulator += GameState.GAME_TICK_MS; // each fixed step equals GAME_TICK_MS
    if (this.clockAccumulator >= GameState.GAME_TICK_MS) {
      this.clockAccumulator = 0;
      this.state.gameDate.setMinutes(
        this.state.gameDate.getMinutes() + GameState.MINUTES_PER_TICK
      );
    }

    this.updatePlayerMovement(deltaSec);
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
    if (this.playerEid === null) return;

    let positionChanged = false;
    let rotationChanged = false;

    const eid = this.playerEid;

    // Reset velocity each frame; will be set if movement keys active
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;

    // Handle rotation
    if (this.currentInput.rotateLeft) {
      Rotation.angle[eid] -= GameState.PLAYER_ROTATION_SPEED * deltaSec;
      Rotation.angle[eid] = ((Rotation.angle[eid] % 360) + 360) % 360;
      rotationChanged = true;
    }
    
    if (this.currentInput.rotateRight) {
      Rotation.angle[eid] += GameState.PLAYER_ROTATION_SPEED * deltaSec;
      Rotation.angle[eid] = ((Rotation.angle[eid] % 360) + 360) % 360;
      rotationChanged = true;
    }

    // Handle movement (forward/backward and strafing)
    if (this.currentInput.forward || this.currentInput.backward || this.currentInput.left || this.currentInput.right) {
      const radians = (Rotation.angle[eid] * Math.PI) / 180;
      
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
      const latRadians = (Position.y[eid] * Math.PI) / 180;
      const correctedLngSpeed = deltaLng / Math.cos(latRadians);

      Velocity.x[eid] = correctedLngSpeed / deltaSec;
      Velocity.y[eid] = deltaLat / deltaSec;

      positionChanged = true;
    }

    // Update view if anything changed
    // Keep GameState mirror (for HUD etc.)
    this.state.player.lng = Position.x[eid];
    this.state.player.lat = Position.y[eid];
    this.state.player.rotation = Rotation.angle[eid];
  }
}
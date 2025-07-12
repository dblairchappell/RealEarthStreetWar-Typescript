// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";
import { Position, Rotation } from "../ecs/world";
import { bridge } from "../sim/SimulationBridge";
import { FixedUpdatable } from "../loop/GameLoop";

export default class GameController implements FixedUpdatable {
  /**
   * Counts how many fixed-update ticks have elapsed. Once we reach the
   * equivalent of `GameState.GAME_TICK_MS` (≈1 s) we advance the in-game
   * clock and reset the counter. This removes the old millisecond
   * accumulator and keeps logic tied directly to the fixed-step loop.
   */
  private tickCounter = 0;

  // Number of fixed-step ticks that make up one game tick (1 s).
  private static readonly TICKS_PER_GAME_TICK = Math.round(
    GameState.GAME_TICK_MS / (1000 / 60)
  ); // 60 when FIXED_DT = 16.666 ms
  
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

    // Advance in-game clock every simulated second
    this.tickCounter++;
    if (this.tickCounter >= GameController.TICKS_PER_GAME_TICK) {
      this.tickCounter = 0;
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

    // We'll integrate position directly in this controller to avoid relying
    // on the main-thread ECS movementSystem (which may be disabled when the
    // simulation is running in a WebWorker).

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
      
      // Apply latitude correction for longitude movement so we move equal
      // distances in metres regardless of latitude.
      const latRadians = (Position.y[eid] * Math.PI) / 180;
      const correctedLng = deltaLng / Math.cos(latRadians);

      Position.x[eid] += correctedLng;
      Position.y[eid] += deltaLat;

      positionChanged = true;
    }

    // Sync GameState and notify bridge (even if worker is active) so the
    // render thread has the latest authoritative coordinates.
    if (positionChanged || rotationChanged) {
      this.state.player.lng = Position.x[eid];
      this.state.player.lat = Position.y[eid];
      this.state.player.rotation = Rotation.angle[eid];

      // Update shared snapshot for MapView
      // (updateFromMainThread will no-op if the worker is already overriding.)
      bridge.updateFromMainThread(Position.x[eid], Position.y[eid], Rotation.angle[eid]);
    }
  }
}
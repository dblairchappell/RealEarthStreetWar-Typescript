// controller/GameController.ts
import GameState from "../model/GameState";
import MapView from "../view/MapView";

export default class GameController {
  private gameClockTimer: number | null = null;
  private movementTimer: number | null = null;
  private currentInput = {
    forward: false,
    backward: false,
    left: false,
    right: false
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

  public handlePlayerInput(input: { forward: boolean, backward: boolean, left: boolean, right: boolean }) {
    this.currentInput = { ...input };
    this.state.player.isMoving = input.forward || input.backward || input.left || input.right;
  }

  private updatePlayerMovement() {
    let positionChanged = false;
    let rotationChanged = false;

    // Handle rotation (left/right arrows)
    if (this.currentInput.left) {
      this.state.player.rotation -= GameState.PLAYER_ROTATION_SPEED;
      if (this.state.player.rotation < 0) {
        this.state.player.rotation += 360;
      }
      rotationChanged = true;
    }
    
    if (this.currentInput.right) {
      this.state.player.rotation += GameState.PLAYER_ROTATION_SPEED;
      if (this.state.player.rotation >= 360) {
        this.state.player.rotation -= 360;
      }
      rotationChanged = true;
    }

    // Handle movement (forward/backward arrows)
    if (this.currentInput.forward || this.currentInput.backward) {
      const direction = this.currentInput.forward ? 1 : -1;
      const radians = (this.state.player.rotation * Math.PI) / 180;
      
      // Calculate movement in lng/lat coordinates
      // Note: longitude movement needs to be adjusted for latitude (cos correction)
      const deltaLat = Math.cos(radians) * GameState.PLAYER_MOVE_SPEED * direction;
      const deltaLng = Math.sin(radians) * GameState.PLAYER_MOVE_SPEED * direction;
      
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
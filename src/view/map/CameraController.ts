// view/map/CameraController.ts
import CharacterView from "../CharacterView";
import { Updatable } from "../../loop/GameLoop";

/*
 * CameraController is a view-layer helper that encapsulates all camera
 * behaviour (follow-player, continuous zoom, continuous rotation) so that
 * MapView no longer needs to keep camera-specific state.
 */

export class CameraController implements Updatable {
  /* ---------------- constructor & state ---------------- */
  constructor(private map: any, private characterView: CharacterView | null = null) {}

  /* player position to follow */
  private playerPosition: { lng: number; lat: number } | null = null;

  // Remember the last centre we jumpTo so we avoid redundant calls
  private lastCenter: { lng: number; lat: number } | null = null;

  /* bearing bookkeeping */
  private cameraBearing = 0;

  /* ───────── Continuous Zoom ───────── */
  private continuousZoomActive = false;
  private continuousZoomDirection: 'in' | 'out' | null = null;
  private currentZoomSpeed = 0;
  private readonly minZoomSpeed = 0.02;
  private readonly maxZoomSpeed = 0.15;
  private readonly zoomAcceleration = 0.005;
  private isCameraZooming = false;

  /* ───────── Continuous Rotation ───────── */
  private continuousRotationActive = false;
  private continuousRotationDirection: 'left' | 'right' | null = null;
  private currentRotationSpeed = 0;
  private readonly minRotationSpeed = 0.5;
  private readonly maxRotationSpeed = 5.0;
  private readonly rotationAcceleration = 0.1;
  private isCameraRotating = false;

  /* ------------------------------------------------------------------
   * Per-frame update – called by the main GameLoop
   * ------------------------------------------------------------------ */
  public update(deltaMs: number): void {
    // We keep speed units "per frame" to match original behaviour; dt scaling made motion too slow.

    /* ---- Continuous Zoom ---- */
    if (this.continuousZoomActive && this.continuousZoomDirection) {
      // Accelerate speed toward max (original code added zoomAcceleration per frame ~60 fps)
      if (this.currentZoomSpeed < this.maxZoomSpeed) {
        this.currentZoomSpeed = Math.min(
          this.maxZoomSpeed,
          this.currentZoomSpeed + this.zoomAcceleration * (deltaMs / 16.666)
        );
      }

      const currentZoom = this.map.getZoom();
      const delta = (this.continuousZoomDirection === "in" ? 1 : -1) * this.currentZoomSpeed;
      const newZoom = this.continuousZoomDirection === "in"
        ? Math.min(22, currentZoom + delta)
        : currentZoom + delta;

      if (this.playerPosition) {
        this.map.jumpTo({ center: [this.playerPosition.lng, this.playerPosition.lat], zoom: newZoom });
      } else {
        this.map.setZoom(newZoom);
      }
    }

    /* ---- Continuous Rotation ---- */
    if (this.continuousRotationActive && this.continuousRotationDirection) {
      // Accelerate speed toward max
      if (this.currentRotationSpeed < this.maxRotationSpeed) {
        this.currentRotationSpeed = Math.min(
          this.maxRotationSpeed,
          this.currentRotationSpeed + this.rotationAcceleration * (deltaMs / 16.666)
        );
      }

      if (this.continuousRotationDirection === "left") {
        this.cameraBearing = (this.cameraBearing - this.currentRotationSpeed + 360) % 360;
      } else {
        this.cameraBearing = (this.cameraBearing + this.currentRotationSpeed) % 360;
      }

      if (this.playerPosition) {
        this.map.jumpTo({ center: [this.playerPosition.lng, this.playerPosition.lat], bearing: this.cameraBearing });
      } else {
        this.map.setBearing(this.cameraBearing);
      }

      // Keep sprite facing the camera correctly
      if (this.characterView) {
        this.characterView.setCameraBearing(this.cameraBearing);
        this.characterView.redraw();
      }
    }
  }

  /* ---------------- public API ---------------- */

  /**
   * Called every time the player moves; keeps track of where we should
   * centre the camera.  If the camera is not currently busy (zooming or
   * rotating) the centre is updated immediately.
   */
  follow(coords: { lng: number; lat: number }): void {
    this.playerPosition = coords;
    // Avoid interrupting cinematic easeTo or other map animations
    if (!this.isBusy() && !this.map.isMoving()) {
      if (!this.lastCenter || coords.lng !== this.lastCenter.lng || coords.lat !== this.lastCenter.lat) {
        this.map.jumpTo({ center: [coords.lng, coords.lat] });
        this.lastCenter = { ...coords };
      }
    }
  }

  /* ---- Zoom controls ---- */
  startZoom(direction: 'in' | 'out'): void {
    this.continuousZoomDirection = direction;
    if (!this.continuousZoomActive) {
      this.isCameraZooming = true;
      this.currentZoomSpeed = this.minZoomSpeed;
      this.continuousZoomActive = true;
    }
  }

  stopZoom(): void {
    this.isCameraZooming = false;
    this.continuousZoomActive = false;
    this.continuousZoomDirection = null;
  }

  /* ---- Rotation controls ---- */
  startRotate(direction: 'left' | 'right'): void {
    this.continuousRotationDirection = direction;
    if (!this.continuousRotationActive) {
      this.isCameraRotating = true;
      this.currentRotationSpeed = this.minRotationSpeed;
      this.continuousRotationActive = true;
    }
  }

  stopRotate(): void {
    this.isCameraRotating = false;
    this.continuousRotationActive = false;
    this.continuousRotationDirection = null;
  }

  /* ---------------- helpers ---------------- */
  isBusy(): boolean {
    return this.isCameraRotating || this.isCameraZooming;
  }

  destroy(): void {
    // Nothing persistent to clean yet, but keep method for symmetry
    this.stopZoom();
    this.stopRotate();
  }
}

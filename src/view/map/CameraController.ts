// view/map/CameraController.ts
import CharacterView from "../CharacterView";

/*
 * CameraController is a view-layer helper that encapsulates all camera
 * behaviour (follow-player, continuous zoom, continuous rotation) so that
 * MapView no longer needs to keep camera-specific state.
 */

export class CameraController {
  /* ---------------- constructor & state ---------------- */
  constructor(private map: any, private characterView: CharacterView | null = null) {}

  /* player position to follow */
  private playerPosition: { lng: number; lat: number } | null = null;

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

  /* ---------------- public API ---------------- */

  /**
   * Called every time the player moves; keeps track of where we should
   * centre the camera.  If the camera is not currently busy (zooming or
   * rotating) the centre is updated immediately.
   */
  follow(coords: { lng: number; lat: number }): void {
    this.playerPosition = coords;
    if (!this.isBusy()) {
      this.map.setCenter([coords.lng, coords.lat]);
    }
  }

  /* ---- Zoom controls ---- */
  startZoom(direction: 'in' | 'out'): void {
    this.continuousZoomDirection = direction;
    if (!this.continuousZoomActive) {
      this.isCameraZooming = true;
      this.currentZoomSpeed = this.minZoomSpeed;
      this.continuousZoomActive = true;
      this.continuousZoom();
    }
  }

  stopZoom(): void {
    this.isCameraZooming = false;
    this.continuousZoomActive = false;
    this.continuousZoomDirection = null;
  }

  private continuousZoom(): void {
    if (!this.continuousZoomActive) return;

    // Accelerate up to max speed
    if (this.currentZoomSpeed < this.maxZoomSpeed) {
      this.currentZoomSpeed += this.zoomAcceleration;
    }

    const currentZoom = this.map.getZoom();
    const delta = this.continuousZoomDirection === 'in' ? this.currentZoomSpeed : -this.currentZoomSpeed;
    const newZoom = this.continuousZoomDirection === 'in' ? Math.min(22, currentZoom + delta) : currentZoom + delta;

    if (this.playerPosition) {
      this.map.easeTo({
        center: [this.playerPosition.lng, this.playerPosition.lat],
        zoom: newZoom,
        duration: 0, // instantaneous for smoothness
      });
    } else {
      this.map.setZoom(newZoom);
    }

    requestAnimationFrame(() => this.continuousZoom());
  }

  /* ---- Rotation controls ---- */
  startRotate(direction: 'left' | 'right'): void {
    this.continuousRotationDirection = direction;
    if (!this.continuousRotationActive) {
      this.isCameraRotating = true;
      this.currentRotationSpeed = this.minRotationSpeed;
      this.continuousRotationActive = true;
      this.continuousRotate();
    }
  }

  stopRotate(): void {
    this.isCameraRotating = false;
    this.continuousRotationActive = false;
    this.continuousRotationDirection = null;
  }

  private continuousRotate(): void {
    if (!this.continuousRotationActive) return;

    // Accelerate
    if (this.currentRotationSpeed < this.maxRotationSpeed) {
      this.currentRotationSpeed += this.rotationAcceleration;
    }

    // Update bearing
    if (this.continuousRotationDirection === 'left') {
      this.cameraBearing = (this.cameraBearing - this.currentRotationSpeed + 360) % 360;
    } else {
      this.cameraBearing = (this.cameraBearing + this.currentRotationSpeed) % 360;
    }

    // Apply rotation centred on player when possible
    if (this.playerPosition) {
      this.map.easeTo({
        center: [this.playerPosition.lng, this.playerPosition.lat],
        bearing: this.cameraBearing,
        duration: 0,
      });
    } else {
      this.map.setBearing(this.cameraBearing);
    }

    // Update sprite to compensate so it always faces the screen correctly
    if (this.characterView) {
      this.characterView.setCameraBearing(this.cameraBearing);
      this.characterView.redraw();
    }

    requestAnimationFrame(() => this.continuousRotate());
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

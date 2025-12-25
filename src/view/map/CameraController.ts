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

  /* camera follow state */
  private cameraFollowEnabled = true; // Whether camera should follow player (when false, preserve panned position)

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

  /* ───────── Continuous Pan ───────── */
  private continuousPanActive = false;
  private continuousPanDirection: 'up' | 'down' | 'left' | 'right' | null = null;
  private currentPanSpeed = 0;
  private readonly minPanSpeed = 0.01; // Base pan speed at reference zoom (degrees per frame)
  private readonly maxPanSpeed = 0.01; // Max pan speed at reference zoom
  private readonly panAcceleration = 0.005;
  private readonly panReferenceZoom = 10; // Zoom level where base speed applies
  private isCameraPanning = false;

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

      // Use player position if camera follow is enabled, otherwise preserve current panned position
      if (this.cameraFollowEnabled && this.playerPosition) {
        this.map.jumpTo({ center: [this.playerPosition.lng, this.playerPosition.lat], zoom: newZoom });
      } else {
        const currentCenter = this.map.getCenter();
        this.map.jumpTo({ center: [currentCenter.lng, currentCenter.lat], zoom: newZoom });
      }
      // Note: We don't track this as programmatic zoom here because CameraController
      // zoom is user-initiated (via keyboard input), not automatic camera following
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

      // Use player position if camera follow is enabled, otherwise preserve current panned position
      if (this.cameraFollowEnabled && this.playerPosition) {
        this.map.jumpTo({ center: [this.playerPosition.lng, this.playerPosition.lat], bearing: this.cameraBearing });
      } else {
        const currentCenter = this.map.getCenter();
        this.map.jumpTo({ center: [currentCenter.lng, currentCenter.lat], bearing: this.cameraBearing });
      }

      // Keep sprite facing the camera correctly
      if (this.characterView) {
        this.characterView.setCameraBearing(this.cameraBearing);
        this.characterView.redraw();
      }
    }

    /* ---- Continuous Pan ---- */
    if (this.continuousPanActive && this.continuousPanDirection) {
      // Get current zoom level to scale pan speed
      const currentZoom = this.map.getZoom();
      
      // Scale pan speed based on zoom level
      // Lower zoom (zoomed out) = faster panning, higher zoom (zoomed in) = slower panning
      // Use exponential scaling: speed = baseSpeed * 2^(referenceZoom - currentZoom)
      // At zoom 10 (reference): multiplier = 1.0
      // At zoom 5 (zoomed out): multiplier = 32x faster
      // At zoom 15 (zoomed in): multiplier = 32x slower
      const zoomDifference = this.panReferenceZoom - currentZoom;
      const zoomSpeedMultiplier = Math.pow(2, zoomDifference);
      
      // Calculate max speed for current zoom level
      const zoomAdjustedMaxSpeed = this.maxPanSpeed * zoomSpeedMultiplier;
      const zoomAdjustedMinSpeed = this.minPanSpeed * zoomSpeedMultiplier;
      const zoomAdjustedAcceleration = this.panAcceleration * zoomSpeedMultiplier;
      
      // Accelerate speed toward zoom-adjusted max
      if (this.currentPanSpeed < zoomAdjustedMaxSpeed) {
        this.currentPanSpeed = Math.min(
          zoomAdjustedMaxSpeed,
          this.currentPanSpeed + zoomAdjustedAcceleration * (deltaMs / 16.666)
        );
      }

      const currentCenter = this.map.getCenter();
      
      // Get camera bearing (rotation) in degrees and convert to radians
      const bearingDegrees = this.map.getBearing();
      const bearingRadians = (bearingDegrees * Math.PI) / 180;
      
      let deltaLat = 0;
      let deltaLng = 0;

      // Pan relative to camera bearing (forward/backward/left/right relative to view)
      switch (this.continuousPanDirection) {
        case 'up': // Forward (in direction camera is facing)
          deltaLat = Math.cos(bearingRadians) * this.currentPanSpeed;
          deltaLng = Math.sin(bearingRadians) * this.currentPanSpeed;
          break;
        case 'down': // Backward (opposite to camera facing)
          deltaLat = -Math.cos(bearingRadians) * this.currentPanSpeed;
          deltaLng = -Math.sin(bearingRadians) * this.currentPanSpeed;
          break;
        case 'left': // Left relative to camera (camera bearing - 90°)
          const leftRadians = bearingRadians - Math.PI / 2;
          deltaLat = Math.cos(leftRadians) * this.currentPanSpeed;
          deltaLng = Math.sin(leftRadians) * this.currentPanSpeed;
          break;
        case 'right': // Right relative to camera (camera bearing + 90°)
          const rightRadians = bearingRadians + Math.PI / 2;
          deltaLat = Math.cos(rightRadians) * this.currentPanSpeed;
          deltaLng = Math.sin(rightRadians) * this.currentPanSpeed;
          break;
      }

      // Apply longitude correction for latitude (meridian convergence)
      const latRadians = (currentCenter.lat * Math.PI) / 180;
      const correctedLng = deltaLng / Math.cos(latRadians);

      const newCenter: [number, number] = [
        currentCenter.lng + correctedLng,
        currentCenter.lat + deltaLat
      ];

      this.map.jumpTo({ center: newCenter });
    }
  }

  /* ---------------- public API ---------------- */

  /**
   * Called every time the player moves; keeps track of where we should
   * centre the camera.  If the camera is not currently busy (zooming or
   * rotating) the centre is updated immediately, or smoothly if transitioning from manual control.
   */
  follow(coords: { lng: number; lat: number }, smoothTransition: boolean = false): void {
    this.playerPosition = coords;
    // Avoid interrupting cinematic easeTo or other map animations
    if (!this.isBusy() && !this.map.isMoving()) {
      if (smoothTransition) {
        // Smooth transition when resuming auto-follow after manual camera control
        this.map.easeTo({ 
          center: [coords.lng, coords.lat],
          duration: 300,
          essential: true
        } as any);
      } else {
        // Instant follow during normal gameplay
        // Use jumpTo for instant, smooth camera following
        // This matches the original non-server behavior and avoids jitter
        // from calling easeTo() every frame
        this.map.jumpTo({ center: [coords.lng, coords.lat] });
      }
      this.lastCenter = { ...coords };
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

  /* ---- Pan controls ---- */
  startPan(direction: 'up' | 'down' | 'left' | 'right'): void {
    this.continuousPanDirection = direction;
    if (!this.continuousPanActive) {
      this.isCameraPanning = true;
      
      // Calculate initial speed based on current zoom level
      const currentZoom = this.map.getZoom();
      const zoomDifference = this.panReferenceZoom - currentZoom;
      const zoomSpeedMultiplier = Math.pow(2, zoomDifference);
      const zoomAdjustedMinSpeed = this.minPanSpeed * zoomSpeedMultiplier;
      
      this.currentPanSpeed = zoomAdjustedMinSpeed;
      this.continuousPanActive = true;
    }
  }

  stopPan(): void {
    this.isCameraPanning = false;
    this.continuousPanActive = false;
    this.continuousPanDirection = null;
  }

  /* ---------------- helpers ---------------- */
  isBusy(): boolean {
    return this.isCameraRotating || this.isCameraZooming || this.isCameraPanning;
  }

  /**
   * Sets whether camera should follow the player.
   * When disabled, zoom/rotate operations preserve the current panned position.
   */
  setFollowEnabled(enabled: boolean): void {
    this.cameraFollowEnabled = enabled;
  }

  destroy(): void {
    // Nothing persistent to clean yet, but keep method for symmetry
    this.stopZoom();
    this.stopRotate();
    this.stopPan();
  }
}

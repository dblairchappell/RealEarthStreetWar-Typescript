// src/input/InputManager.ts
import { InputState, InputCallbacks } from '@shared/realearthstreetwar';
import { IInputService } from './IInputService';
import { GTA1_STYLE_TOP_DOWN } from "../config";

export default class InputManager implements IInputService {
  private inputState: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
    running: false
  };

  private callbacks: InputCallbacks[] = [];

  // Double-tap running state
  private lastArrowUpPressTime: number = 0;
  private lastArrowUpReleaseTime: number = 0;
  private doubleTapThresholdMs: number = 300;
  private tapDurationThresholdMs: number = 500;

  // Zoom control state
  private wKeyDownTime: number = 0;
  private sKeyDownTime: number = 0;
  private holdZoomActive: boolean = false;

  // Rotation control state
  private aKeyDownTime: number = 0;
  private dKeyDownTime: number = 0;

  // Track which keys are currently held (for Shift release handling)
  private wKeyHeld = false;
  private sKeyHeld = false;
  private aKeyHeld = false;
  private dKeyHeld = false;
  
  // Track if Shift is currently held (for panning behavior)
  private shiftKeyHeld = false;
  
  // Track if any WASD key is held with Shift (for panning)
  private isPanningWithShift = false;

  constructor() {
    this.setupInputHandlers();
  }

  /* ----------------------------------------------------------
   * Observer management
   * -------------------------------------------------------- */
  public addCallbacks(callbacks: InputCallbacks): void {
    this.callbacks.push(callbacks);
  }

  public removeCallbacks(callbacks: InputCallbacks): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callbacks);
  }

  /** Legacy helper – clears previous listeners and sets a single one. */
  public setCallbacks(callbacks: InputCallbacks): void {
    this.callbacks = [callbacks];
  }

  public getInputState(): InputState {
    return { ...this.inputState };
  }

  private setupInputHandlers(): void {
    document.addEventListener('keydown', (e) => {
      this.handleKeyDown(e);
      e.preventDefault();
    });

    document.addEventListener('keyup', (e) => {
      this.handleKeyUp(e);
      e.preventDefault();
    });

    if (document.body.tabIndex === -1) {
      document.body.tabIndex = 0;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    let inputChanged = false;

    switch(e.code) {
      case 'KeyD':
        this.dKeyHeld = true;
        if (e.shiftKey) {
          // Shift+D = pan right (east)
          this.isPanningWithShift = true;
          this.callbacks.forEach(cb => cb.onCameraPanHold?.('right'));
        } else {
          // D = rotate left (clockwise)
          if (!this.dKeyDownTime) {
            this.dKeyDownTime = Date.now();
            this.callbacks.forEach(cb => cb.onCameraRotateHold('left'));
          }
        }
        break;
      case 'KeyA':
        this.aKeyHeld = true;
        if (e.shiftKey) {
          // Shift+A = pan left (west)
          this.isPanningWithShift = true;
          this.callbacks.forEach(cb => cb.onCameraPanHold?.('left'));
        } else {
          // A = rotate right (counter-clockwise)
          if (!this.aKeyDownTime) {
            this.aKeyDownTime = Date.now();
            this.callbacks.forEach(cb => cb.onCameraRotateHold('right'));
          }
        }
        break;
      case 'KeyW':
        this.wKeyHeld = true;
        if (e.shiftKey) {
          // Shift+W = pan up (north)
          this.isPanningWithShift = true;
          this.callbacks.forEach(cb => cb.onCameraPanHold?.('up'));
        } else {
          // W = zoom in
          if (!this.wKeyDownTime) {
            this.wKeyDownTime = Date.now();
            this.callbacks.forEach(cb => cb.onCameraZoomHold('in'));
          }
        }
        break;
      case 'KeyS':
        this.sKeyHeld = true;
        if (e.shiftKey) {
          // Shift+S = pan down (south)
          this.isPanningWithShift = true;
          this.callbacks.forEach(cb => cb.onCameraPanHold?.('down'));
        } else {
          // S = zoom out
          if (!this.sKeyDownTime) {
            this.sKeyDownTime = Date.now();
            this.callbacks.forEach(cb => cb.onCameraZoomHold('out'));
          }
        }
        break;
      case 'ArrowUp':
        if (!this.inputState.forward) {
          const currentTime = Date.now();
          const timeSinceLastRelease = currentTime - this.lastArrowUpReleaseTime;
          const lastPressDuration = this.lastArrowUpReleaseTime - this.lastArrowUpPressTime;

          if (timeSinceLastRelease < this.doubleTapThresholdMs && lastPressDuration < this.tapDurationThresholdMs) {
            this.inputState.running = true;
          }
          
          this.inputState.forward = true;
          this.lastArrowUpPressTime = currentTime;
          inputChanged = true;
        }
        break;
      case 'ArrowDown':
        if (!this.inputState.backward) {
          this.inputState.backward = true;
          inputChanged = true;
        }
        break;
      case 'ArrowLeft':
        if (e.shiftKey) {
          if (!this.inputState.left) {
            this.inputState.left = true;
            inputChanged = true;
          }
        } else {
          if (!this.inputState.rotateLeft) {
            this.inputState.rotateLeft = true;
            inputChanged = true;
          }
        }
        break;
      case 'ArrowRight':
        if (e.shiftKey) {
          if (!this.inputState.right) {
            this.inputState.right = true;
            inputChanged = true;
          }
        } else {
          if (!this.inputState.rotateRight) {
            this.inputState.rotateRight = true;
            inputChanged = true;
          }
        }
        break;
      case 'KeyC':
        // Shift+C toggles camera follow
        if (e.shiftKey) {
          this.callbacks.forEach(cb => {
            if (cb.onCameraFollowToggle) {
              cb.onCameraFollowToggle();
            }
          });
        }
        break;
    }

    if (inputChanged) {
      this.callbacks.forEach(cb => cb.onPlayerInput(this.inputState));
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    let inputChanged = false;

    switch(e.code) {
      case 'KeyD':
        this.dKeyHeld = false;
        if (e.shiftKey) {
          // Shift+D released, but Shift still held - pause panning movement
          // Camera stays at current panned position until Shift is released
          // Check if any other WASD keys are still held
          if (!this.wKeyHeld && !this.sKeyHeld && !this.aKeyHeld) {
            // No WASD keys held anymore - pause panning (stops movement but keeps position)
            this.callbacks.forEach(cb => cb.onCameraPanPause?.());
          }
        } else {
          // D released = stop rotating
          this.dKeyDownTime = 0;
          this.callbacks.forEach(cb => cb.onCameraRotateRelease());
        }
        break;
      case 'KeyA':
        this.aKeyHeld = false;
        if (e.shiftKey) {
          // Shift+A released, but Shift still held - pause panning if no other keys held
          if (!this.wKeyHeld && !this.sKeyHeld && !this.dKeyHeld) {
            this.callbacks.forEach(cb => cb.onCameraPanPause?.());
          }
        } else {
          // A released = stop rotating
          this.aKeyDownTime = 0;
          this.callbacks.forEach(cb => cb.onCameraRotateRelease());
        }
        break;
      case 'KeyW':
        this.wKeyHeld = false;
        if (e.shiftKey) {
          // Shift+W released, but Shift still held - pause panning if no other keys held
          if (!this.sKeyHeld && !this.aKeyHeld && !this.dKeyHeld) {
            this.callbacks.forEach(cb => cb.onCameraPanPause?.());
          }
        } else {
          // W released = stop zooming
          this.wKeyDownTime = 0;
          this.holdZoomActive = false;
          this.callbacks.forEach(cb => cb.onCameraZoomRelease());
        }
        break;
      case 'KeyS':
        this.sKeyHeld = false;
        if (e.shiftKey) {
          // Shift+S released, but Shift still held - pause panning if no other keys held
          if (!this.wKeyHeld && !this.aKeyHeld && !this.dKeyHeld) {
            this.callbacks.forEach(cb => cb.onCameraPanPause?.());
          }
        } else {
          // S released = stop zooming
          this.sKeyDownTime = 0;
          this.holdZoomActive = false;
          this.callbacks.forEach(cb => cb.onCameraZoomRelease());
        }
        break;
      case 'ArrowUp':
        if (this.inputState.forward) {
          this.inputState.forward = false;
          this.inputState.running = false;
          this.lastArrowUpReleaseTime = Date.now();
          inputChanged = true;
        }
        break;
      case 'ArrowDown':
        if (this.inputState.backward) {
          this.inputState.backward = false;
          inputChanged = true;
        }
        break;
      case 'ArrowLeft':
        let leftChanged = false;
        if (this.inputState.left) {
          this.inputState.left = false;
          leftChanged = true;
        }
        if (this.inputState.rotateLeft) {
          this.inputState.rotateLeft = false;
          leftChanged = true;
        }
        if (leftChanged) {
          inputChanged = true;
        }
        break;
      case 'ArrowRight':
        let rightChanged = false;
        if (this.inputState.right) {
          this.inputState.right = false;
          rightChanged = true;
        }
        if (this.inputState.rotateRight) {
          this.inputState.rotateRight = false;
          rightChanged = true;
        }
        if (rightChanged) {
          inputChanged = true;
        }
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.shiftKeyHeld = false;
        
        // When Shift is released, stop panning if it was active
        if (this.isPanningWithShift) {
          this.callbacks.forEach(cb => cb.onCameraPanRelease?.());
          this.isPanningWithShift = false;
        }
        
        // When Shift is released while WASD keys are held, switch from panning to zoom/rotate
        if (this.wKeyHeld) {
          if (!this.wKeyDownTime) {
            this.wKeyDownTime = Date.now();
            this.callbacks.forEach(cb => cb.onCameraZoomHold('in'));
          }
        }
        if (this.sKeyHeld) {
          if (!this.sKeyDownTime) {
            this.sKeyDownTime = Date.now();
            this.callbacks.forEach(cb => cb.onCameraZoomHold('out'));
          }
        }
        if (this.aKeyHeld) {
          if (!this.aKeyDownTime) {
            this.aKeyDownTime = Date.now();
            this.callbacks.forEach(cb => cb.onCameraRotateHold('right'));
          }
        }
        if (this.dKeyHeld) {
          if (!this.dKeyDownTime) {
            this.dKeyDownTime = Date.now();
            this.callbacks.forEach(cb => cb.onCameraRotateHold('left'));
          }
        }
        break;
    }

    if (inputChanged) {
      this.callbacks.forEach(cb => cb.onPlayerInput(this.inputState));
    }
  }

  public destroy(): void {
    // Clean up event listeners if needed
  }
}

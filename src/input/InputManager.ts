// src/input/InputManager.ts
import { InputState, InputCallbacks } from './InputTypes';

export default class InputManager {
  private inputState: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
    running: false
  };

  private callbacks: InputCallbacks | null = null;

  // Double-tap running state
  private lastArrowUpPressTime: number = 0;
  private lastArrowUpReleaseTime: number = 0;
  private doubleTapThresholdMs: number = 300;
  private tapDurationThresholdMs: number = 500;

  // Zoom control state
  private wKeyDownTime: number = 0;
  private sKeyDownTime: number = 0;
  private holdZoomActive: boolean = false;

  constructor() {
    this.setupInputHandlers();
  }

  public setCallbacks(callbacks: InputCallbacks): void {
    this.callbacks = callbacks;
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
        this.callbacks?.onCameraRotateLeft();
        break;
      case 'KeyA':
        this.callbacks?.onCameraRotateRight();
        break;
      case 'KeyW':
        if (!this.wKeyDownTime) {
          this.wKeyDownTime = Date.now();
          this.callbacks?.onCameraZoomIn();
          this.callbacks?.onCameraZoomHold('in');
        }
        break;
      case 'KeyS':
        if (!this.sKeyDownTime) {
          this.sKeyDownTime = Date.now();
          this.callbacks?.onCameraZoomOut();
          this.callbacks?.onCameraZoomHold('out');
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
    }

    if (inputChanged && this.callbacks) {
      this.callbacks.onPlayerInput(this.inputState);
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    let inputChanged = false;

    switch(e.code) {
      case 'KeyW':
        this.wKeyDownTime = 0;
        this.holdZoomActive = false;
        this.callbacks?.onCameraZoomRelease('in');
        break;
      case 'KeyS':
        this.sKeyDownTime = 0;
        this.holdZoomActive = false;
        this.callbacks?.onCameraZoomRelease('out');
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
    }

    if (inputChanged && this.callbacks) {
      this.callbacks.onPlayerInput(this.inputState);
    }
  }

  public destroy(): void {
    // Clean up event listeners if needed
  }
}

// src/input/InputTypes.ts

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;        // Strafing left
  right: boolean;       // Strafing right
  rotateLeft: boolean;  // Rotation left (shift+left)
  rotateRight: boolean; // Rotation right (shift+right)
  running: boolean;     // Running (double-tap)
}

export interface InputCallbacks {
  onPlayerInput: (input: InputState) => void;
  onCameraRotateLeft: () => void;
  onCameraRotateRight: () => void;
  onCameraZoomIn: () => void;
  onCameraZoomOut: () => void;
  onCameraZoomHold: (direction: 'in' | 'out') => void;
}

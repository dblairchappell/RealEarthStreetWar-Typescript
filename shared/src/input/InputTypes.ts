/**
 * Input Types - Shared input state definitions
 * 
 * Defines the structure of player input that is sent from client to server.
 */

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
  onCameraZoomHold: (direction: 'in' | 'out') => void;
  onCameraZoomRelease: () => void;
  onCameraRotateHold: (direction: 'left' | 'right') => void;
  onCameraRotateRelease: () => void;
}


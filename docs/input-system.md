# Input System

The input system provides centralized keyboard and mouse handling with type-safe state management and flexible callback architecture.

## 🏗️ Architecture

### Components
- **InputManager**: Core input processing engine (singleton – instantiated once in `main.ts`)
- **InputTypes**: Type definitions and interfaces  
- **Observer System**: Any component can subscribe via `addCallbacks()`; supports multiple observers concurrently.

### Input State
```typescript
interface InputState {
  forward: boolean;      // Arrow up
  backward: boolean;     // Arrow down  
  left: boolean;         // Shift + left (strafe)
  right: boolean;        // Shift + right (strafe)
  rotateLeft: boolean;   // Left arrow (rotate)
  rotateRight: boolean;  // Right arrow (rotate)
  running: boolean;      // Double-tap up arrow
}
```

## ⌨️ Input Mapping

### Movement Controls
- **↑**: Forward movement
- **↓**: Backward movement  
- **←**: Rotate character anticlockwise
- **→**: Rotate character clockwise
- **Shift + ←**: Strafe left (move sideways)
- **Shift + →**: Strafe right (move sideways)
- **Double-tap ↑**: Toggle running (within 300ms, max 500ms press duration)
- **HUD Toggle**: Use the on-screen button to switch movement mode (8-directional/360°)

### Camera Controls  
- **A**: Rotate camera clockwise 45°
- **D**: Rotate camera anticlockwise 45°
- **W**: Zoom in (hold for continuous zoom)
- **S**: Zoom out (hold for continuous zoom)

## 🔄 Processing Flow

### Event Handling
1. **Browser Events**: `keydown`/`keyup` events captured on document
2. **State Updates**: `InputManager` updates internal `InputState`
3. **Callback Execution**: Registered callbacks invoked with new state
4. **Game Logic**: `MapView` and `GameController` respond to input changes

### Double-Tap Detection
```typescript
// Running activation logic
const timeSinceLastRelease = currentTime - this.lastArrowUpReleaseTime;
const lastPressDuration = this.lastArrowUpReleaseTime - this.lastArrowUpPressTime;

if (timeSinceLastRelease < 300 && lastPressDuration < 500) {
  this.inputState.running = true; // Activate running
}
```

### Hold-to-Zoom
- **Initial Press**: Immediate zoom step
- **Hold Detection**: After 500ms, continuous zooming begins
- **Continuous Zoom**: 60fps zoom updates via `requestAnimationFrame`

## 🎯 Callback Interface

```typescript
interface InputCallbacks {
  onPlayerInput: (input: InputState) => void;
  onCameraZoomHold: (direction: 'in' | 'out') => void;
  onCameraZoomRelease: () => void;
  onCameraRotateHold: (direction: 'left' | 'right') => void;
  onCameraRotateRelease: () => void;
}

interface IInputService {
  addCallbacks(cb: InputCallbacks): void;    // subscribe
  removeCallbacks(cb: InputCallbacks): void; // unsubscribe
}
```

### Usage Example (multiple observers)
```typescript
// Shared instance created in main.ts
const input = new InputManager();

// MapView cares about sprite & camera
input.addCallbacks({
  onPlayerInput: (inp) => characterView.inputState = inp,
  onCameraZoomHold: (d) => camera.startZoom(d),
  onCameraZoomRelease: () => camera.stopZoom(),
  onCameraRotateHold: (d) => camera.startRotate(d),
  onCameraRotateRelease: () => camera.stopRotate()
});

// GameController cares about movement logic
input.addCallbacks({
  onPlayerInput: (inp) => controller.handlePlayerInput(inp),
  onCameraZoomHold: () => {},
  onCameraZoomRelease: () => {},
  onCameraRotateHold: () => {},
  onCameraRotateRelease: () => {}
});
```

## ⚡ Performance Features

### Event Throttling
- **Camera Rotation**: 50ms cooldown between rotations
- **Zoom Operations**: 100ms cooldown between zoom steps
- **Input State**: Updates only on actual state changes

### Memory Management
- **Event Listeners**: Attached once in constructor
- **State Objects**: Copied rather than referenced for immutability
- **Cleanup Method**: `destroy()` available for cleanup (future use)

### Extending the Input System (unchanged API surface)

1. **Update InputState interface**:
   ```typescript
   interface InputState {
     // ... existing properties
     newAction: boolean;
   }
   ```

2. **Add key handling**:
   ```typescript
   case 'KeyX':
     if (!this.inputState.newAction) {
       this.inputState.newAction = true;
       inputChanged = true;
     }
     break;
   ```

3. **Update callbacks**:
   ```typescript
   interface InputCallbacks {
     // ... existing callbacks
     onNewAction: () => void;
   }
   ```

### Custom Input Devices
The system can be extended to support:
- **Gamepad Input**: Add gamepad event listeners
- **Touch Controls**: Add touch event handling for mobile
- **Mouse Controls**: Add mouse button/wheel handling 
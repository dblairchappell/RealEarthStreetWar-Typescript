# Input System

The input system provides centralized keyboard and mouse handling with type-safe state management and flexible callback architecture.

## 🏗 Architecture

### Components
- **InputManager**: Core input processing engine
- **InputTypes**: Type definitions and interfaces  
- **Callback System**: Delegates input events to appropriate handlers

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
- **←**: Rotate character left
- **→**: Rotate character right
- **Shift + ←**: Strafe left (move sideways)
- **Shift + →**: Strafe right (move sideways)
- **Double-tap ↑**: Toggle running (within 300ms, max 500ms press duration)

### Camera Controls  
- **A**: Rotate camera left 45°
- **D**: Rotate camera right 45°
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
  onCameraRotateLeft: () => void;
  onCameraRotateRight: () => void;  
  onCameraZoomIn: () => void;
  onCameraZoomOut: () => void;
  onCameraZoomHold: (direction: 'in' | 'out') => void;
}
```

### Usage Example
```typescript
inputManager.setCallbacks({
  onPlayerInput: (input) => this.handlePlayerInput(input),
  onCameraRotateLeft: () => this.rotateCameraLeft(),
  onCameraRotateRight: () => this.rotateCameraRight(),
  onCameraZoomIn: () => this.zoomIn(),
  onCameraZoomOut: () => this.zoomOut(),
  onCameraZoomHold: (direction) => this.handleZoomHold(direction)
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

## 🔧 Extending the Input System

### Adding New Input Types
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
# Architecture Overview

Real-Earth Street War follows a clean **Model-View-Controller (MVC)** architecture with separated concerns for input handling, character rendering, and map management.

## 📁 Project Structure

```
src/
├── input/                   # Input handling system
│   ├── InputManager.ts      # Keyboard/mouse event processing
│   └── InputTypes.ts        # Input-related type definitions
│
├── view/                    # Rendering and UI layer
│   ├── MapView.ts          # Map rendering, camera, HUD (21KB)
│   └── CharacterView.ts    # Character sprite & animation (10KB)
│
├── controller/             # Business logic layer
│   └── GameController.ts   # Game state management (5KB)
│
├── model/                  # Data structures
│   └── GameState.ts        # Pure game state (3KB)
│
├── types/                  # Global type definitions
│   └── global.d.ts         # TypeScript declarations
│
└── main.ts                 # Application bootstrap
```

## 🏗 Architecture Patterns

### MVC Separation
- **Model** (`GameState`): Player data, HQ locations, territory ownership
- **View** (`MapView` + `CharacterView`): Map rendering, character animation, UI  
- **Controller** (`GameController`): Game logic, input coordination, model/view updates

### Input System Architecture
- **InputManager**: Centralized keyboard/mouse handling with callbacks
- **InputTypes**: Type-safe input state definitions
- **Delegation**: MapView receives input callbacks and delegates to appropriate systems

### View Layer Separation
- **MapView**: Map rendering, camera controls, HUD elements, HQ markers
- **CharacterView**: Character sprite management, animation state, positioning

## 🔄 Data Flow

1. **Input** → `InputManager` processes keyboard events
2. **Delegation** → `MapView` receives input callbacks  
3. **State Update** → `GameController` updates `GameState`
4. **View Sync** → Character and camera positions updated
5. **Rendering** → Map and character views render changes

## 🎯 Key Design Principles

### Single Responsibility
Each class has one clear purpose:
- `InputManager`: Only handles input events
- `CharacterView`: Only manages character rendering
- `MapView`: Only handles map, camera, and HUD
- `GameController`: Only coordinates game logic

### Loose Coupling  
Components communicate through well-defined interfaces:
- Callback interfaces for view-to-controller communication
- Public methods for cross-component coordination
- Type-safe input state sharing

### Testability
- Pure functions for game logic calculations
- Separated concerns allow unit testing individual components
- Clear interfaces enable mocking for integration tests

## 🔧 Extension Points

### Adding New Input Types
1. Extend `InputState` interface in `InputTypes.ts`
2. Add handling in `InputManager.handleKeyDown/Up`
3. Update callback interface in `MapView`

### Adding New View Components
1. Create new view class (e.g., `UIView.ts`)
2. Initialize in `MapView` constructor
3. Delegate appropriate responsibilities from `MapView`

### Adding New Game Mechanics
1. Extend `GameState` with new data structures
2. Add logic in `GameController`
3. Update view layer to render new elements

## 📐 Performance Considerations

- **60fps Movement**: Efficient character position updates
- **Memory Management**: Proper cleanup of animation timers
- **Event Throttling**: Camera rotation and zoom rate limiting
- **Efficient Rendering**: Minimal DOM manipulation, CSS transforms for positioning 
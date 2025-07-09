# Development Guide

Guide for contributing to and extending Real-Earth Street War. This covers coding standards, debugging techniques, and development workflows.

## 🚀 Getting Started

### Development Environment Setup
```bash
# Clone and install
git clone <repository-url>
cd RealEarthStreetWar
npm install

# Start development server
npm run dev

# Type checking (recommended during development)
npm run typecheck --watch
```

### Required Tools
- **Node.js**: 18+ with npm
- **Browser**: Chrome/Edge/Firefox with DevTools
- **Editor**: VS Code with TypeScript extension recommended
- **Git**: For version control and collaboration

## 📋 Coding Standards

### TypeScript Guidelines
- **Strict Mode**: All files use strict TypeScript checking
- **Type Safety**: Avoid `any` types, prefer explicit interfaces
- **Naming**: PascalCase for classes, camelCase for variables/methods
- **Imports**: Use explicit imports, avoid `import *`

**Example:**
```typescript
// Good
interface PlayerState {
  position: [number, number];
  rotation: number;
  isMoving: boolean;
}

// Avoid
const state: any = { ... };
```

### Architecture Principles
- **Single Responsibility**: Each class/function has one clear purpose
- **Loose Coupling**: Communicate via interfaces, not direct dependencies
- **Immutability**: Prefer copying state objects over mutation
- **Error Handling**: Explicit error checking, avoid silent failures

### File Organization
```
src/
├── input/          # Input handling only
├── view/           # Rendering and UI only  
├── controller/     # Game logic coordination
├── model/          # Pure data structures
└── types/          # Shared type definitions
```

## 🐛 Debugging Techniques

### Browser DevTools
**Character Animation Issues:**
1. Open Elements panel → Find character sprite element
2. Check `backgroundPosition` values during movement
3. Verify `transform` properties for positioning
4. Console: `window.character.getCurrentState()` for debug info

**Map Rendering Problems:**
1. Network panel → Verify PMTiles loading
2. Console errors → Check MapLibre GL JS messages
3. Performance panel → Monitor frame rate during zoom/pan
4. Console: `window.map.getZoom()` and `window.map.getBearing()`

### Input System Debugging
```typescript
// Add to InputManager for debugging
setCallbacks({
  onPlayerInput: (input) => {
    console.log('Input State:', input);
    // Debug specific issues
  }
});
```

### Common Issues and Solutions

**Animation Not Working:**
- Check sprite sheet path in `sprites/` directory
- Verify frame counts match expected values (idle: 8, walking: 12, running: 6)
- Confirm CSS `background-size` calculations

**Camera Movement Problems:**
- Check camera bearing is within 0-360° range
- Verify no concurrent camera operations (rotation + zoom)
- Test camera following is enabled/disabled correctly

**Input Not Responding:**
- Verify InputManager callbacks are set
- Check browser focus (input requires window focus)
- Test with browser console for key event firing

## 🔧 Adding Features

### New Character Animations
1. **Create Sprite Sheet**: 
   - Export as PNG with consistent grid layout
   - Place in `sprites/isometric_character_pack/`
   - Follow naming: `isometric_character_[action].png`

2. **Update CharacterView**:
   ```typescript
   // Add to animation type union
   type AnimationType = 'idle' | 'walking' | 'running' | 'newAction';
   
   // Update frame counts
   const animationFrames = {
     idle: 8, walking: 12, running: 6, newAction: 10
   };
   ```

3. **Add Trigger Logic**:
   ```typescript
   updateMovementState(inputState: InputState) {
     if (inputState.specialAction) {
       this.switchToAnimation('newAction');
     }
     // ... existing logic
   }
   ```

### New Input Types  
1. **Extend InputState** in `InputTypes.ts`
2. **Add Key Handling** in `InputManager.handleKeyDown/Up`
3. **Update Callbacks** interface and implementation
4. **Add Game Logic** in appropriate controller/view methods

### New HQ Types
1. **Update GameState** enum and interfaces
2. **Add Icon** to `/icons` directory as SVG
3. **Update MapView** icon mapping and styling
4. **Add Placement Logic** if special rules needed

## 🧪 Testing Strategy

### Manual Testing Checklist
- [ ] Character movement in all 8 directions
- [ ] Camera rotation (8 positions) with character adjustment  
- [ ] Zoom in/out with marker scaling
- [ ] HQ placement on valid/invalid locations
- [ ] Double-tap running activation
- [ ] Hold-to-zoom functionality
- [ ] Page refresh preserves functionality

### Performance Testing
```javascript
// Monitor frame rate during stress tests
let frameCount = 0;
let startTime = performance.now();

function trackFPS() {
  frameCount++;
  const elapsed = performance.now() - startTime;
  if (elapsed >= 1000) {
    console.log(`FPS: ${frameCount}`);
    frameCount = 0;
    startTime = performance.now();
  }
  requestAnimationFrame(trackFPS);
}
trackFPS();
```

### Browser Compatibility
- **Chrome/Edge**: Primary target, full functionality
- **Firefox**: Secondary target, test major features
- **Safari**: Basic compatibility, may have minor issues
- **Mobile**: Not currently optimized, future development

## 🗺 Future Development

### Planned Features (High Priority)
1. **Multiplayer Backend**:
   - WebSocket communication for real-time updates
   - Player synchronization and conflict resolution
   - Territory control persistence

2. **Mobile Support**:
   - Touch input handling for movement
   - Responsive UI scaling for smaller screens
   - Virtual joystick or gesture controls

3. **Combat System**:
   - Player vs player territory conflicts
   - Resource-based combat mechanics
   - Victory conditions and game progression

### Technical Improvements
1. **Performance Optimization**:
   - Web Workers for game logic processing
   - Improved memory management
   - Streaming for large map datasets

2. **Plugin Architecture**:
   - Modular expansion pack system
   - Custom map region support
   - Community content integration

3. **Advanced Features**:
   - Real-time economy simulation
   - Alliance and diplomacy systems
   - Historical data and analytics

## 🤝 Contributing Guidelines

### Pull Request Process
1. **Fork Repository** and create feature branch
2. **Follow Coding Standards** outlined above
3. **Test Thoroughly** with manual testing checklist
4. **Update Documentation** for new features
5. **Submit PR** with clear description and testing notes

### Code Review Criteria
- **Functionality**: Feature works as intended
- **Performance**: No significant frame rate impact
- **Architecture**: Follows MVC patterns and separation of concerns
- **Type Safety**: Proper TypeScript usage throughout
- **Documentation**: Code comments and user-facing docs updated

### Git Workflow
```bash
# Create feature branch
git checkout -b feature/new-input-system

# Make changes with descriptive commits
git commit -m "Add touch input support for mobile devices"

# Push and create pull request
git push origin feature/new-input-system
```

## 📊 Project Metrics

### Current Codebase Size
- **Total TypeScript**: ~40KB across 7 files
- **Input System**: ~6KB (InputManager + InputTypes)
- **View Layer**: ~31KB (MapView + CharacterView)
- **Business Logic**: ~8KB (GameController + GameState)

### Performance Targets
- **Frame Rate**: 60fps during movement and animation
- **Load Time**: <5 seconds for initial map load
- **Memory Usage**: <300MB peak during normal gameplay
- **Input Latency**: <16ms from keypress to visual response 
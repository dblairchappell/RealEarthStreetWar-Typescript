# View Layer Architecture

The view layer is responsible for all rendering, animation, and visual feedback. It's cleanly separated into specialized components with clear responsibilities.

## 🏗️ Component Structure

### MapView.ts
**Primary Responsibilities:**
- Map rendering and layer management
- Camera controls (rotation, zoom, following)
- HQ marker creation and management
- Map click handling and building detection

**Key Methods:**
- `createHQMarker()`: Place headquarters on map
- `rotateCameraLeft/Right()`: 45° camera rotation
- `zoomIn/Out()`: Camera zoom with easing
- `updateMarkerSizes()`: Zoom-responsive marker scaling

### CharacterView.ts
**Primary Responsibilities:**
- Character sprite rendering and positioning
- Animation state management (idle, walking, running)
- Directional sprite frame calculation
- Screen position updates during map movement

**Key Methods:**
- `createPlayerCharacter()`: Initialize character sprite
- `updatePlayerPosition()`: Handle position and rotation changes
- `updateMovementState()`: Switch between animation types
- `switchToAnimation()`: Change sprite sheets and frame counts

### HUDView.ts
**Primary Responsibilities:**
- HUD button rendering and state
- Stats panel updates
- UI event wiring and callbacks (including movement mode toggle)

**Key Methods:**
- `setCallbacks()`: Register game logic for HUD events
- `updateStats()`: Update HUD stats
- `updateMovementModeButton()`: Update movement mode toggle state
- `setPlantingButtonActive()`: Set active state for planting buttons

## 🎨 Visual Systems

### Character Animation
**Sprite Sheets:**
- **Idle**: 8×8 grid (64 frames), 8 directions × 8 frames each
- **Walking**: 12×8 grid (96 frames), 8 directions × 12 frames each
- **Running**: 6×8 grid (48 frames), 8 directions × 6 frames each

**Frame Calculation:**
```typescript
const x = (frame * 100) / (columnCount - 1); // Horizontal position %
const y = (row * 100) / (8 - 1);             // Vertical position %
sprite.style.backgroundPosition = `${x}% ${y}%`;
```

**Direction Mapping:**
```typescript
const rowMap = {
  'south': 0, 'southeast': 1, 'southwest': 2, 'west': 3,
  'northwest': 4, 'north': 5, 'northeast': 6, 'east': 7
};
```

### Camera System
- 45° increments (8 total positions)
- Smooth easing transitions (150ms duration)
- Character sprite adjusts to maintain proper facing direction

### HUD & UI
- **HUDView.ts** manages all HUD buttons, stats, and event wiring
- **Movement Mode Toggle**: Button in HUD switches between 8-directional and 360° movement
- **Button States**: Active state styling for selected HQ types and movement mode

### HQ Markers
- Dynamic sizing and styling based on zoom and type

## 🔄 Update Cycle

### Character Updates
1. **Input Change** → `CharacterView.inputState` updated
2. **Movement State** → Animation type determined (idle/walking/running)
3. **Position Update** → Geographic coordinates → screen pixels
4. **Direction Update** → Player rotation → sprite direction → frame row
5. **Animation Loop** → Frame advancement at 12fps

### Camera Updates
1. **Input Event** → Camera rotation/zoom command
2. **Bearing Update** → Character sprite direction recalculation
3. **Map Animation** → Smooth easing to new position
4. **Marker Scaling** → All markers resize based on new zoom
5. **Position Sync** → Character screen position updated

### HUD Updates
1. **Button Click** → HUDView callback triggers game logic
2. **Stats Update** → HUDView updates stats panel
3. **Movement Mode Toggle** → HUDView updates button and notifies controller

## 🚀 Extension Points

### Adding New Character Animations
1. **Create Sprite Sheet**: Export as PNG with consistent grid layout
2. **Update Animation Type**: Add to `'idle' | 'walking' | 'running'` union
3. **Configure Frames**: Set column count and background size
4. **Add Trigger Logic**: Update `updateMovementState()` conditions

### Adding New HQ Types
1. **Update HQType**: Add to enum in `GameState.ts`
2. **Add Icon**: Place SVG in `/icons` directory
3. **Update Icon Map**: Add mapping in `MapView.ts`
4. **Add Styling**: Define color and shape in `createHQMarker()`

### Adding UI Components
1. **HTML Structure**: Add elements to `index.html`
2. **Query Elements & Event Wiring**: Add to `HUDView.ts` for all HUD/UI logic
3. **Update Methods**: Create update methods in `HUDView.ts` and call from controller or main
4. **Event Handlers**: Register callbacks via `setCallbacks()`

## 📱 Responsive Design

### Zoom-Based Scaling
All visual elements scale smoothly with map zoom:
- **Character Size**: 0.075 base size with logarithmic scaling
- **HQ Markers**: 1.0 base size with same scaling algorithm
- **Icon Scaling**: 60% of marker size for proper proportions

### Visual Feedback
- **Cursor Changes**: Crosshair during HQ placement mode
- **Button States**: Active state styling for selected HQ types and movement mode
- **Animation States**: Immediate visual feedback for input changes 
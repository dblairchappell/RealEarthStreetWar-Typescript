# View Layer Architecture

The view layer is responsible for all rendering, animation, and visual feedback. It's cleanly separated into specialized components with clear responsibilities.

## 🏗 Component Structure

### MapView.ts (21KB, 597 lines)
**Primary Responsibilities:**
- Map rendering and layer management
- Camera controls (rotation, zoom, following)
- HUD elements and UI interactions
- HQ marker creation and management
- Map click handling and building detection

**Key Methods:**
- `createHQMarker()`: Place headquarters on map
- `rotateCameraLeft/Right()`: 45° camera rotation
- `zoomIn/Out()`: Camera zoom with easing
- `updateMarkerSizes()`: Zoom-responsive marker scaling

### CharacterView.ts (10KB, 276 lines)  
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
**Rotation:**
- 45° increments (8 total positions)
- Smooth easing transitions (150ms duration)
- Character sprite adjusts to maintain proper facing direction

**Zoom:**
- Range: Level 14-22 (street detail to building interiors)
- Marker size scaling based on zoom level
- Minimum visibility thresholds (8px minimum)

**Following:**
- Character position tracking
- Rotation and zoom interruption prevention
- Smooth camera recentering

### HQ Markers
**Dynamic Sizing:**
```typescript
const scale = Math.pow(2, (currentZoom - 10) / 1.2);
const size = Math.max(1, Math.min(200, baseSize * scale));
```

**Visual Styling:**
- **Producers**: Green diamond with farm icon
- **Traffickers**: Yellow diamond with person icon  
- **Retailers**: Blue diamond with trade icon
- Drop shadows and clip-path styling for professional appearance

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

## 🎯 Rendering Optimizations

### Performance Features
- **CSS Transforms**: Hardware-accelerated positioning
- **Background Sprites**: Efficient frame switching via `backgroundPosition`
- **Zoom Throttling**: Updates only on zoom end for smooth performance
- **Integer Positioning**: Rounded pixel values for crisp rendering

### Memory Management
- **Animation Timers**: Proper cleanup with `clearInterval()`
- **Event Listeners**: Minimal DOM event attachment
- **State Copying**: Immutable state objects prevent reference issues

## 🔧 Extension Points

### Adding New Character Animations
1. **Create Sprite Sheet**: Export as PNG with consistent grid layout
2. **Update Animation Type**: Add to `'idle' | 'walking' | 'running'` union
3. **Configure Frames**: Set column count and background size
4. **Add Trigger Logic**: Update `updateMovementState()` conditions

### Adding New HQ Types
1. **Update HQType**: Add to enum in `GameState.ts`
2. **Add Icon**: Place SVG in `/icons` directory  
3. **Update Icon Map**: Add mapping in `ICON_MAP` constant
4. **Add Styling**: Define color and shape in `createHQMarker()`

### Adding UI Components
1. **HTML Structure**: Add elements to `index.html`
2. **Query Elements**: Add to `queryHudElements()` method
3. **Update Methods**: Create update methods called from controller
4. **Event Handlers**: Add click/interaction handling as needed

## 📱 Responsive Design

### Zoom-Based Scaling
All visual elements scale smoothly with map zoom:
- **Character Size**: 0.075 base size with logarithmic scaling
- **HQ Markers**: 1.0 base size with same scaling algorithm  
- **Icon Scaling**: 60% of marker size for proper proportions

### Visual Feedback
- **Cursor Changes**: Crosshair during HQ placement mode
- **Button States**: Active state styling for selected HQ types
- **Animation States**: Immediate visual feedback for input changes 
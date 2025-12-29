# Development Roadmap: Player Animation & NPC System
**Real-Earth Street War**

## Overview

This roadmap outlines the implementation strategy for evolving from the current triangle-based player marker to a fully animated character system, followed by a scalable NPC crowd simulation. The approach prioritizes incremental development with continuous testing and performance validation.

### Design Philosophy
- **Incremental Development**: Each phase builds on the previous, ensuring stable progress
- **Performance-First**: Web platform constraints guide all architectural decisions
- **Real-World Integration**: Leverage existing map data for authentic crowd behaviors
- **Scalable Architecture**: Design for future expansion to multiple regions and thousands of NPCs

---

## Phase 1: Player Character Animation Foundation
**Duration: 1-2 weeks** | **Risk: Low** | **Dependencies: Asset creation**

### Step 1.1: Asset Preparation
- **Create sprite asset structure** (`icons/player/` directory)
  - Organize by animation type: `idle/`, `walking/`, `running/`, `fighting/`
  - Recommended format: PNG with transparency
  - Target size: 32x32 or 64x64 pixels (balance between quality and performance)
- **Design animation states**: idle, walking, running, fighting
- **Prepare sprite frames** (4-8 frames per animation)
  - Idle: 2-4 frames (subtle breathing/swaying)
  - Walking: 6-8 frames (complete walk cycle)
  - Running: 4-6 frames (faster, more dynamic)
  - Fighting: 4-8 frames (attack sequence)
- **Optimize sprite sizes** for web delivery
- **Create sprite atlas** (optional optimization for Phase 2)

**📝 Note**: Start with simple placeholder sprites to validate the system, then refine artwork later.

### Step 1.2: Animation System Architecture
- **Extend GameState model** to include animation state tracking
  - Add `PlayerAnimationState` type
  - Add `animationState` and `speed` properties to PlayerCharacter
- **Create PlayerAnimator class** to manage frame cycling and state transitions
  - Frame timing and interpolation
  - State machine logic
  - Asset loading and caching
- **Define animation configuration** with JSON-like structure
  - Frame paths, frame rates, loop settings
  - Transition rules between states

**🎯 Goal**: Clean separation of animation logic from rendering and game logic.

### Step 1.3: Core Animation Engine
- **Implement frame-based animation system** using `requestAnimationFrame`
- **Create animation state machine** 
  - Transitions: idle ↔ walking ↔ running
  - Special: fighting → idle (one-shot animations)
- **Add frame interpolation logic** with configurable frame rates
  - Different rates for different animations (idle: 2fps, running: 12fps)
- **Build animation callback system** for notifying view of frame changes

**⚠️ Technical Consideration**: Use `performance.now()` for accurate frame timing, avoid `setInterval` for smooth animation.

### Step 1.4: Integration with Existing Movement
- **Modify GameController** to determine animation state based on movement speed
  - Use existing `PLAYER_MOVE_SPEED` constants
  - Add threshold detection for walk vs run
- **Update MapView** to handle sprite frame switching
  - Modify `updatePlayerFrame()` method
  - Maintain existing rotation and positioning logic
- **Replace triangle SVG** with animated sprite system
  - Preserve all existing functionality (scaling, rotation, positioning)

**🔄 Migration Strategy**: Implement alongside existing system first, then switch over to ensure no functionality is lost.

### Step 1.5: Testing & Polish
- **Test animation smoothness** at different zoom levels
- **Verify performance** with single animated character (should maintain 60fps)
- **Add animation state debugging** (visual indicators for development)
- **Optimize sprite loading** (preload all frames to prevent hitches)

**Success Criteria**: Smooth player animation at 60fps across all zoom levels and movement scenarios.

---

## Phase 2: Enhanced Player Animation
**Duration: 1 week** | **Risk: Low** | **Dependencies: Phase 1 complete**

### Step 2.1: Directional Animation
- **Create 8-directional sprite sets** (N, NE, E, SE, S, SW, W, NW)
  - Alternative: 4-directional with sprite flipping for horizontal directions
- **Implement direction-based sprite selection** based on player rotation
- **Add smooth direction transitions** to avoid jarring sprite switches
  - Use angular thresholds (22.5° sectors for 8-direction)
- **Optimize memory usage** with shared animation frames where possible

**💡 Optimization**: Consider 4-directional sprites with horizontal flipping to reduce asset count by 50%.

### Step 2.2: Advanced Animation States
- **Add combat animation triggers** for HQ placement or future conflicts
- **Implement animation queueing** (combat → return to movement state)
- **Create special action animations** (building placement, resource collection)
- **Add animation events** (sound triggers, particle effects hooks)

### Step 2.3: Performance Optimization
- **Implement sprite atlasing** to reduce texture switching overhead
- **Add animation LOD** (simpler animations at distant zoom levels)
- **Create sprite caching system** to avoid repeated loading
- **Measure and optimize** memory usage and frame rate

**Performance Target**: Maintain 60fps with full directional animation system.

---

## Phase 3: NPC Foundation Architecture
**Duration: 2-3 weeks** | **Risk: Medium** | **Dependencies: Player animation stable**

### Step 3.1: NPC Data Model Design
- **Design NPC class hierarchy**
  - Base NPC class with common properties
  - Specialized classes: Pedestrian, GangMember, Vehicle
- **Create vectorized data structures** using TypedArrays or ml-matrix
  - Positions, velocities, states in contiguous arrays
  - Enables efficient batch operations
- **Implement spatial partitioning system** (grid-based culling)
  - ~100m grid cells for New Jersey scale
- **Design NPC lifecycle management** (spawn, update, despawn)

**🏗️ Architecture Decision**: Use composition over inheritance for NPC behaviors to allow flexible mixing of traits.

### Step 3.2: Performance Infrastructure
- **Set up ml-matrix library** for vectorized operations
  - `npm install ml-matrix @types/ml-matrix`
- **Create NPC pool system** (object pooling for memory efficiency)
  - Pre-allocate NPCs to avoid garbage collection spikes
- **Implement visibility culling** (only update visible NPCs)
  - Use existing map bounds detection
- **Design level-of-detail system** 
  - Detailed (0-50m): Full AI and animation
  - Medium (50-200m): Basic AI, simple sprites
  - Distant (200-500m): Movement only, static sprites
  - Crowd (500m+): Density visualization

**📊 Performance Budget**: Allocate 30% of frame time to NPC systems, 70% to map rendering and player systems.

### Step 3.3: Basic NPC Rendering
- **Create Canvas-based renderer** for crowd NPCs
  - Overlay canvas on map container
  - Handle map movement and zoom updates
- **Implement hybrid rendering** 
  - DOM for hero NPCs (important characters)
  - Canvas for crowd NPCs (background population)
- **Set up sprite sharing system** (multiple NPCs using same sprites)
- **Add NPC marker scaling** based on zoom level

**🎨 Rendering Strategy**: Canvas allows 10x more NPCs than DOM-based approach while maintaining smooth performance.

---

## Phase 4: Basic NPC Behavior
**Duration: 2-3 weeks** | **Risk: Medium** | **Dependencies: ml-matrix integration**

### Step 4.1: Simple Movement
- **Implement basic pathfinding** 
  - Start with simple waypoint following
  - Upgrade to A* for hero NPCs later
- **Create random walk behavior** for ambient pedestrians
  - Constrained random movement with occasional direction changes
- **Add boundary constraints** (NPCs stay on roads/sidewalks)
  - Use existing map data layers for constraints
- **Implement collision avoidance** (basic separation behavior)
  - Simple radius-based avoidance to prevent overlapping

**🗺️ Map Integration**: Leverage existing PMTiles road data to constrain NPC movement to realistic paths.

### Step 4.2: NPC Types & Roles
- **Create pedestrian NPCs** (random movement, simple AI)
  - Basic citizens going about daily activities
- **Add gang member NPCs** (patrol routes, guard behavior)
  - Aligned with player's territory control system
- **Implement vehicle NPCs** (follow road networks)
  - Traffic simulation using road layers
- **Design NPC spawn system** (population density based on real-world data)
  - Use building footprint data for realistic density

**🏢 Real-World Data**: Use OpenStreetMap building density to determine realistic NPC spawn rates per area.

### Step 4.3: Performance Testing
- **Test with 50-100 NPCs** (establish baseline performance)
- **Measure frame rate impact** at different NPC counts
  - Target: 30fps minimum with 100 NPCs
- **Optimize update frequencies** (different rates for different NPC types)
  - Hero NPCs: 60fps updates
  - Crowd NPCs: 10-20fps updates
- **Implement dynamic NPC limits** based on device performance
  - Adaptive quality system

**📈 Performance Metrics**: Establish profiling tools to monitor CPU usage, memory consumption, and frame times.

---

## Phase 5: Advanced NPC Behaviors
**Duration: 3-4 weeks** | **Risk: High** | **Dependencies: Basic behaviors stable**

### Step 5.1: Steering Behaviors
- **Implement flocking behaviors** (separation, alignment, cohesion)
  - Classic Reynolds steering behaviors
  - Vectorized using ml-matrix for performance
- **Add crowd flow simulation** (NPCs following realistic pedestrian patterns)
  - Flow around obstacles, through bottlenecks
- **Create traffic simulation** for vehicle NPCs
  - Traffic lights, lane following, realistic car behavior
- **Add obstacle avoidance** (buildings, player, other NPCs)
  - Raycasting or potential fields for pathfinding

**🧠 AI Complexity**: This phase introduces significant computational overhead. Careful optimization required.

### Step 5.2: Intelligent NPCs
- **Create "hero" NPC system** (important characters with full AI)
  - Quest givers, vendors, rival gang leaders
  - Full pathfinding and complex behaviors
- **Implement NPC goals and objectives** (go to work, shop, patrol)
  - State machines for daily routines
- **Add time-based behavior changes** (different patterns day/night)
  - Integrate with existing game clock system
- **Create NPC interaction system** (respond to player presence)
  - Detection radius, flee/fight/neutral responses

### Step 5.3: Hierarchical AI
- **Implement group AI** (gang squads moving together)
  - Formation behaviors, coordinated movement
- **Add territorial behavior** (NPCs defending/patrolling areas)
  - Integration with territory control system
- **Create NPC communication** (alert systems, calling for help)
  - Information propagation through NPC networks
- **Add dynamic NPC spawning** (reinforcements, crowd events)
  - Event-driven population changes

**⚡ Risk Factor**: Complex AI can cause performance issues. Implement with careful profiling and fallback systems.

---

## Phase 6: Large-Scale Crowd System
**Duration: 3-4 weeks** | **Risk: High** | **Dependencies: TensorFlow.js integration**

### Step 6.1: Layered Population
- **Implement 4-tier system**:
  - **Tier 1**: Hero NPCs (20-50, full AI, DOM rendering)
    - Important characters with complex behaviors
  - **Tier 2**: Active NPCs (100-500, basic AI, Canvas rendering)
    - Local pedestrians and traffic
  - **Tier 3**: Background crowd (1000+, simple movement, particle-like)
    - Distant crowd simulation
  - **Tier 4**: Density visualization (unlimited, visual effects only)
    - Heat maps and flow indicators

**🏗️ System Architecture**: Each tier uses different update frequencies and rendering methods for optimal performance scaling.

### Step 6.2: Advanced Optimization
- **Add GPU acceleration** (TensorFlow.js for heavy crowd calculations)
  - `npm install @tensorflow/tfjs`
  - Move steering behaviors and pathfinding to GPU
- **Implement instanced rendering** for similar NPC types
  - Batch rendering of identical sprites
- **Create predictive loading** (spawn NPCs ahead of player movement)
  - Anticipate player path, preload areas
- **Add memory management** (automatic cleanup of distant NPCs)
  - Prevent memory leaks during long play sessions

**🚀 Performance Target**: 1000+ visible NPCs at 30fps on desktop, 500+ on mobile.

### Step 6.3: Real-World Integration
- **Use building footprint data** for realistic NPC density
  - Residential areas: moderate pedestrian density
  - Commercial areas: high pedestrian density
  - Industrial areas: vehicle-heavy, few pedestrians
- **Implement road network pathfinding** using map data
  - Extract road graphs from PMTiles data
- **Add time-of-day population changes** (rush hours, night/day cycles)
  - Dynamic density based on game time
- **Create event-driven crowds** (emergencies, gatherings)
  - Special events that affect crowd behavior

---

## Phase 7: Polish & Integration
**Duration: 2-3 weeks** | **Risk: Low** | **Dependencies: All systems functional**

### Step 7.1: Game Integration
- **Connect NPC system to territory control** (NPCs react to player influence)
  - Gang members respect territory boundaries
  - Civilians avoid conflict zones
- **Add NPC recruitment mechanics** (convert NPCs to gang members)
  - Extend existing HQ placement system
- **Implement NPC-player interactions** (combat, trading, information)
  - Foundation for future gameplay features
- **Create dynamic story events** involving NPCs
  - Random encounters, territory disputes

### Step 7.2: Performance & Scalability
- **Establish performance budgets** (target FPS at different NPC counts)
  - Desktop: 60fps with 500 NPCs, 30fps with 1000+
  - Mobile: 30fps with 200 NPCs, 15fps with 500+
- **Add adaptive quality settings** (automatic LOD adjustment)
  - Detect device capability and adjust accordingly
- **Implement save/load for NPC states** (persistence between sessions)
  - Essential NPCs maintain state across game sessions
- **Create debugging tools** (NPC count displays, performance metrics)
  - Development and user diagnostic tools

### Step 7.3: Final Optimization
- **Profile and optimize bottlenecks** using browser dev tools
  - Chrome DevTools performance analysis
- **Add user settings** for NPC density and quality
  - Accessibility and performance options
- **Test on various devices** (desktop, mobile, different GPUs)
  - Ensure compatibility across target platforms
- **Create fallback systems** for low-performance devices
  - Graceful degradation strategies

---

## Technical Dependencies

### Required Libraries
- **ml-matrix**: Vectorized operations for crowd calculations
- **@tensorflow/tfjs**: GPU acceleration for large-scale crowd simulation (Phase 6+)

### Asset Requirements
- **Player sprites**: ~32 PNG files (4 animations × 8 directions)
- **NPC sprites**: ~16-32 PNG files (basic character types)
- **Performance budget**: ~5-10MB additional assets

### Development Tools
- **Performance profiling**: Chrome DevTools
- **Asset optimization**: ImageOptim or similar
- **Version control**: Git branches for each phase

---

## Risk Assessment & Mitigation

### High-Risk Areas
1. **Phase 5-6**: Complex AI and large-scale simulation
   - **Mitigation**: Implement with feature flags, gradual rollout
2. **Performance on mobile devices**
   - **Mitigation**: Aggressive LOD system, adaptive quality
3. **Memory management with large NPC counts**
   - **Mitigation**: Object pooling, automatic cleanup

### Success Metrics

#### Performance Targets
- **Phase 1**: Single player animation at 60fps
- **Phase 4**: 50-100 NPCs at 30-60fps
- **Phase 6**: 1000+ visible NPCs at 30fps (desktop), 500+ (mobile)

#### Feature Milestones
- **Phase 1**: Animated player character replaces triangle
- **Phase 3**: First NPC appears and moves
- **Phase 5**: Realistic crowd behaviors visible
- **Phase 7**: Full integration with game mechanics

---

## Timeline Summary

| Phase | Duration | Cumulative | Key Deliverable |
|-------|----------|------------|-----------------|
| 1 | 1-2 weeks | 2 weeks | Animated player character |
| 2 | 1 week | 3 weeks | Directional player animation |
| 3 | 2-3 weeks | 6 weeks | Basic NPC architecture |
| 4 | 2-3 weeks | 9 weeks | Moving NPCs with simple AI |
| 5 | 3-4 weeks | 13 weeks | Intelligent crowd behaviors |
| 6 | 3-4 weeks | 17 weeks | Large-scale crowd simulation |
| 7 | 2-3 weeks | 20 weeks | Polished, integrated system |

**Total Estimated Duration: 4-5 months**

---

## Notes for Implementation

### Development Approach
- **Test-driven development**: Write tests for critical systems (animation state machine, NPC pooling)
- **Feature flags**: Implement new systems alongside existing ones, switch when stable
- **Continuous profiling**: Monitor performance impact at each step
- **Incremental deployment**: Each phase should be fully functional before moving to the next

### Architecture Principles
- **Separation of concerns**: Keep animation, AI, and rendering systems decoupled
- **Performance first**: Every decision evaluated for web performance impact
- **Scalability**: Design for thousands of NPCs from the beginning
- **Maintainability**: Clear interfaces and documentation for future development

This roadmap provides a structured approach to evolving your game from a simple character marker to a sophisticated crowd simulation while maintaining the performance and quality standards required for web-based gaming. 
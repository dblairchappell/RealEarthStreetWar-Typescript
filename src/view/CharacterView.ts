/**
 * CharacterView - Player Character Rendering and Animation System
 * 
 * CharacterView handles all aspects of the player character's visual representation,
 * including sprite rendering, animation, positioning, and camera-relative transformations.
 * It maintains separation of concerns from MapView by encapsulating all character-specific
 * rendering logic.
 * 
 * **Key Responsibilities:**
 * - **Sprite Rendering**: Creates and manages DOM elements for character sprite display
 * - **Animation System**: Handles sprite sheet animation (idle, walking, running)
 * - **Position Management**: Projects lat/lng coordinates to screen space and updates position
 * - **Camera Integration**: Applies camera pitch and bearing to sprite orientation
 * - **Pseudo-3D Effect**: Implements sprite stacking for depth perception
 * - **Zoom Scaling**: Dynamically adjusts sprite size based on map zoom level
 * 
 * **Architecture:**
 * - **DOM-Based Rendering**: Uses HTML div elements with CSS transforms for positioning
 * - **Sprite Sheet Animation**: Animates by shifting background-position across sprite frames
 * - **Slice Stacking**: Creates multiple layered divs for pseudo-3D depth effect (when not top-down)
 * - **Game Loop Integration**: Implements Updatable for frame-based animation updates
 * 
 * **Sprite Stacking (Pseudo-3D):**
 * When not in top-down mode, the character is rendered as multiple "slices" stacked
 * with slight Z-offsets. This creates a parallax effect that gives depth perception:
 * - Bottom slices fade out as camera pitch increases (looking down)
 * - Top slice receives drop shadow for depth
 * - CSS handles opacity transitions based on camera pitch
 * 
 * **Animation System:**
 * - Uses accumulator pattern to advance frames at correct rate regardless of frame time
 * - Supports multiple animation types (idle, walking, running) with different frame rates
 * - Automatically switches animations based on player movement state
 * - Frame advancement happens in update() method (integrated with game loop)
 * 
 * **Coordinate System:**
 * - Stores position in lat/lng (geographic coordinates)
 * - Projects to screen coordinates using map.project()
 * - Applies camera-relative rotation (player rotation relative to camera bearing)
 * - Centers sprite using translate(-50%, -50%) before positioning
 * 
 * **Performance:**
 * - Uses CSS transforms for positioning (GPU-accelerated)
 * - willChange: 'transform' hint for browser optimization
 * - pointer-events: none to prevent interaction overhead
 * - Single DOM update per frame (all slices updated atomically)
 * 
 * **Usage:**
 * Created by MapView and registered with GameLoop as an Updatable. MapView calls
 * methods to update position, rotation, and animation state based on game events.
 */

import { GTA1_STYLE_TOP_DOWN } from "../config";
import { Updatable } from "../loop/GameLoop";

/**
 * Manages the visual representation of the player character.
 * Handles sprite rendering, animation, positioning, and camera-relative transformations.
 */
export default class CharacterView implements Updatable {
  // Map instance reference (needed for coordinate projection)
  private map: any;
  
  // Character DOM elements
  private playerElement: HTMLElement | null = null; // Root container element for the character
  private spriteSlices: HTMLElement[] = []; // Array of slice divs (for pseudo-3D effect)
  
  // Character state
  private playerPosition: { lng: number; lat: number } | null = null; // Current position in lat/lng
  private playerRotation = 0; // Current rotation in radians (absolute, not relative to camera)
  private readonly playerBaseSize = 0.075; // Base size multiplier for zoom-based scaling
  private cameraPitch = 0; // Camera pitch angle (0 = horizontal, 90 = straight down)
  private cameraBearing = 0; // Camera rotation angle (for calculating relative character direction)

  // Animation state
  private currentFrame = 0; // Current frame index in sprite sheet (0-based)
  private frameAccumulator = 0; // Accumulated time for frame advancement (milliseconds)
  private frameRate = 12; // Frames per second for current animation (varies by animation type)
  private isPlayerMoving = false; // Whether player is currently moving (for animation switching)
  private currentAnimationType: "idle" | "walking" | "running" = "idle"; // Active animation type

  // Animation definitions: sprite sheet URLs, frame counts, and playback rates
  // Each animation is a horizontal sprite sheet with multiple frames
  private animations = {
    idle: {
      url: 'sprites/brian/brian_idling_31x1.png', // 31 frames in a single row
      frames: 31,
      frameRate: 12 // 12 frames per second
    },
    walking: {
      url: 'sprites/brian/brian_walking_forward_31x1.png',
      frames: 31,
      frameRate: 24 // Faster frame rate for walking animation
    },
    running: {
      url: 'sprites/brian/brian_running_forward_23x1.png',
      frames: 23,
      frameRate: 30 // Fastest frame rate for running animation
    }
  };

  // Input state (synced from MapView each frame)
  // Used to determine movement state and trigger animation switches
  public inputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
    running: false // Whether shift/run key is held
  };

  /**
   * Constructs a new CharacterView instance.
   * 
   * @param map - MapLibre map instance for coordinate projection
   */
  constructor(map: any) {
    this.map = map;
  }

  /**
   * Updates the camera bearing (rotation) angle.
   * Used to calculate relative character rotation so sprite faces correct direction
   * relative to camera view, not absolute map direction.
   * 
   * @param bearing - Camera bearing in degrees (0 = north, 90 = east, etc.)
   */
  public setCameraBearing(bearing: number): void {
    this.cameraBearing = bearing;
  }

  /**
   * Updates the camera pitch (vertical angle) angle.
   * Used for sprite fade effects and 3D rotation transforms.
   * 
   * @param pitch - Camera pitch in degrees (0 = horizontal, 90 = straight down)
   */
  public setCameraPitch(pitch: number): void {
    this.cameraPitch = pitch;
  }

  /**
   * Gets the current player position in lat/lng coordinates.
   * 
   * @returns Current position or null if not initialized
   */
  public getPlayerPosition(): { lng: number; lat: number } | null {
    return this.playerPosition;
  }

  /**
   * Gets the current player rotation in radians.
   * 
   * @returns Current rotation angle (0 = north, increases clockwise)
   */
  public getPlayerRotation(): number {
    return this.playerRotation;
  }

  /**
   * Calculates sprite size in pixels based on map zoom level.
   * Uses exponential scaling to maintain consistent visual size as user zooms.
   * 
   * Formula: size = baseSize * 2^((zoom - 10) / 1.2)
   * - At zoom 10: size = baseSize
   * - Zooming in: size increases exponentially
   * - Zooming out: size decreases exponentially
   * - Clamped between 1px (min) and 200px (max) to prevent extreme sizes
   * 
   * @param baseSize - Base size multiplier (typically playerBaseSize)
   * @param zoom - Optional zoom level (uses current map zoom if not provided)
   * @returns Calculated size in pixels
   */
  private calculateMarkerSize(baseSize: number, zoom?: number): number {
    const currentZoom = zoom ?? this.map.getZoom();
    const scale = Math.pow(2, (currentZoom - 10) / 1.2); // Exponential scaling
    return Math.max(1, Math.min(200, baseSize * scale)); // Clamp to reasonable range
  }

  /**
   * Creates the player character sprite and adds it to the map.
   * 
   * This method sets up the DOM structure for rendering the character:
   * - Creates a container element
   * - Creates multiple "slice" layers for pseudo-3D effect (when not top-down)
   * - Configures CSS variables for styling
   * - Initializes sprite animation
   * - Positions character on map
   * 
   * **Sprite Stacking (Pseudo-3D):**
   * When not in top-down mode, creates multiple div layers stacked with Z-offsets.
   * This creates a parallax effect:
   * - Bottom slices fade out as camera pitch increases (looking down)
   * - Top slice receives drop shadow
   * - CSS handles opacity transitions based on pitch
   * 
   * @param coords - Initial spawn coordinates (lat/lng)
   * @param rotation - Initial rotation in radians (default: 0)
   */
  public createPlayerCharacter(coords: { lng: number; lat: number }, rotation: number = 0): void {
    // Slice stack parameters for pseudo-3D effect
    const SLICE_COUNT = GTA1_STYLE_TOP_DOWN ? 1 : 3;   // Number of layers to stack (1 = flat, 3 = 3D effect)
    const SLICE_GAP   = GTA1_STYLE_TOP_DOWN ? 0 : 1;    // Z-offset gap between slices in pixels

    // Create root container element
    const container = document.createElement('div');
    container.id = 'character-container'; // CSS hook for styling
    container.style.pointerEvents = 'none'; // Allow clicks to pass through to map
    container.style.willChange = 'transform'; // Performance hint for browser optimization
    
    // Set CSS variable for slice count (used by stylesheet for calculations)
    container.style.setProperty('--num-slices', String(SLICE_COUNT));

    // Create multiple slice layers for pseudo-3D depth effect
    for (let i = 0; i < SLICE_COUNT; i++) {
      const slice = document.createElement('div');
      slice.className = 'character-sprite-slice';
      
      // Set slice index CSS variable (used for fade calculation in CSS)
      slice.style.setProperty('--slice-index', String(i));
      
      // Apply 3D Z-offset transform (creates depth separation)
      slice.style.transform = `translateZ(${i * SLICE_GAP}px)`;

      // Top slice gets special styling (drop shadow effect)
      if (i === SLICE_COUNT - 1) {
        slice.classList.add('top-slice');
      }

      container.appendChild(slice);
      this.spriteSlices.push(slice);
    }

    // Add container to map's DOM
    const mapContainer = this.map.getContainer();
    mapContainer.appendChild(container);

    // Store references and initial state
    this.playerElement = container;
    this.playerPosition = coords;
    this.playerRotation = rotation;

    // Initialize animation (idle state) and position sprite
    this.switchToAnimation('idle', true); // Force restart to ensure proper initialization
    this.updatePlayerScreenPosition();
  }

  /**
   * Updates character sprite size based on current zoom level.
   * Called by MapView during zoom events to maintain consistent visual size.
   * 
   * @param enableTransition - Whether to animate size changes (true during active zoom, false for instant updates)
   */
  public updateCharacterSize(enableTransition: boolean = false): void {
    if (!this.playerElement) return;
    
    // Calculate size based on current zoom level
    const zoom = this.map.getZoom();
    const playerSize = this.calculateMarkerSize(this.playerBaseSize, zoom);
    
    // Apply CSS transition only during active zoom (smooth size changes)
    // Disable transition for instant updates (prevents lag during rapid zoom)
    const transitionStyle = enableTransition ? 'width 0.1s ease, height 0.1s ease' : 'none';
    
    this.playerElement.style.transition = transitionStyle;
    this.playerElement.style.width = `${playerSize}px`;
    this.playerElement.style.height = `${playerSize}px`;
  }

  /**
   * Updates the player's screen position based on map coordinates.
   * 
   * This method:
   * 1. Projects lat/lng coordinates to screen space
   * 2. Calculates sprite size based on zoom
   * 3. Calculates pitch-based fade factor for slice opacity
   * 4. Applies CSS transform for positioning, centering, and rotation
   * 
   * The transform combines multiple operations:
   * - translate(-50%, -50%): Centers sprite on anchor point
   * - translate(x, y): Positions at screen coordinates
   * - rotateX(pitch): Applies camera pitch rotation (3D effect)
   * - rotateZ(rotation): Applies character rotation relative to camera bearing
   */
  private updatePlayerScreenPosition(): void {
    if (!this.playerElement || !this.playerPosition) return;

    // Project lat/lng to screen coordinates
    const point = this.map.project(this.playerPosition);
    
    // Calculate sprite size based on current zoom
    const size = this.calculateMarkerSize(this.playerBaseSize);

    // Update sprite dimensions
    this.playerElement.style.width = `${size}px`;
    this.playerElement.style.height = `${size}px`;

    // Calculate pitch-based fade factor for slice opacity
    // As camera pitch increases (looking down), bottom slices fade out
    // This creates a depth effect where only top slice is visible when looking straight down
    const fadeStartPitch = 20; // Pitch angle where fading begins (degrees)
    const fadeEndPitch = 85;   // Pitch angle where top layers are fully faded (degrees)
    const pitchRange = fadeEndPitch - fadeStartPitch;
    let fadeFactor = 0;
    if (this.cameraPitch > fadeStartPitch) {
        // Linear interpolation: 0 at fadeStartPitch, 1 at fadeEndPitch
        fadeFactor = Math.min(1, (this.cameraPitch - fadeStartPitch) / pitchRange);
    }
    // Set CSS variable for stylesheet to use in opacity calculations
    this.playerElement.style.setProperty('--pitch-fade-factor', fadeFactor.toString());

    // Round screen coordinates to nearest pixel (prevents sub-pixel blurring)
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    
    // Combined CSS transform:
    // 1. translate(-50%, -50%): Centers sprite on its anchor point
    // 2. translate(x, y): Positions at screen coordinates
    // 3. rotateX(pitch): Applies camera pitch rotation (3D tilt effect)
    // 4. rotateZ(rotation - bearing): Applies character rotation relative to camera
    //    (subtracts camera bearing so sprite faces correct direction relative to view)
    this.playerElement.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotateX(${this.cameraPitch}deg) rotateZ(${this.playerRotation - this.cameraBearing}deg)`;
  }

  /**
   * Forces a redraw of the character's screen position.
   * Useful for updates that don't change position but affect appearance (e.g., rotation, camera changes).
   * Called by MapView when camera moves but player position hasn't changed.
   */
  public redraw(): void {
    this.updatePlayerScreenPosition();
  }

  /**
   * Updates the player's position and rotation.
   * Called by MapView when player moves or rotates.
   * 
   * @param coords - New position in lat/lng coordinates
   * @param rotation - New rotation in radians
   */
  public updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    this.playerPosition = coords;
    this.playerRotation = rotation;
    this.updatePlayerScreenPosition();
  }

  /**
   * Updates the sprite frame displayed in all slices.
   * Shifts the background-position to show the correct frame in the sprite sheet.
   * 
   * Sprite sheets are horizontal strips: [frame0][frame1][frame2]...
   * Background-size is set to (frames * 100)% so each frame takes 1/frames of the width.
   * Background-position shifts horizontally to show the correct frame.
   * 
   * @param frame - Frame index to display (0-based)
   */
  private updateSpriteFrame(frame: number): void {
    if (this.spriteSlices.length === 0) return;

    const animation = this.animations[this.currentAnimationType];
    if (!animation) return;

    // Calculate horizontal position percentage
    // frame 0 = 0%, frame (frames-1) = 100%
    const x = frame * (100 / (animation.frames - 1));
    const pos = `${x}% 0%`; // Horizontal position, vertical stays at 0%
    
    // Update all slices atomically (prevents visual glitches)
    for (const slice of this.spriteSlices) {
      slice.style.backgroundPosition = pos;
    }
  }

  /**
   * Stops the current animation by resetting the frame accumulator.
   * Called when switching animations or stopping movement.
   */
  private stopPlayerAnimation(): void {
    this.frameAccumulator = 0; // Reset accumulator to stop frame advancement
  }

  /**
   * Checks if the player is currently moving based on input state.
   * Movement is detected if any directional key is pressed.
   * 
   * @returns True if player is moving, false otherwise
   */
  private checkIfPlayerMoving(): boolean {
    return this.inputState.forward ||
      this.inputState.backward ||
      this.inputState.left ||
      this.inputState.right;
  }

  /**
   * Updates the movement state and switches animations accordingly.
   * Called by MapView when input state changes (e.g., player starts/stops moving).
   * 
   * Animation selection logic:
   * - Not moving → idle animation
   * - Moving + running key → running animation
   * - Moving (no running key) → walking animation
   */
  public updateMovementState(): void {
    const wasMoving = this.isPlayerMoving;
    this.isPlayerMoving = this.checkIfPlayerMoving();
    
    // Determine target animation based on movement state
    let targetAnimation: 'idle' | 'walking' | 'running';
    if (!this.isPlayerMoving) {
      targetAnimation = 'idle';
    } else if (this.inputState.running) {
      targetAnimation = 'running';
    } else {
      targetAnimation = 'walking';
    }
    
    // Switch animation if state changed
    if (this.currentAnimationType !== targetAnimation) {
      this.switchToAnimation(targetAnimation);
    }
  }

  /**
   * Switches to a different animation type.
   * 
   * This method:
   * 1. Stops current animation
   * 2. Updates animation type and frame rate
   * 3. Changes sprite sheet for all slices atomically
   * 4. Resets frame counter and accumulator
   * 
   * All slice updates happen atomically to prevent visual glitches where
   * some slices show old animation and others show new animation.
   * 
   * @param animationType - Animation type to switch to
   * @param forceRestart - If true, restart even if already on this animation
   */
  private switchToAnimation(animationType: 'idle' | 'walking' | 'running', forceRestart: boolean = false): void {
    // Skip if already on this animation (unless forcing restart)
    if (this.currentAnimationType === animationType && !forceRestart) return;
    
    // Stop current animation
    this.stopPlayerAnimation();
    
    // Update state
    this.currentAnimationType = animationType;
    this.currentFrame = 0; // Reset to first frame
    
    const animation = this.animations[animationType];
    if (!animation) return;

    // Apply all changes atomically to all slices to prevent glitching
    // This ensures all slices switch at the same time
    for (const slice of this.spriteSlices) {
      slice.style.backgroundImage = `url(${animation.url})`; // Change sprite sheet
      slice.style.backgroundSize = `${animation.frames * 100}% 100%`; // Set size for frame count
      slice.style.backgroundPosition = '0% 0%'; // Reset to first frame
    }
    
    // Update frame rate for new animation
    this.frameRate = animation.frameRate;

    // Reset accumulator so frame advances start fresh
    this.frameAccumulator = 0;
  }

  /**
   * Cleans up resources when the character view is destroyed.
   * Removes DOM elements and resets state.
   * Called by MapView when cleaning up or switching scenes.
   */
  public destroy(): void {
    this.stopPlayerAnimation();
    
    // Remove DOM element from map container
    if (this.playerElement && this.playerElement.parentNode) {
      this.playerElement.parentNode.removeChild(this.playerElement);
    }
    
    // Reset all state
    this.playerElement = null;
    this.spriteSlices = [];
    this.playerPosition = null;
  }

  /**
   * Updatable implementation – called each frame by GameLoop.
   * 
   * Advances sprite animation frames using an accumulator pattern.
   * This ensures animations play at the correct rate regardless of frame time variations.
   * 
   * **Accumulator Pattern:**
   * - Accumulates elapsed time each frame
   * - When accumulated time exceeds frame duration, advance to next frame
   * - Can advance multiple frames if frame time is very large (catches up)
   * - Remaining time is preserved for next frame
   * 
   * Example: If frameRate = 12 fps, frameDuration = 83.33ms
   * - Frame 1: deltaMs = 16ms, accumulator = 16ms → no advance
   * - Frame 2: deltaMs = 16ms, accumulator = 32ms → no advance
   * - Frame 3: deltaMs = 16ms, accumulator = 48ms → no advance
   * - Frame 4: deltaMs = 16ms, accumulator = 64ms → no advance
   * - Frame 5: deltaMs = 16ms, accumulator = 80ms → no advance
   * - Frame 6: deltaMs = 16ms, accumulator = 96ms → advance frame, accumulator = 12.67ms
   * 
   * @param deltaMs - Time elapsed since last update (milliseconds)
   */
  public update(deltaMs: number): void {
    const anim = this.animations[this.currentAnimationType];
    if (!anim) return;

    // Calculate frame duration in milliseconds
    const frameDuration = 1000 / this.frameRate;
    
    // Accumulate elapsed time
    this.frameAccumulator += deltaMs;

    // Advance frames until caught up (handles frame drops)
    // Loop allows multiple frame advances if deltaMs is very large
    while (this.frameAccumulator >= frameDuration) {
      // Advance to next frame (wraps around using modulo)
      this.currentFrame = (this.currentFrame + 1) % anim.frames;
      
      // Update sprite display
      this.updateSpriteFrame(this.currentFrame);
      
      // Subtract frame duration from accumulator (preserve remainder)
      this.frameAccumulator -= frameDuration;
    }
  }
}

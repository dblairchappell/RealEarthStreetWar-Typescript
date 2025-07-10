/**
 * CharacterView handles all character rendering, animation, and sprite management.
 * This component is responsible for the visual representation of the player character
 * and maintains separation of concerns from MapView.
 */
export default class CharacterView {
  // Map instance reference
  private map: any;
  
  // Character DOM elements
  private playerElement: HTMLElement | null = null;
  private spriteSlices: HTMLElement[] = [];
  
  // Character state
  private playerPosition: { lng: number; lat: number } | null = null;
  private playerRotation = 0;
  private readonly playerBaseSize = 0.075;
  private cameraPitch = 0;
  private cameraBearing = 0; // Camera rotation for calculating relative direction

  // Animation state
  private currentFrame = 0;
  private animationTimer: number | null = null;
  private frameRate = 12;
  private isPlayerMoving = false;
  private currentAnimationType: "idle" | "walking" | "running" = "idle";

  private animations = {
    idle: {
      url: 'sprites/brian/brian_idling_31x1.png',
      frames: 31,
      frameRate: 12
    },
    walking: {
      url: 'sprites/brian/brian_walking_forward_31x1.png',
      frames: 31,
      frameRate: 24
    },
    running: {
      url: 'sprites/brian/brian_running_forward_23x1.png',
      frames: 23,
      frameRate: 30
    }
  };

  // Input state (synced from MapView)
  public inputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
    running: false
  };

  constructor(map: any) {
    this.map = map;
  }

  /**
   * Updates the camera bearing for proper character direction calculation
   */
  public setCameraBearing(bearing: number): void {
    this.cameraBearing = bearing;
  }

  public setCameraPitch(pitch: number): void {
    this.cameraPitch = pitch;
  }

  /**
   * Gets the current player position
   */
  public getPlayerPosition(): { lng: number; lat: number } | null {
    return this.playerPosition;
  }

  /**
   * Gets the current player rotation
   */
  public getPlayerRotation(): number {
    return this.playerRotation;
  }

  /**
   * Calculates marker size based on zoom level
   */
  private calculateMarkerSize(baseSize: number, zoom?: number): number {
    const currentZoom = zoom ?? this.map.getZoom();
    const scale = Math.pow(2, (currentZoom - 10) / 1.2);
    return Math.max(1, Math.min(200, baseSize * scale));
  }

  /**
   * Creates the player character sprite and adds it to the map
   */
  public createPlayerCharacter(coords: { lng: number; lat: number }, rotation: number = 0): void {
    // Slice stack parameters
    const SLICE_COUNT = 3;   // How many layers to stack for the 3D effect.
    const SLICE_GAP   = 1;    // The gap in `px` between each slice.

    const container = document.createElement('div');
    container.id = 'character-container'; // Hook into the stylesheet for 3D context
    container.style.pointerEvents = 'none'; // Clicks should pass through to the map
    container.style.willChange = 'transform'; // Performance hint
    
    // Set CSS variables that the stylesheet will use for calculations
    container.style.setProperty('--num-slices', String(SLICE_COUNT));

    // Create multiple slice layers
    for (let i = 0; i < SLICE_COUNT; i++) {
      const slice = document.createElement('div');
      slice.className = 'character-sprite-slice';
      
      // Set a variable for this slice's index, used for the fade calculation in CSS
      slice.style.setProperty('--slice-index', String(i));
      
      // The actual 3D offset for this slice
      slice.style.transform = `translateZ(${i * SLICE_GAP}px)`;

      // The top slice gets a special class for the drop-shadow effect
      if (i === SLICE_COUNT - 1) {
        slice.classList.add('top-slice');
      }

      container.appendChild(slice);
      this.spriteSlices.push(slice);
    }

    const mapContainer = this.map.getContainer();
    mapContainer.appendChild(container);

    this.playerElement = container;
    this.playerPosition = coords;
    this.playerRotation = rotation;

    this.switchToAnimation('idle', true);
    this.updatePlayerScreenPosition();
  }

  /**
   * Updates character size based on current zoom level
   * Called by MapView during zoom events
   */
  public updateCharacterSize(enableTransition: boolean = false): void {
    if (!this.playerElement) return;
    
    const zoom = this.map.getZoom();
    const playerSize = this.calculateMarkerSize(this.playerBaseSize, zoom);
    
    // Apply transition based on whether we're actively zooming
    const transitionStyle = enableTransition ? 'width 0.1s ease, height 0.1s ease' : 'none';
    
    this.playerElement.style.transition = transitionStyle;
    this.playerElement.style.width = `${playerSize}px`;
    this.playerElement.style.height = `${playerSize}px`;
  }

  /**
   * Updates the player's screen position based on map coordinates
   */
  private updatePlayerScreenPosition(): void {
    if (!this.playerElement || !this.playerPosition) return;

    const point = this.map.project(this.playerPosition);
    const size = this.calculateMarkerSize(this.playerBaseSize);

    this.playerElement.style.width = `${size}px`;
    this.playerElement.style.height = `${size}px`;

    // Calculate the fade factor based on camera pitch and set it as a CSS variable.
    // The CSS will handle the rest of the opacity calculations.
    const fadeStartPitch = 60; // Pitch at which fading begins
    const fadeEndPitch = 85;   // Pitch at which top layers are fully faded
    const pitchRange = fadeEndPitch - fadeStartPitch;
    let fadeFactor = 0;
    if (this.cameraPitch > fadeStartPitch) {
        fadeFactor = Math.min(1, (this.cameraPitch - fadeStartPitch) / pitchRange);
    }
    this.playerElement.style.setProperty('--pitch-fade-factor', fadeFactor.toString());

    const x = Math.round(point.x);
    const y = Math.round(point.y);
    
    // This single transform positions the character, centers it, and applies pitch/bearing rotations.
    // translate(-50%, -50%) centers the element on its anchor point before positioning.
    this.playerElement.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotateX(${this.cameraPitch}deg) rotateZ(${this.playerRotation - this.cameraBearing}deg)`;
  }

  /**
   * Forces a redraw of the character's screen position.
   * Useful for updates that don't change position but affect appearance, like rotation.
   */
  public redraw(): void {
    this.updatePlayerScreenPosition();
  }

  /**
   * Updates the player's position and rotation
   * Handles direction changes and triggers animation updates
   */
  public updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    this.playerPosition = coords;
    this.playerRotation = rotation;
    this.updatePlayerScreenPosition();
  }

  private updateSpriteFrame(frame: number): void {
    if (this.spriteSlices.length === 0) return;

    const animation = this.animations[this.currentAnimationType];
    if (!animation) return;

    const x = frame * (100 / (animation.frames - 1));
    const pos = `${x}% 0%`;
    // Update all slices
    for (const slice of this.spriteSlices) {
      slice.style.backgroundPosition = pos;
    }
  }

  private stopPlayerAnimation(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  /**
   * Checks if the player is currently moving based on input state
   */
  private checkIfPlayerMoving(): boolean {
    return this.inputState.forward ||
      this.inputState.backward ||
      this.inputState.left ||
      this.inputState.right;
  }

  /**
   * Updates the movement state and switches animations accordingly
   * Called by MapView when input state changes
   */
  public updateMovementState(): void {
    const wasMoving = this.isPlayerMoving;
    this.isPlayerMoving = this.checkIfPlayerMoving();
    let targetAnimation: 'idle' | 'walking' | 'running';
    if (!this.isPlayerMoving) {
      targetAnimation = 'idle';
    } else if (this.inputState.running) {
      targetAnimation = 'running';
    } else {
      targetAnimation = 'walking';
    }
    if (this.currentAnimationType !== targetAnimation) {
      this.switchToAnimation(targetAnimation);
    }
  }

  private switchToAnimation(animationType: 'idle' | 'walking' | 'running', forceRestart: boolean = false): void {
    if (this.currentAnimationType === animationType && !forceRestart) return;
    
    this.stopPlayerAnimation();
    this.currentAnimationType = animationType;
    this.currentFrame = 0;
    
    const animation = this.animations[animationType];
    if (!animation) return;

    // Apply all changes atomically to all slices to prevent glitching
    for (const slice of this.spriteSlices) {
      slice.style.backgroundImage = `url(${animation.url})`;
      slice.style.backgroundSize = `${animation.frames * 100}% 100%`;
      slice.style.backgroundPosition = '0% 0%';
    }
    this.frameRate = animation.frameRate;

    this.animationTimer = window.setInterval(() => {
        const anim = this.animations[this.currentAnimationType];
        if (!anim) return;
        
        this.currentFrame = (this.currentFrame + 1) % anim.frames;
        this.updateSpriteFrame(this.currentFrame);
    }, 1000 / this.frameRate);
  }

  /**
   * Cleans up resources when the character view is destroyed
   */
  public destroy(): void {
    this.stopPlayerAnimation();
    if (this.playerElement && this.playerElement.parentNode) {
      this.playerElement.parentNode.removeChild(this.playerElement);
    }
    this.playerElement = null;
    this.spriteSlices = [];
    this.playerPosition = null;
  }
}

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
  private playerSprite: HTMLElement | null = null;
  
  // Character state
  private playerPosition: { lng: number; lat: number } | null = null;
  private playerRotation = 0;
  private readonly playerBaseSize = 0.075;
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
    const baseSize = this.playerBaseSize;
    const size = this.calculateMarkerSize(baseSize);

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.width = `${size}px`;
    container.style.height = `${size}px`;
    container.style.transformStyle = 'preserve-3d';
    container.style.perspective = '1000px';
    container.style.zIndex = '1000';
    container.style.pointerEvents = 'none';
    container.style.willChange = 'transform';

    const billboard = document.createElement('div');
    billboard.style.position = 'absolute';
    billboard.style.width = `${size}px`;
    billboard.style.height = `${size}px`;
    billboard.style.transformStyle = 'preserve-3d';
    billboard.style.willChange = 'transform';

    const screen = document.createElement('div');
    screen.style.position = 'absolute';
    screen.style.width = `${size}px`;
    screen.style.height = `${size}px`;
    screen.style.backgroundColor = 'transparent';
    screen.style.border = 'none';
    screen.style.borderRadius = '0';
    screen.style.overflow = 'hidden';
    screen.style.boxShadow = 'none';

    const characterSprite = document.createElement('div');
    characterSprite.style.width = '100%';
    characterSprite.style.height = '100%';
    characterSprite.style.backgroundImage = `url(${this.animations.idle.url})`;
    characterSprite.style.backgroundSize = `${this.animations.idle.frames * 100}% 100%`;
    characterSprite.style.backgroundRepeat = 'no-repeat';
    characterSprite.style.backgroundPosition = '0% 0%';
    characterSprite.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
    characterSprite.style.imageRendering = 'auto';
    screen.appendChild(characterSprite);

    this.playerSprite = characterSprite;

    billboard.appendChild(screen);
    container.appendChild(billboard);

    const mapContainer = this.map.getContainer();
    mapContainer.appendChild(container);

    this.playerElement = container;
    this.playerPosition = coords;
    this.playerRotation = rotation;

    this.switchToAnimation('idle', true);
    this.updatePlayerScreenPosition();

    this.map.on('move', () => this.updatePlayerScreenPosition());
    this.map.on('zoom', () => this.updatePlayerScreenPosition());
    
    // Note: The cinematic zoom is handled by MapView
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
    
    // Update billboard and screen sizes
    const billboard = this.playerElement.querySelector('div');
    const screen = billboard?.querySelector('div');
    if (billboard) {
      billboard.style.transition = transitionStyle;
      billboard.style.width = `${playerSize}px`;
      billboard.style.height = `${playerSize}px`;
    }
    if (screen) {
      screen.style.transition = transitionStyle;
      screen.style.width = `${playerSize}px`;
      screen.style.height = `${playerSize}px`;
      
      // Sprite always fills its container
      const sprite = screen.querySelector('div');
      if (sprite) {
        sprite.style.width = '100%';
        sprite.style.height = '100%';
      }
    }
  }

  /**
   * Updates the player's screen position based on map coordinates
   */
  private updatePlayerScreenPosition(): void {
    if (!this.playerElement || !this.playerPosition) return;

    const point = this.map.project(this.playerPosition);
    const rawSize = this.calculateMarkerSize(this.playerBaseSize);
    const size = Math.max(8, rawSize);

    this.playerElement.style.width = `${size}px`;
    this.playerElement.style.height = `${size}px`;

    const billboard = this.playerElement.querySelector('div');
    const screen = billboard?.querySelector('div');
    if (billboard) {
      billboard.style.width = `${size}px`;
      billboard.style.height = `${size}px`;
      billboard.style.transform = `rotateZ(${this.playerRotation - this.cameraBearing}deg)`;
    }
    if (screen) {
      screen.style.width = `${size}px`;
      screen.style.height = `${size}px`;
      const sprite = screen.querySelector('div') as HTMLElement;
      if (sprite) {
        sprite.style.width = '100%';
        sprite.style.height = '100%';
        if (size < 16) {
          sprite.style.imageRendering = 'auto';
        } else if (size < 32) {
          sprite.style.imageRendering = 'auto';
        } else {
          sprite.style.imageRendering = 'pixelated';
        }
      }
    }

    const x = Math.round(point.x - size / 2);
    const y = Math.round(point.y - size / 2);
    this.playerElement.style.transform = `translate(${x}px, ${y}px)`;
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
    if (!this.playerSprite) return;

    const animation = this.animations[this.currentAnimationType];
    if (!animation) return;

    const x = frame * (100 / (animation.frames - 1));
    this.playerSprite.style.backgroundPosition = `${x}% 0%`;
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
    if (!this.playerSprite || !animation) return;

    // Apply all changes atomically to prevent glitching
    this.playerSprite.style.backgroundImage = `url(${animation.url})`;
    this.playerSprite.style.backgroundSize = `${animation.frames * 100}% 100%`;
    this.playerSprite.style.backgroundPosition = '0% 0%'; // Reset to first frame immediately
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
    this.playerSprite = null;
    this.playerPosition = null;
  }
}

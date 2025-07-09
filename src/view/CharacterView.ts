import type maplibregl from "maplibre-gl";

/**
 * CharacterView – exact clone of MapView’s character logic.
 * For now MapView will continue to use its own copy; this file
 * is only a staging area so we can incrementally migrate.
 */
export default class CharacterView {

  // injected
  private map: any;
  constructor(map: any) { this.map = map; }

  // ------------------------------------------------------------------
  // 100 % COPY of the fields and methods that were in MapView
  // ------------------------------------------------------------------

  // --- state copied from MapView ------------------------------------
  private playerElement: HTMLElement | null = null;
  private playerSprite: HTMLElement | null = null;
  private playerPosition: { lng: number; lat: number } | null = null;
  private playerRotation = 0;
  private readonly playerBaseSize = 0.075;
  private cameraBearing = 0; // For getDirectionFromRotation

  private currentPlayerDirection: string = "south";
  private currentFrame = 0;
  private animationTimer: number | null = null;
  private frameRate = 12;
  private isPlayerMoving = false;
  private currentAnimationType: "idle" | "walking" | "running" = "idle";

  public inputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateLeft: false,
    rotateRight: false,
    running: false
  };

  // -------------------- * VERBATIM METHODS * ------------------------

  public setCameraBearing(bearing: number): void {
    this.cameraBearing = bearing;
  }

  private calculateMarkerSize(baseSize: number, zoom?: number): number {
    const currentZoom = zoom ?? this.map.getZoom();
    const scale = Math.pow(2, (currentZoom - 10) / 1.2);
    return Math.max(1, Math.min(200, baseSize * scale));
  }

  createPlayerCharacter(coords: { lng: number; lat: number }, rotation: number = 0): void {
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
    characterSprite.style.backgroundImage = 'url(sprites/isometric_character_pack/isometric_character_idle.png)';
    characterSprite.style.backgroundSize = '800% 800%';
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

    this.currentPlayerDirection = this.getDirectionFromRotation(rotation);
    this.switchToAnimation('idle', true);
    this.updatePlayerScreenPosition();

    this.map.on('move', () => this.updatePlayerScreenPosition());
    this.map.on('zoom', () => this.updatePlayerScreenPosition());

    this.map.easeTo({
      center: coords,
      zoom: 21.5,
      duration: 3000
    });
  }

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

  updatePlayerPosition(coords: { lng: number; lat: number }, rotation: number): void {
    this.playerPosition = coords;
    this.playerRotation = rotation;
    const newDirection = this.getDirectionFromRotation(rotation);
    if (newDirection !== this.currentPlayerDirection) {
      this.currentPlayerDirection = newDirection;
      this.startDirectionalAnimation(newDirection);
    }
    this.updatePlayerScreenPosition();
  }

  private getDirectionFromRotation(rotation: number): string {
    const relativeRotation = rotation - this.cameraBearing;
    const normalizedRotation = ((relativeRotation % 360) + 360) % 360;
    if (normalizedRotation >= 337.5 || normalizedRotation < 22.5) return 'north';
    if (normalizedRotation >= 22.5 && normalizedRotation < 67.5) return 'northeast';
    if (normalizedRotation >= 67.5 && normalizedRotation < 112.5) return 'east';
    if (normalizedRotation >= 112.5 && normalizedRotation < 157.5) return 'southeast';
    if (normalizedRotation >= 157.5 && normalizedRotation < 202.5) return 'south';
    if (normalizedRotation >= 202.5 && normalizedRotation < 247.5) return 'southwest';
    if (normalizedRotation >= 247.5 && normalizedRotation < 292.5) return 'west';
    if (normalizedRotation >= 292.5 && normalizedRotation < 337.5) return 'northwest';
    return 'south';
  }

  private startDirectionalAnimation(direction: string): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    const rowMap: { [key: string]: number } = {
      'south': 0, 'southeast': 1, 'southwest': 2, 'west': 3,
      'northwest': 4, 'north': 5, 'northeast': 6, 'east': 7
    };
    const row = rowMap[direction] || 0;
    this.currentFrame = 0;
    let frameCount: number;
    if (this.currentAnimationType === 'idle') {
      frameCount = 8;
    } else if (this.currentAnimationType === 'running') {
      frameCount = 6;
    } else {
      frameCount = 12;
    }
    this.updateSpriteFrame(row, this.currentFrame);
    this.animationTimer = window.setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % frameCount;
      this.updateSpriteFrame(row, this.currentFrame);
    }, 1000 / this.frameRate);
  }

  private updateSpriteFrame(row: number, frame: number): void {
    if (this.playerSprite) {
      let columnCount: number;
      if (this.currentAnimationType === 'idle') {
        columnCount = 8;
      } else if (this.currentAnimationType === 'running') {
        columnCount = 6;
      } else {
        columnCount = 12;
      }
      const x = Math.round((frame * 100) / (columnCount - 1) * 100) / 100;
      const y = Math.round((row * 100) / (8 - 1) * 100) / 100;
      this.playerSprite.style.backgroundPosition = `${x}% ${y}%`;
    }
  }

  private stopPlayerAnimation(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  private checkIfPlayerMoving(): boolean {
    return this.inputState.forward ||
      this.inputState.backward ||
      this.inputState.left ||
      this.inputState.right;
  }

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

  switchToAnimation(animationType: 'idle' | 'walking' | 'running', forceRestart: boolean = false): void {
    if (this.currentAnimationType === animationType && !forceRestart) return;
    this.currentAnimationType = animationType;
    if (this.playerSprite) {
      if (animationType === 'idle') {
        this.playerSprite.style.backgroundImage = 'url(sprites/isometric_character_pack/isometric_character_idle.png)';
        this.playerSprite.style.backgroundSize = '800% 800%';
      } else if (animationType === 'running') {
        this.playerSprite.style.backgroundImage = 'url(sprites/isometric_character_pack/isometric_character_run.png)';
        this.playerSprite.style.backgroundSize = '600% 800%';
      } else {
        this.playerSprite.style.backgroundImage = 'url(sprites/isometric_character_pack/isometric_character_walk.png)';
        this.playerSprite.style.backgroundSize = '1200% 800%';
      }
    }
    this.startDirectionalAnimation(this.currentPlayerDirection);
  }
}

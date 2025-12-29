/**
 * NpcDomLayer - DOM-Based NPC Rendering Layer
 * 
 * This class provides a DOM-based rendering layer for NPCs. It's used when
 * NPC_RENDER_PATH = 'dom' in config.ts. This rendering path uses DOM elements
 * with CSS transforms, similar to PlayerDomView for the player.
 * 
 * Architecture:
 * 
 * - Creates individual DOM elements for each NPC entity
 * - Renders NPCs as sprites with rotation support using CSS transforms
 * - Uses stored rotation from ECS (Rotation.angle) - consistent with other paths
 * - Uses map.project() to convert lat/lng to screen coordinates (works with any projection)
 * - Queries ECS world directly for NPC positions
 * - Manages DOM element lifecycle (create/update/remove)
 * - Supports sprite animations (idle, walking, running)
 * - Handles NPC selection (red outline via CSS class)
 * 
 * Comparison with other rendering paths:
 * 
 * | Feature              | NpcInstancedLayer | NpcLayer        | NpcDomLayer     |
 * |---------------------|-------------------|-----------------|-----------------|
 * | Technology          | WebGL (GPU)       | Canvas 2D (CPU) | DOM + CSS       |
 * | Performance         | Fast              | Slower          | Moderate        |
 * | Projection Support  | Mercator only     | Any projection  | Any projection  |
 * | Visual Quality      | Sprites           | Sprites         | Sprites         |
 * | Complexity          | High              | Medium          | Medium          |
 * | Scalability         | Excellent         | Good            | Moderate        |
 * 
 * Usage:
 * 
 * This layer is automatically used when NPC_RENDER_PATH = 'dom' in config.ts.
 * It's registered with the game loop as a Renderable and Updatable.
 */

import { Renderable, Updatable } from "../loop/GameLoop";
import { defineQuery } from "bitecs";
import { world } from "../ecs/world";
import { Position, Rotation, Velocity } from "../ecs/world";
import { NpcTag } from "@shared/realearthstreetwar";
import { NPC_SPRITE_SIZE_MULTIPLIER } from "../config";
import { calculateSpriteSize, calculateRotationFromStored } from "./utils/spriteUtils";
import { SPRITE_ANIMATIONS, VELOCITY_THRESHOLD, BASE_NPC_SPEED } from "./utils/spriteAnimations";
import { isEntityVisible, calculateSpritePaddingDegrees } from "./utils/viewportCulling";

interface NpcDomElement {
  container: HTMLElement;
  spriteSlice: HTMLElement;
  eid: number;
}

export default class NpcDomLayer implements Renderable, Updatable {
  /** Map instance for coordinate projection */
  private map: any;
  
  /** Root container for all NPC DOM elements */
  private rootContainer: HTMLElement;
  
  /** Map of entity ID to DOM element structure */
  private npcElements: Map<number, NpcDomElement> = new Map();
  
  /** ECS query to find all NPC entities */
  private query = defineQuery([NpcTag, Position, Rotation, Velocity]);
  
  /** Currently selected NPC entity ID (for red outline) */
  private selectedNpcEid: number | null = null;
  
  /** Animation definitions (same as other rendering paths) */
  private animations = SPRITE_ANIMATIONS;
  
  /** Sprite images and loading state */
  private spriteImages: {
    idle: HTMLImageElement | null;
    walking: HTMLImageElement | null;
    running: HTMLImageElement | null;
  } = {
    idle: null,
    walking: null,
    running: null
  };
  
  private spritesLoaded = {
    idle: false,
    walking: false,
    running: false
  };
  
  /** Per-NPC animation state */
  private npcAnimationState: Map<number, {
    accumulator: number;
    currentFrame: number;
    animType: 'idle' | 'walking' | 'running';
  }> = new Map();
  
  /** Velocity threshold for determining animation type */
  private readonly velocityThreshold = VELOCITY_THRESHOLD;
  
  /** Base size multiplier */
  private readonly npcBaseSize = NPC_SPRITE_SIZE_MULTIPLIER;
  
  /** Storage for NPC speeds (from server snapshot) - used for animation scaling */
  private npcSpeeds: Map<number, number> = new Map();
  private readonly baseSpeed = BASE_NPC_SPEED;
  
  /** Current camera bearing (for rotation calculation) */
  private cameraBearing = 0;
  
  /** Current camera pitch (for 3D effect) */
  private cameraPitch = 0;
  
  /** Cached viewport bounds for culling (updated on camera move) */
  private cachedBounds: { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number } | null = null;
  private cachedPaddingDegrees: number = 0;
  
  /** DocumentFragment for batching DOM element creation */
  private pendingElementsFragment: DocumentFragment | null = null;
  
  /** Array of elements to remove (batched) */
  private elementsToRemove: HTMLElement[] = [];
  
  /**
   * Constructor - sets up the DOM container.
   * 
   * Creates a root container element and positions it absolutely over the map.
   * Loads sprite images asynchronously.
   * 
   * @param map - MapLibre GL map instance
   */
  constructor(map: any) {
    this.map = map;
    
    // Create root container for all NPC elements
    this.rootContainer = document.createElement('div');
    this.rootContainer.id = 'npc-container';
    this.rootContainer.style.position = 'absolute';
    this.rootContainer.style.top = '0';
    this.rootContainer.style.left = '0';
    this.rootContainer.style.width = '100%';
    this.rootContainer.style.height = '100%';
    this.rootContainer.style.zIndex = '999'; // Below player (1000) but above map
    this.rootContainer.style.pointerEvents = 'none'; // Allow clicks to pass through
    this.rootContainer.style.overflow = 'hidden'; // Prevent overflow
    
    // Add container to map's DOM
    const mapContainer = this.map.getContainer();
    mapContainer.appendChild(this.rootContainer);
    
    // Listen for map events
    this.map.on('resize', () => this.handleMapResize());
    this.map.on('move', () => {
      this.updateCameraState();
      this.updateViewportBounds();
    });
    this.map.on('rotate', () => {
      this.updateCameraState();
      this.updateViewportBounds();
    });
    this.map.on('pitch', () => {
      this.updateCameraState();
      this.updateViewportBounds();
    });
    this.map.on('zoom', () => {
      this.updateViewportBounds();
    });
    
    // Update camera state and viewport bounds initially
    this.updateCameraState();
    this.updateViewportBounds();
    
    // Load all sprite images asynchronously
    this.loadSprites();
  }
  
  /**
   * Update camera state from map
   */
  private updateCameraState(): void {
    this.cameraBearing = this.map.getBearing();
    this.cameraPitch = this.map.getPitch();
  }
  
  /**
   * Update cached viewport bounds for culling
   */
  private updateViewportBounds(): void {
    this.cachedBounds = this.map.getBounds();
    const zoom = this.map.getZoom();
    const spriteSize = calculateSpriteSize(this.npcBaseSize, zoom);
    this.cachedPaddingDegrees = calculateSpritePaddingDegrees(this.map, spriteSize, zoom);
  }
  
  /**
   * Handle map resize
   */
  private handleMapResize(): void {
    const { clientWidth, clientHeight } = this.map.getContainer();
    this.rootContainer.style.width = `${clientWidth}px`;
    this.rootContainer.style.height = `${clientHeight}px`;
  }
  
  /**
   * Loads all sprite images asynchronously (idle, walking, running).
   * Sets spritesLoaded flags when ready.
   */
  private loadSprites(): void {
    // Load idle sprite
    const idleImg = new Image();
    idleImg.onload = () => {
      this.spriteImages.idle = idleImg;
      this.spritesLoaded.idle = true;
    };
    idleImg.onerror = () => {
      console.warn('[NpcDomLayer] Failed to load idle sprite:', this.animations.idle.url);
    };
    idleImg.src = this.animations.idle.url;
    
    // Load walking sprite
    const walkingImg = new Image();
    walkingImg.onload = () => {
      this.spriteImages.walking = walkingImg;
      this.spritesLoaded.walking = true;
    };
    walkingImg.onerror = () => {
      console.warn('[NpcDomLayer] Failed to load walking sprite:', this.animations.walking.url);
    };
    walkingImg.src = this.animations.walking.url;
    
    // Load running sprite
    const runningImg = new Image();
    runningImg.onload = () => {
      this.spriteImages.running = runningImg;
      this.spritesLoaded.running = true;
    };
    runningImg.onerror = () => {
      console.warn('[NpcDomLayer] Failed to load running sprite:', this.animations.running.url);
    };
    runningImg.src = this.animations.running.url;
  }
  
  /**
   * Determines which animation type to use based on velocity.
   * 
   * @param velocityX - Velocity X component
   * @param velocityY - Velocity Y component
   * @returns Animation type: 'idle', 'walking', or 'running'
   */
  private determineAnimationType(velocityX: number, velocityY: number): 'idle' | 'walking' | 'running' {
    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    
    if (speed < this.velocityThreshold) {
      return 'idle';
    }
    
    return 'walking';
  }
  
  /**
   * Creates a DOM element structure for an NPC.
   * Elements are added to a DocumentFragment for batched DOM insertion.
   * 
   * @param eid - Entity ID
   * @returns NpcDomElement structure
   */
  private createNpcElement(eid: number): NpcDomElement {
    // Create container element
    const container = document.createElement('div');
    container.className = 'npc-sprite-container';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.willChange = 'transform';
    container.style.pointerEvents = 'none';
    container.style.imageRendering = 'pixelated';
    container.style.imageRendering = '-moz-crisp-edges';
    container.style.imageRendering = 'crisp-edges';
    
    // Create sprite slice (single slice for simplicity, matching current PlayerDomView)
    const spriteSlice = document.createElement('div');
    spriteSlice.className = 'npc-sprite-slice';
    spriteSlice.style.width = '100%';
    spriteSlice.style.height = '100%';
    spriteSlice.style.backgroundRepeat = 'no-repeat';
    spriteSlice.style.backgroundPosition = '0% 0%';
    // backgroundSize will be set when sprite image is loaded
    
    container.appendChild(spriteSlice);
    
    // Add to DocumentFragment for batched DOM insertion
    if (!this.pendingElementsFragment) {
      this.pendingElementsFragment = document.createDocumentFragment();
    }
    this.pendingElementsFragment.appendChild(container);
    
    return {
      container,
      spriteSlice,
      eid
    };
  }
  
  /**
   * Flushes pending DOM element insertions by appending the DocumentFragment.
   * This batches all element creation into a single DOM operation.
   */
  private flushPendingElements(): void {
    if (this.pendingElementsFragment && this.pendingElementsFragment.childNodes.length > 0) {
      this.rootContainer.appendChild(this.pendingElementsFragment);
      this.pendingElementsFragment = null;
    }
  }
  
  /**
   * Removes DOM element for an NPC.
   * Elements are queued for batched removal.
   * 
   * @param eid - Entity ID
   */
  private removeNpcElement(eid: number): void {
    const element = this.npcElements.get(eid);
    if (element) {
      // Queue for batched removal instead of removing immediately
      this.elementsToRemove.push(element.container);
      this.npcElements.delete(eid);
      this.npcAnimationState.delete(eid);
      this.npcSpeeds.delete(eid);
    }
  }
  
  /**
   * Flushes pending DOM element removals by removing all queued elements.
   * This batches all element removal into a single DOM operation.
   */
  private flushRemovedElements(): void {
    if (this.elementsToRemove.length > 0) {
      // Batch remove all elements
      for (const element of this.elementsToRemove) {
        element.remove();
      }
      this.elementsToRemove = [];
    }
  }
  
  /**
   * Updates sprite frame for an NPC element.
   * 
   * @param element - NPC DOM element
   * @param animType - Animation type
   * @param frame - Frame index
   */
  private updateSpriteFrame(element: NpcDomElement, animType: 'idle' | 'walking' | 'running', frame: number): void {
    const animation = this.animations[animType];
    if (!animation) return;
    
    // Calculate horizontal position percentage
    const x = frame * (100 / (animation.frames - 1));
    const pos = `${x}% 0%`;
    
    element.spriteSlice.style.backgroundPosition = pos;
  }
  
  /**
   * Updates sprite image for an NPC element.
   * 
   * @param element - NPC DOM element
   * @param animType - Animation type
   */
  private updateSpriteImage(element: NpcDomElement, animType: 'idle' | 'walking' | 'running'): void {
    const spriteImage = this.spriteImages[animType];
    if (spriteImage && this.spritesLoaded[animType]) {
      const animation = this.animations[animType];
      element.spriteSlice.style.backgroundImage = `url(${animation.url})`;
      // Set background size for sprite sheet: frames * 100% width, 100% height
      // This ensures each frame takes 1/frames of the width
      element.spriteSlice.style.backgroundSize = `${animation.frames * 100}% 100%`;
    }
  }
  
  /**
   * Updatable implementation – called each frame by GameLoop.
   * 
   * Advances sprite animation frames using an accumulator pattern.
   * Also manages DOM element lifecycle (create/remove) and viewport culling.
   * Batches DOM operations for better performance.
   * 
   * @param deltaMs - Time elapsed since last update (milliseconds)
   */
  public update(deltaMs: number): void {
    // Update viewport bounds if not cached (shouldn't happen, but safety check)
    if (!this.cachedBounds) {
      this.updateViewportBounds();
    }
    
    // Query ECS for current NPCs
    const ents = this.query(world);
    const existingEids = new Set(ents);
    
    // Remove DOM elements for NPCs that no longer exist (queued for batch removal)
    for (const eid of this.npcElements.keys()) {
      if (!existingEids.has(eid)) {
        this.removeNpcElement(eid);
      }
    }
    
    // Create DOM elements for new NPCs (only if visible)
    // Elements are added to DocumentFragment for batch insertion
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      const lng = Position.x[eid];
      const lat = Position.y[eid];
      
      // CULL: Check if NPC is visible before creating DOM element
      const isVisible = this.cachedBounds ? 
        isEntityVisible(lng, lat, this.cachedBounds, this.cachedPaddingDegrees) : true;
      
      if (!this.npcElements.has(eid)) {
        if (isVisible) {
          // Only create DOM element if visible (added to fragment for batch insertion)
          this.npcElements.set(eid, this.createNpcElement(eid));
        }
        // Skip animation updates for off-screen NPCs (no DOM element yet)
        continue;
      }
      
      // Update visibility of existing DOM elements
      const element = this.npcElements.get(eid);
      if (element) {
        if (isVisible) {
          // Show element if it was hidden
          if (element.container.style.display === 'none') {
            element.container.style.display = '';
          }
        } else {
          // Hide element if off-screen (but keep DOM element for reuse)
          element.container.style.display = 'none';
          // Skip animation updates for hidden NPCs
          continue;
        }
      }
    }
    
    // Flush batched DOM operations: insert new elements and remove old ones
    this.flushPendingElements();
    this.flushRemovedElements();
    
    // Update animation frames for visible NPCs only
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      const element = this.npcElements.get(eid);
      
      // Skip if no DOM element (not created because off-screen)
      if (!element) continue;
      
      // Skip if element is hidden (off-screen)
      if (element.container.style.display === 'none') continue;
      
      // Get velocity to determine animation type
      const velocityX = Velocity.x[eid] || 0;
      const velocityY = Velocity.y[eid] || 0;
      const animType = this.determineAnimationType(velocityX, velocityY);
      
      // Get or create animation state for this NPC
      let animState = this.npcAnimationState.get(eid);
      if (!animState) {
        animState = {
          accumulator: 0,
          currentFrame: 0,
          animType: animType
        };
        this.npcAnimationState.set(eid, animState);
      }
      
      // Update animation type if it changed
      if (animState.animType !== animType) {
        animState.animType = animType;
        animState.currentFrame = 0;
        animState.accumulator = 0;
        
        // Update sprite image when animation type changes
        this.updateSpriteImage(element, animType);
      }
      
      // Get base frame rate for this animation type
      const anim = this.animations[animType];
      const baseFrameRate = anim.frameRate;
      
      // Scale frame rate based on NPC speed (faster NPCs animate faster)
      const npcSpeed = this.npcSpeeds.get(eid) || this.baseSpeed;
      const speedRatio = npcSpeed / this.baseSpeed;
      const scaledFrameRate = baseFrameRate * speedRatio;
      const frameDuration = 1000 / scaledFrameRate;
      
      // Accumulate elapsed time
      animState.accumulator += deltaMs;
      
      // Advance frames until caught up (handles frame drops)
      while (animState.accumulator >= frameDuration) {
        animState.currentFrame = (animState.currentFrame + 1) % anim.frames;
        animState.accumulator -= frameDuration;
      }
      
      // Update sprite frame
      this.updateSpriteFrame(element, animType, animState.currentFrame);
    }
  }
  
  /**
   * Renderable implementation – called each frame by GameLoop.
   * 
   * Updates positions, rotations, and sizes for all visible NPC DOM elements.
   * Skips rendering for off-screen entities (culled in update()).
   * Batches classList operations for better performance.
   * 
   * @param alpha - Interpolation factor (currently unused)
   */
  public render(alpha: number): void {
    // Update viewport bounds if not cached (shouldn't happen, but safety check)
    if (!this.cachedBounds) {
      this.updateViewportBounds();
    }
    
    // Get current zoom for size calculation
    const zoom = this.map.getZoom();
    const spriteSize = calculateSpriteSize(this.npcBaseSize, zoom);
    
    // Query ECS world directly for NPC positions
    const ents = this.query(world);
    
    // Batch classList operations: collect elements that need class changes
    const elementsToSelect: HTMLElement[] = [];
    const elementsToDeselect: HTMLElement[] = [];
    
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      const element = this.npcElements.get(eid);
      
      // Skip if element not created yet (off-screen NPC)
      if (!element) continue;
      
      // Skip if element is hidden (off-screen NPC)
      if (element.container.style.display === 'none') continue;
      
      const lng = Position.x[eid];
      const lat = Position.y[eid];
      
      // CULL: Double-check visibility (in case bounds changed since update())
      // This is a safety check - main culling happens in update()
      if (this.cachedBounds && !isEntityVisible(lng, lat, this.cachedBounds, this.cachedPaddingDegrees)) {
        element.container.style.display = 'none';
        continue;
      }
      
      // Get velocity to determine animation type
      const velocityX = Velocity.x[eid] || 0;
      const velocityY = Velocity.y[eid] || 0;
      const animType = this.determineAnimationType(velocityX, velocityY);
      
      // Skip rendering if sprite not loaded
      if (!this.spritesLoaded[animType]) continue;
      
      // Use stored rotation from ECS (consistent with other paths)
      const rotationDeg = Rotation.angle[eid] || 0;
      const rotation = calculateRotationFromStored(rotationDeg, this.cameraBearing);
      
      // Project lat/lng to screen coordinates
      const p = this.map.project({ lng, lat });
      
      // Update sprite size
      element.container.style.width = `${spriteSize}px`;
      element.container.style.height = `${spriteSize}px`;
      
      // Calculate rotation in degrees for CSS
      const rotationDegrees = (rotation * 180) / Math.PI;
      
      // Calculate pitch scale for 3D effect (like PlayerDomView)
      const pitchRad = (this.cameraPitch * Math.PI) / 180;
      const scaleY = Math.cos(pitchRad);
      
      // Apply CSS transform: center, position, rotate, and scale
      // Use translate3d for GPU acceleration
      element.container.style.transform = `translate(-50%,-50%)translate3d(${p.x}px,${p.y}px,0)rotateX(${this.cameraPitch}deg)rotateZ(${rotationDegrees}deg)scaleY(${scaleY})`;
      
      // Queue classList operations for batching
      if (this.selectedNpcEid === eid) {
        elementsToSelect.push(element.container);
      } else {
        elementsToDeselect.push(element.container);
      }
      
      // Ensure sprite image is set (handles initial load and animation changes)
      const animState = this.npcAnimationState.get(eid);
      if (animState && this.spritesLoaded[animState.animType]) {
        this.updateSpriteImage(element, animState.animType);
      }
    }
    
    // Batch classList operations: apply all selections and deselections
    // This reduces DOM reflows compared to individual classList operations
    for (const element of elementsToSelect) {
      element.classList.add('npc-selected');
    }
    for (const element of elementsToDeselect) {
      element.classList.remove('npc-selected');
    }
  }
  
  /**
   * Update NPC speed for animation scaling
   * Called by NetworkStateManager when NPC data is received
   */
  public updateNpcSpeed(clientEid: number, speed: number): void {
    this.npcSpeeds.set(clientEid, speed);
  }
  
  /**
   * Remove NPC speed when NPC is removed
   */
  public removeNpcSpeed(clientEid: number): void {
    this.npcSpeeds.delete(clientEid);
  }
  
  /**
   * Set the selected NPC entity ID (for red outline)
   * Batches classList operations for better performance.
   */
  public setSelectedNpc(eid: number | null): void {
    const changed = this.selectedNpcEid !== eid;
    this.selectedNpcEid = eid;
    
    if (changed) {
      console.log('[NpcDomLayer] Selection changed:', eid);
      // Batch classList operations: collect elements first, then update
      const elementsToSelect: HTMLElement[] = [];
      const elementsToDeselect: HTMLElement[] = [];
      
      for (const [npcEid, element] of this.npcElements.entries()) {
        if (npcEid === eid) {
          elementsToSelect.push(element.container);
        } else {
          elementsToDeselect.push(element.container);
        }
      }
      
      // Apply all class changes in batch
      for (const element of elementsToSelect) {
        element.classList.add('npc-selected');
      }
      for (const element of elementsToDeselect) {
        element.classList.remove('npc-selected');
      }
    }
  }
}


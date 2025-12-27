/**
 * NpcInstancedLayer - High-Performance WebGL-Based NPC Rendering Layer
 * 
 * This class implements a custom MapLibre GL layer that renders NPCs using WebGL point sprites
 * for optimal performance. It's designed to handle hundreds or thousands of NPCs efficiently
 * by leveraging GPU instancing through WebGL's POINTS primitive.
 * 
 * **Key Features:**
 * - **WebGL Point Sprites**: Uses `gl.POINTS` to render multiple NPCs in a single draw call
 * - **Pre-calculated Positions**: Receives screen-space positions from `NpcController`, avoiding
 *   per-frame coordinate projection overhead
 * - **Sprite Sheet Animation**: Supports animated sprites (idle/walking/running) with per-NPC frame selection
 * - **Zoom-Based Scaling**: Dynamically adjusts sprite size based on map zoom level
 * - **Mercator-Recommended**: Optimized for Mercator projection, works with other projections
 * 
 * **Architecture:**
 * - Implements MapLibre's `CustomLayerInterface` to integrate with the map rendering pipeline
 * - Uses custom vertex and fragment shaders to render sprites as textured points
 * - Receives position data via `setPositionsToRender()` from `NpcController` each frame
 * - Renders all NPCs in a single `drawArrays()` call for maximum efficiency
 * 
 * **Comparison with NpcLayer:**
 * - `NpcLayer`: Canvas-based fallback for globe projection, slower but more flexible
 * - `NpcInstancedLayer`: WebGL-based, much faster, but requires Mercator projection
 * 
 * **Performance:**
 * - Can render 1000+ NPCs at 60fps on modern hardware
 * - Single draw call regardless of NPC count (GPU instancing)
 * - Minimal CPU overhead (positions pre-calculated by controller)
 * 
 * **Usage:**
 * This layer is automatically used when `NPC_RENDER_PATH = 'webgl'` in config.ts.
 * The `NpcController` handles coordinate projection and calls `setPositionsToRender()` each frame.
 * Works best with Mercator projection, but can be used with other projections.
 */

import maplibregl from 'maplibre-gl';

/**
 * Helper function to compile a WebGL shader from source code.
 * Throws an error if compilation fails, making debugging easier.
 * 
 * @param gl - WebGL rendering context
 * @param type - Shader type (VERTEX_SHADER or FRAGMENT_SHADER)
 * @param source - GLSL shader source code as a string
 * @returns Compiled WebGL shader object
 */
function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

/**
 * Custom MapLibre layer for rendering NPCs using WebGL point sprites.
 * This is the high-performance rendering path used in Mercator projection mode.
 */
export default class NpcInstancedLayer implements maplibregl.CustomLayerInterface {
  // MapLibre layer interface properties
  id = 'npc-instanced-layer';
  type: 'custom' = 'custom';
  renderingMode: '2d' | '3d' = '3d'; // '3d' allows proper depth testing and integration with map

  // MapLibre and WebGL context references (set in onAdd)
  private map!: maplibregl.Map;
  private gl!: WebGLRenderingContext;

  // WebGL shader program and buffer resources
  private program!: WebGLProgram; // Compiled vertex + fragment shader program
  private vertexBuffer!: WebGLBuffer; // GPU buffer storing vertex data (x, y, frame, animType per NPC)
  
  // Shader attribute/uniform locations (cached for performance)
  private aPosLocation = 0; // Attribute location for position data (vec2)
  private aFrameLocation!: number; // Attribute location for frame index (float)
  private aAnimTypeLocation!: number; // Attribute location for animation type (float)
  private aRotationLocation!: number; // Attribute location for rotation angle (float, radians)
  private uTexIdleLocation!: WebGLUniformLocation; // Uniform for idle sprite sheet sampler
  private uTexWalkingLocation!: WebGLUniformLocation; // Uniform for walking sprite sheet sampler
  private uTexRunningLocation!: WebGLUniformLocation; // Uniform for running sprite sheet sampler
  private uFrameCountIdleLocation!: WebGLUniformLocation; // Uniform for idle frame count
  private uFrameCountWalkingLocation!: WebGLUniformLocation; // Uniform for walking frame count
  private uFrameCountRunningLocation!: WebGLUniformLocation; // Uniform for running frame count
  private uPointSizeLocation!: WebGLUniformLocation; // Uniform for point sprite size in pixels
  private uViewportSizeLocation!: WebGLUniformLocation; // Uniform for viewport dimensions (width, height)

  // Sprite texture management - sprite sheets for animation
  private textures: {
    idle: WebGLTexture | null;
    walking: WebGLTexture | null;
    running: WebGLTexture | null;
  } = {
    idle: null,
    walking: null,
    running: null
  };

  private texturesLoaded = {
    idle: false,
    walking: false,
    running: false
  };

  // Sprite sheet paths
  private static readonly SPRITE_SHEETS = {
    idle: 'sprites/brian/brian_idling_31x1.png',
    walking: 'sprites/brian/brian_walking_forward_31x1.png',
    running: 'sprites/brian/brian_running_forward_23x1.png'
  };

  // Animation metadata (frame counts for each sprite sheet)
  private static readonly ANIMATION_FRAMES = {
    idle: 31,
    walking: 31,
    running: 23
  };

  // Vertex data received from NpcController (updated each frame)
  // Format: Float32Array with [x0, y0, frame0, animType0, x1, y1, frame1, animType1, ...]
  // 4 floats per NPC: x, y, frameIndex, animType
  private vertexData: Float32Array | null = null;
  private npcCount = 0; // Number of NPCs to render (vertexData.length / 4)
  
  // Legacy position data (for backward compatibility during transition)
  private positionsToRender: Float32Array | null = null;
  
  /** Currently selected NPC entity ID (for red outline) */
  private selectedNpcEid: number | null = null;
  
  /** Map from entity ID to index in positionsToRender array */
  private entityIdToIndex: Map<number, number> = new Map();

  // Size multiplier (can be set via config, same as Canvas path)
  private readonly sizeMultiplier: number;
  
  // Reference zoom level and scale factor (same as Canvas path for consistency)
  private static readonly REFERENCE_ZOOM = 10;
  private static readonly SCALE_FACTOR = 1.2;
  private static readonly MIN_SIZE = 1;
  private static readonly MAX_SIZE = 200;

  /**
   * Constructor - initializes the layer with a size multiplier.
   * 
   * @param sizeMultiplier - Multiplier for sprite size (default: 1.0)
   */
  constructor(sizeMultiplier: number = 1.0) {
    this.sizeMultiplier = sizeMultiplier;
  }

  /**
   * Called by NpcController each frame to provide updated screen-space positions for NPCs.
   * The positions are pre-calculated by projecting lat/lng coordinates to screen space,
   * avoiding per-frame projection overhead in the render loop.
   * 
   * @param positions - Float32Array with [x0, y0, x1, y1, ...] screen coordinates
   * @param count - Number of NPCs (positions.length / 2)
   * @deprecated Use setVertexData() instead (includes animation data)
   */
  public setPositionsToRender(positions: Float32Array, count: number) {
    this.positionsToRender = positions;
    this.npcCount = count;
    // Convert to vertex data format for compatibility (no animation data, no rotation)
    // This is a fallback for code that hasn't been updated yet
    const vertexData = new Float32Array(count * 5);
    for (let i = 0; i < count; i++) {
      vertexData[i * 5] = positions[i * 2];     // x
      vertexData[i * 5 + 1] = positions[i * 2 + 1]; // y
      vertexData[i * 5 + 2] = 0; // frame = 0 (first frame)
      vertexData[i * 5 + 3] = 0; // animType = 0 (idle)
      vertexData[i * 5 + 4] = 0; // rotation = 0 (no rotation)
    }
    this.vertexData = vertexData;
  }

  /**
   * Called by NpcController each frame to provide vertex data with animation information.
   * The vertex data includes positions, animation state, and rotation for sprite sheet rendering.
   * 
   * @param data - Float32Array with [x0, y0, frame0, animType0, rotation0, x1, y1, frame1, animType1, rotation1, ...]
   *               Format: 5 floats per NPC (x, y, frameIndex, animType, rotation)
   * @param count - Number of NPCs (data.length / 5)
   */
  public setVertexData(data: Float32Array, count: number): void {
    this.vertexData = data;
    this.npcCount = count;
  }

  /**
   * Calculates the point sprite size in pixels based on the current map zoom level.
   * Uses the same formula as Canvas path for consistency (via shared utility function).
   * 
   * Formula: size = baseSize * 2^((zoom - 10) / 1.2)
   * - At zoom 10: size = baseSize * multiplier
   * - Zooming in: size increases exponentially
   * - Zooming out: size decreases exponentially
   * - Clamped between 1px (min) and 200px (max) to prevent extreme sizes
   * 
   * Uses same reference zoom (10), scale factor (1.2), and min/max (1/200) as Canvas path.
   * The base size is calculated to match Canvas path visual size when using the same multiplier.
   * 
   * @param zoom - Current map zoom level (typically 0-22+)
   * @returns Point sprite size in pixels
   */
  private calculatePointSizePx(zoom: number): number {
    // Use exact same formula as Canvas path: referenceZoom=10, scaleFactor=1.2, min=1, max=200
    // Canvas uses: size = npcBaseSize * scale where npcBaseSize = NPC_SPRITE_SIZE_MULTIPLIER (0.06)
    // At zoom 10: size = 0.06 * 1 = 0.06, clamped to 1px (CSS pixels)
    // 
    // For WebGL to match Canvas visual size, we use the same base multiplier (0.06)
    // Since we're not multiplying by devicePixelRatio (Canvas handles it via transform),
    // we can use the multiplier directly
    const scale = Math.pow(2, (zoom - NpcInstancedLayer.REFERENCE_ZOOM) / NpcInstancedLayer.SCALE_FACTOR);
    const size = this.sizeMultiplier * scale;
    
    // Clamp to same range as Canvas path
    return Math.max(NpcInstancedLayer.MIN_SIZE, Math.min(NpcInstancedLayer.MAX_SIZE, size));
  }

  /**
   * Called by MapLibre when this layer is added to the map.
   * Initializes all WebGL resources: textures, shaders, buffers, and uniforms.
   * 
   * Setup process:
   * 1. Store map and WebGL context references
   * 2. Load sprite sheet textures asynchronously (triggers repaint when ready)
   * 3. Compile vertex and fragment shaders
   * 4. Link shader program
   * 5. Cache attribute/uniform locations for performance
   * 6. Create GPU buffer for vertex data
   */
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    this.map = map;
    this.gl = gl;

    // Load all sprite sheet textures asynchronously
    this.loadSpriteSheets();

    // Vertex shader: Converts screen-space coordinates to clip space
    // Uses screen coordinates (pre-calculated by NpcController) for simplicity
    // Also passes animation data to fragment shader
    const vertSrc = `
    precision highp float;
    uniform float u_pointSize;      // Size of point sprite in pixels
    uniform vec2 u_viewportSize;    // Canvas width and height
    attribute vec2 a_pos;           // Screen coordinates (x, y) for this NPC
    attribute float a_frame;       // Frame index (0-30 for idle/walking, 0-22 for running)
    attribute float a_animType;    // Animation type (0=idle, 1=walking, 2=running)
    attribute float a_rotation;    // Rotation angle in radians
    
    // Pass animation data and rotation to fragment shader
    varying float v_frame;
    varying float v_animType;
    varying float v_rotation;
    
    void main() {
      // Convert screen coordinates [0, viewportSize] to clip space [-1, 1]
      vec2 clip_space = (a_pos / u_viewportSize) * 2.0 - 1.0;
      clip_space.y *= -1.0; // Flip Y axis (screen Y increases downward, OpenGL Y increases upward)
      gl_Position = vec4(clip_space, 0.0, 1.0); // Z=0 (on screen plane), W=1 (no perspective)
      gl_PointSize = u_pointSize; // Set size for point sprite rendering
      
      // Pass animation data and rotation to fragment shader
      v_frame = a_frame;
      v_animType = a_animType;
      v_rotation = a_rotation;
    }`;

    // Fragment shader: Samples sprite sheet texture based on animation type and frame
    // Uses gl_PointCoord (built-in) which provides UV coordinates for the point sprite
    const fragSrc = `
    precision highp float;
    uniform sampler2D u_texIdle;      // Idle sprite sheet
    uniform sampler2D u_texWalking;    // Walking sprite sheet
    uniform sampler2D u_texRunning;    // Running sprite sheet
    uniform float u_frameCountIdle;   // Number of frames in idle sheet (31)
    uniform float u_frameCountWalking; // Number of frames in walking sheet (31)
    uniform float u_frameCountRunning; // Number of frames in running sheet (23)
    
    varying float v_frame;      // Frame index from vertex shader
    varying float v_animType;   // Animation type from vertex shader
    varying float v_rotation;   // Rotation angle from vertex shader (radians)
    
    void main() {
      vec2 uv = gl_PointCoord.xy; // Base UV coordinates (0-1 range)
      
      // Rotate UV coordinates around center (0.5, 0.5) to rotate the sprite
      // This simulates sprite rotation for WebGL point sprites
      // Canvas rotate() rotates clockwise, but standard rotation matrix rotates counter-clockwise
      // So we negate the rotation to match Canvas behavior
      vec2 center = vec2(0.5, 0.5);
      uv -= center; // Translate to origin
      float cosR = cos(-v_rotation); // Negate rotation to match Canvas clockwise rotation
      float sinR = sin(-v_rotation);
      // Rotate: [cos -sin] [x]   = [x*cos - y*sin]
      //         [sin  cos] [y]     [x*sin + y*cos]
      uv = vec2(uv.x * cosR - uv.y * sinR, uv.x * sinR + uv.y * cosR);
      uv += center; // Translate back
      
      // Select texture and frame count based on animation type
      vec4 color;
      float frameCount;
      
      if (v_animType < 0.5) {
        // Idle (0.0)
        frameCount = u_frameCountIdle;
        float frameWidth = 1.0 / frameCount;
        // Calculate UV offset for this frame: frame 0 starts at 0%, frame N-1 ends at 100%
        vec2 frameUV = vec2(
          (v_frame * frameWidth) + (uv.x * frameWidth),
          uv.y
        );
        color = texture2D(u_texIdle, frameUV);
      } else if (v_animType < 1.5) {
        // Walking (1.0)
        frameCount = u_frameCountWalking;
        float frameWidth = 1.0 / frameCount;
        vec2 frameUV = vec2(
          (v_frame * frameWidth) + (uv.x * frameWidth),
          uv.y
        );
        color = texture2D(u_texWalking, frameUV);
      } else {
        // Running (2.0)
        frameCount = u_frameCountRunning;
        float frameWidth = 1.0 / frameCount;
        vec2 frameUV = vec2(
          (v_frame * frameWidth) + (uv.x * frameWidth),
          uv.y
        );
        color = texture2D(u_texRunning, frameUV);
      }
      
      if (color.a < 0.1) discard; // Discard transparent pixels (optimization)
      gl_FragColor = color; // Output final color
    }`;

    // Compile and link shader program
    const vert = compileShader(this.gl, this.gl.VERTEX_SHADER, vertSrc);
    const frag = compileShader(this.gl, this.gl.FRAGMENT_SHADER, fragSrc);
    this.program = this.gl.createProgram()!;
    this.gl.attachShader(this.program, vert);
    this.gl.attachShader(this.program, frag);
    this.gl.linkProgram(this.program);
    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + this.gl.getProgramInfoLog(this.program));
    }

    // Cache attribute/uniform locations (avoids string lookups each frame)
    this.aPosLocation = this.gl.getAttribLocation(this.program, 'a_pos');
    this.aFrameLocation = this.gl.getAttribLocation(this.program, 'a_frame');
    this.aAnimTypeLocation = this.gl.getAttribLocation(this.program, 'a_animType');
    this.aRotationLocation = this.gl.getAttribLocation(this.program, 'a_rotation');
    this.uTexIdleLocation = this.gl.getUniformLocation(this.program, 'u_texIdle')!;
    this.uTexWalkingLocation = this.gl.getUniformLocation(this.program, 'u_texWalking')!;
    this.uTexRunningLocation = this.gl.getUniformLocation(this.program, 'u_texRunning')!;
    this.uFrameCountIdleLocation = this.gl.getUniformLocation(this.program, 'u_frameCountIdle')!;
    this.uFrameCountWalkingLocation = this.gl.getUniformLocation(this.program, 'u_frameCountWalking')!;
    this.uFrameCountRunningLocation = this.gl.getUniformLocation(this.program, 'u_frameCountRunning')!;
    this.uPointSizeLocation = this.gl.getUniformLocation(this.program, 'u_pointSize')!;
    this.uViewportSizeLocation = this.gl.getUniformLocation(this.program, 'u_viewportSize')!;

    // Create GPU buffer for vertex data (will be updated each frame)
    this.vertexBuffer = this.gl.createBuffer()!;
  }

  /**
   * Loads all sprite sheet textures asynchronously.
   * Sets texturesLoaded flags when ready and triggers repaint when all are loaded.
   */
  private loadSpriteSheets(): void {
    const loadTexture = (url: string, type: 'idle' | 'walking' | 'running') => {
      const img = new Image();
      img.src = url.startsWith('/') ? url : '/' + url;
      img.onload = () => {
        // Create WebGL texture from loaded image
        const texture = this.gl.createTexture()!;
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
        
        // Use NEAREST filtering to preserve pixel art style (no blurring)
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        
        // Prevent texture wrapping (clamp to edge)
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        
        this.textures[type] = texture;
        this.texturesLoaded[type] = true;
        
        // Trigger repaint when all textures are loaded
        if (this.texturesLoaded.idle && this.texturesLoaded.walking && this.texturesLoaded.running) {
          this.map.triggerRepaint();
        }
      };
      img.onerror = () => {
        console.error(`[NpcInstancedLayer] Failed to load sprite sheet: ${url}`);
      };
    };
    
    // Load all three sprite sheets
    loadTexture(NpcInstancedLayer.SPRITE_SHEETS.idle, 'idle');
    loadTexture(NpcInstancedLayer.SPRITE_SHEETS.walking, 'walking');
    loadTexture(NpcInstancedLayer.SPRITE_SHEETS.running, 'running');
  }

  /**
   * Called by MapLibre each frame to render NPCs.
   * This is where the actual WebGL drawing happens - all NPCs are rendered in a single draw call.
   * 
   * Rendering process:
   * 1. Early exit if texture not loaded or no NPCs to render
   * 2. Update GPU buffer with latest screen positions (from NpcController)
   * 3. Set up shader uniforms (viewport size, point size, texture)
   * 4. Enable blending for transparency
   * 5. Draw all NPCs as point sprites in one drawArrays() call
   * 
   * Performance: This method is optimized for speed - all NPCs share the same texture
   * and are rendered in a single GPU draw call (instanced rendering via POINTS primitive).
   * 
   * @param gl - WebGL context (provided by MapLibre, but we use our cached reference)
   * @param matrix - Transformation matrix (unused - we use pre-calculated screen coords)
   */
  render(gl: WebGLRenderingContext, matrix: any): void {
    // Early exit if not ready to render
    if (!this.texturesLoaded.idle || !this.texturesLoaded.walking || !this.texturesLoaded.running || 
        !this.vertexData || this.npcCount === 0) {
      return;
    }
    const g = this.gl;

    // Activate our shader program
    g.useProgram(this.program);

    // Update GPU buffer with latest vertex data
    // Uses dynamic buffer allocation: only reallocates if buffer is too small
    g.bindBuffer(g.ARRAY_BUFFER, this.vertexBuffer);
    const neededBytes = this.vertexData.byteLength;
    const currentSize = g.getBufferParameter(g.ARRAY_BUFFER, g.BUFFER_SIZE) ?? 0;
    if (neededBytes > currentSize) {
      // Buffer too small - reallocate with new size
      g.bufferData(g.ARRAY_BUFFER, neededBytes, g.DYNAMIC_DRAW);
    }
    // Upload vertex data to GPU (only updates, doesn't reallocate if size is same)
    g.bufferSubData(g.ARRAY_BUFFER, 0, this.vertexData);
    
    // Configure vertex attributes: 5 floats per NPC (x, y, frame, animType, rotation)
    // Stride = 20 bytes (5 floats * 4 bytes each)
    const stride = 20; // bytes
    g.vertexAttribPointer(this.aPosLocation, 2, g.FLOAT, false, stride, 0); // Position: offset 0
    g.vertexAttribPointer(this.aFrameLocation, 1, g.FLOAT, false, stride, 8); // Frame: offset 8 bytes (after x, y)
    g.vertexAttribPointer(this.aAnimTypeLocation, 1, g.FLOAT, false, stride, 12); // AnimType: offset 12 bytes
    g.vertexAttribPointer(this.aRotationLocation, 1, g.FLOAT, false, stride, 16); // Rotation: offset 16 bytes
    
    // Set viewport size uniform (needed for screen-to-clip-space conversion)
    // IMPORTANT: map.project() returns CSS pixels, so we must use CSS pixel dimensions
    // g.canvas.width/height are physical pixels (scaled by devicePixelRatio), which would cause incorrect positioning
    const container = this.map.getContainer();
    const cssWidth = container.clientWidth;
    const cssHeight = container.clientHeight;
    g.uniform2f(this.uViewportSizeLocation, cssWidth, cssHeight);

    // Set frame count uniforms
    g.uniform1f(this.uFrameCountIdleLocation, NpcInstancedLayer.ANIMATION_FRAMES.idle);
    g.uniform1f(this.uFrameCountWalkingLocation, NpcInstancedLayer.ANIMATION_FRAMES.walking);
    g.uniform1f(this.uFrameCountRunningLocation, NpcInstancedLayer.ANIMATION_FRAMES.running);

    // Bind sprite sheet textures to texture units
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.textures.idle!);
    g.uniform1i(this.uTexIdleLocation, 0);
    
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, this.textures.walking!);
    g.uniform1i(this.uTexWalkingLocation, 1);
    
    g.activeTexture(g.TEXTURE2);
    g.bindTexture(g.TEXTURE_2D, this.textures.running!);
    g.uniform1i(this.uTexRunningLocation, 2);

    // Calculate point size based on zoom level
    // Use same calculation as Canvas path, then multiply by devicePixelRatio for WebGL physical pixels
    // Canvas uses CSS pixels and handles dpr via transform, WebGL uses physical pixels directly
    const zoom = this.map.getZoom();
    const sizeCssPx = this.calculatePointSizePx(zoom); // Size in CSS pixels (matches Canvas)
    const sizePx = sizeCssPx * (window.devicePixelRatio || 1); // Convert to physical pixels for WebGL
    g.uniform1f(this.uPointSizeLocation, sizePx);

    // Enable alpha blending for transparent sprites
    g.enable(g.BLEND);
    g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA); // Standard alpha blending
    
    // Enable vertex attributes and draw all NPCs as point sprites
    // This single draw call renders ALL NPCs (GPU instancing via POINTS primitive)
    g.enableVertexAttribArray(this.aPosLocation);
    g.enableVertexAttribArray(this.aFrameLocation);
    g.enableVertexAttribArray(this.aAnimTypeLocation);
    g.enableVertexAttribArray(this.aRotationLocation);
    g.drawArrays(g.POINTS, 0, this.npcCount); // Draw npcCount points in one call
    g.disableVertexAttribArray(this.aPosLocation);
    g.disableVertexAttribArray(this.aFrameLocation);
    g.disableVertexAttribArray(this.aAnimTypeLocation);
    g.disableVertexAttribArray(this.aRotationLocation);
    g.disable(g.BLEND);
  }

  /**
   * Called by MapLibre when this layer is removed from the map.
   * Cleans up all WebGL resources to prevent memory leaks.
   * 
   * Note: MapLibre may call this when switching projections or removing the layer.
   * All GPU resources (buffers, textures, shaders) must be explicitly deleted.
   * 
   * @param map - MapLibre map instance (unused)
   * @param gl - WebGL context (unused, we use cached reference)
   */
  onRemove(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    const g = this.gl;
    // Clean up GPU resources (prevents memory leaks)
    if (this.vertexBuffer) g.deleteBuffer(this.vertexBuffer);
    if (this.program) g.deleteProgram(this.program);
    if (this.textures.idle) g.deleteTexture(this.textures.idle);
    if (this.textures.walking) g.deleteTexture(this.textures.walking);
    if (this.textures.running) g.deleteTexture(this.textures.running);
  }
}
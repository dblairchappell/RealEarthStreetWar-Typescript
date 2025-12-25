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
 * - **Single Texture**: Loads one sprite image and reuses it for all NPCs (instanced rendering)
 * - **Zoom-Based Scaling**: Dynamically adjusts sprite size based on map zoom level
 * - **Mercator-Only**: Optimized for Mercator projection (not compatible with globe projection)
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
 * This layer is automatically used by `MapView` when `ENABLE_GLOBE = false` (Mercator projection).
 * The `NpcController` handles coordinate projection and calls `setPositionsToRender()` each frame.
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
  private posBuffer!: WebGLBuffer; // GPU buffer storing NPC screen positions (x, y pairs)
  
  // Shader attribute/uniform locations (cached for performance)
  private aPosLocation = 0; // Attribute location for position data (vec2)
  private uTexLocation!: WebGLUniformLocation; // Uniform for sprite texture sampler
  private uPointSizeLocation!: WebGLUniformLocation; // Uniform for point sprite size in pixels
  private uViewportSizeLocation!: WebGLUniformLocation; // Uniform for viewport dimensions (width, height)

  // Sprite texture management
  private texture!: WebGLTexture; // WebGL texture object containing the sprite image
  private textureLoaded = false; // Flag to prevent rendering before texture is ready
  private static readonly SPRITE_SRC = 'sprites/brian/brian_idling/0000.png'; // Path to sprite image

  // Position data received from NpcController (updated each frame)
  // Format: Float32Array with [x0, y0, x1, y1, ...] screen coordinates
  private positionsToRender: Float32Array | null = null;
  private npcCount = 0; // Number of NPCs to render (positionsToRender.length / 2)
  
  /** Currently selected NPC entity ID (for red outline) */
  private selectedNpcEid: number | null = null;
  
  /** Map from entity ID to index in positionsToRender array */
  private entityIdToIndex: Map<number, number> = new Map();

  // Base sprite size at reference zoom level (used for zoom-based scaling)
  private static readonly BASE_SIZE_PX = 72;

  /**
   * Called by NpcController each frame to provide updated screen-space positions for NPCs.
   * The positions are pre-calculated by projecting lat/lng coordinates to screen space,
   * avoiding per-frame projection overhead in the render loop.
   * 
   * @param positions - Float32Array with [x0, y0, x1, y1, ...] screen coordinates
   * @param count - Number of NPCs (positions.length / 2)
   */
  public setPositionsToRender(positions: Float32Array, count: number) {
    this.positionsToRender = positions;
    this.npcCount = count;
  }

  /**
   * Calculates the point sprite size in pixels based on the current map zoom level.
   * Uses exponential scaling to maintain consistent visual size as the user zooms.
   * 
   * The formula: size = BASE_SIZE * 2^((zoom - referenceZoom) / 1.4)
   * - At zoom 22: size = BASE_SIZE (72px)
   * - Zooming in: size increases exponentially
   * - Zooming out: size decreases exponentially
   * - Clamped between 4px (min) and 72px (max) to prevent extreme sizes
   * 
   * @param zoom - Current map zoom level (typically 0-22+)
   * @returns Point sprite size in pixels
   */
  private calculatePointSizePx(zoom: number): number {
    const referenceZoom   = 22; // Zoom level where sprite is at BASE_SIZE_PX
    const scale  = Math.pow(2, (zoom - referenceZoom) / 1.4); // Exponential scale factor
    const size   = Math.max(4, Math.min(72, NpcInstancedLayer.BASE_SIZE_PX * scale)); // Clamp to reasonable range
    return size;
  }

  /**
   * Called by MapLibre when this layer is added to the map.
   * Initializes all WebGL resources: texture, shaders, buffers, and uniforms.
   * 
   * Setup process:
   * 1. Store map and WebGL context references
   * 2. Load sprite texture asynchronously (triggers repaint when ready)
   * 3. Compile vertex and fragment shaders
   * 4. Link shader program
   * 5. Cache attribute/uniform locations for performance
   * 6. Create GPU buffer for position data
   */
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    this.map = map;
    this.gl = gl;

    // Load sprite texture asynchronously
    // The texture will be used for all NPCs (instanced rendering)
    const img = new Image();
    img.src = NpcInstancedLayer.SPRITE_SRC.startsWith('/') ? NpcInstancedLayer.SPRITE_SRC : '/' + NpcInstancedLayer.SPRITE_SRC;
    img.onload = () => {
      // Create WebGL texture from loaded image
      this.texture = this.gl.createTexture()!;
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
      
      // Use NEAREST filtering to preserve pixel art style (no blurring)
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      
      // Prevent texture wrapping (clamp to edge)
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      
      this.textureLoaded = true;
      this.map.triggerRepaint(); // Redraw map now that texture is ready
    };

    // Vertex shader: Converts screen-space coordinates to clip space
    // Uses screen coordinates (pre-calculated by NpcController) for simplicity
    // This avoids complex matrix math in the shader
    const vertSrc = `
    precision highp float;
    uniform float u_pointSize;      // Size of point sprite in pixels
    uniform vec2 u_viewportSize;    // Canvas width and height
    attribute vec2 a_pos;           // Screen coordinates (x, y) for this NPC
    void main() {
      // Convert screen coordinates [0, viewportSize] to clip space [-1, 1]
      vec2 clip_space = (a_pos / u_viewportSize) * 2.0 - 1.0;
      clip_space.y *= -1.0; // Flip Y axis (screen Y increases downward, OpenGL Y increases upward)
      gl_Position = vec4(clip_space, 0.0, 1.0); // Z=0 (on screen plane), W=1 (no perspective)
      gl_PointSize = u_pointSize; // Set size for point sprite rendering
    }`;

    // Fragment shader: Samples texture and applies alpha transparency
    // Uses gl_PointCoord (built-in) which provides UV coordinates for the point sprite
    const fragSrc = `
    precision highp float;
    uniform sampler2D u_tex; // Sprite texture
    void main() {
      vec2 uv = gl_PointCoord.xy; // UV coordinates for this point sprite (0-1 range)
      vec4 color = texture2D(u_tex, uv); // Sample sprite texture
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
    this.uTexLocation = this.gl.getUniformLocation(this.program, 'u_tex')!;
    this.uPointSizeLocation = this.gl.getUniformLocation(this.program, 'u_pointSize')!;
    this.uViewportSizeLocation = this.gl.getUniformLocation(this.program, 'u_viewportSize')!;

    // Create GPU buffer for position data (will be updated each frame)
    this.posBuffer = this.gl.createBuffer()!;
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
    if (!this.textureLoaded || !this.positionsToRender || this.npcCount === 0) {
      return;
    }
    const g = this.gl;

    // Activate our shader program
    g.useProgram(this.program);

    // Update GPU buffer with latest position data
    // Uses dynamic buffer allocation: only reallocates if buffer is too small
    g.bindBuffer(g.ARRAY_BUFFER, this.posBuffer);
    const neededBytes = this.positionsToRender.byteLength;
    const currentSize = g.getBufferParameter(g.ARRAY_BUFFER, g.BUFFER_SIZE) ?? 0;
    if (neededBytes > currentSize) {
      // Buffer too small - reallocate with new size
      g.bufferData(g.ARRAY_BUFFER, neededBytes, g.DYNAMIC_DRAW);
    }
    // Upload position data to GPU (only updates, doesn't reallocate if size is same)
    g.bufferSubData(g.ARRAY_BUFFER, 0, this.positionsToRender);
    
    // Configure vertex attribute: positions are vec2 (2 floats per vertex)
    g.vertexAttribPointer(this.aPosLocation, 2, g.FLOAT, false, 0, 0);
    
    // Set viewport size uniform (needed for screen-to-clip-space conversion)
    g.uniform2f(this.uViewportSizeLocation, g.canvas.width, g.canvas.height);

    // Bind sprite texture to texture unit 0
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.texture);
    g.uniform1i(this.uTexLocation, 0); // Tell shader to use texture unit 0

    // Calculate point size based on zoom level and device pixel ratio
    // devicePixelRatio accounts for high-DPI displays (Retina, etc.)
    const zoom = this.map.getZoom();
    const sizePx = this.calculatePointSizePx(zoom) * (window.devicePixelRatio || 1);
    g.uniform1f(this.uPointSizeLocation, sizePx);

    // Enable alpha blending for transparent sprites
    g.enable(g.BLEND);
    g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA); // Standard alpha blending
    
    // Enable position attribute and draw all NPCs as point sprites
    // This single draw call renders ALL NPCs (GPU instancing via POINTS primitive)
    g.enableVertexAttribArray(this.aPosLocation);
    g.drawArrays(g.POINTS, 0, this.npcCount); // Draw npcCount points in one call
    g.disableVertexAttribArray(this.aPosLocation);
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
    if (this.posBuffer) g.deleteBuffer(this.posBuffer);
    if (this.program) g.deleteProgram(this.program);
    if (this.texture) g.deleteTexture(this.texture);
  }
}
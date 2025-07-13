import maplibregl from 'maplibre-gl';
import { bridge } from '../sim/SimulationBridge';
import { defineQuery } from 'bitecs';
import { world, Position } from '../ecs/world';
import { NpcTag } from '../ecs/components/NpcTag';

// Minimal helper for shader compilation
function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

export default class NpcInstancedLayer implements maplibregl.CustomLayerInterface {
  id = 'npc-instanced-layer';
  type: 'custom' = 'custom';
  renderingMode: '2d' | '3d' = '3d';

  // Flag to choose coordinate conversion method
  private static readonly USE_SCREEN_COORDS = false; // Set to false for Mercator approach

  private map!: maplibregl.Map;
  private gl!: WebGLRenderingContext;
  private program!: WebGLProgram;
  private posBuffer!: WebGLBuffer;
  private aPosLocation = 0;
  private uMatrixLocation!: WebGLUniformLocation;
  private uTexLocation!: WebGLUniformLocation;
  private uPointSizeLocation!: WebGLUniformLocation;

  /* ───────── Sprite texture ───────── */
  private texture!: WebGLTexture;
  private textureLoaded = false;
  // Hard-coded path to the first frame of the player idle strip (31×1 atlas).
  private static readonly SPRITE_SRC = 'sprites/brian/brian_idling/0000.png';

  // Debug helper
  private dbgFrame = 0;

  // ECS query for fallback path (no worker)
  private query = defineQuery([NpcTag, Position]);

  // Base marker size in pixels at reference zoom (10) matching CharacterView logic
  private static readonly BASE_SIZE_PX = 72;

  private calculatePointSizePx(zoom: number): number {
    const referenceZoom   = 22;          // looks correct at this zoom
    const scale  = Math.pow(2, (zoom - referenceZoom) / 1.4); //Dividing by 1.4 stretches the curve so the sprite halves every 1.4 zoom levels; it shrinks a little slower
    // const scale  = Math.pow(2, (zoom - referenceZoom));
    const size   = Math.max(4, Math.min(72, NpcInstancedLayer.BASE_SIZE_PX * scale));
    // console.log('size', size);
    return size;
  }

  /* ---------------- MapLibre hooks ---------------- */
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    this.map = map;
    // Ensure we are working with a WebGL2 context – MapLibre creates WebGL1 but we can cast.
    this.gl = gl as WebGLRenderingContext;

    /* -------- Load sprite texture -------- */
    const img = new Image();
    img.src = NpcInstancedLayer.SPRITE_SRC.startsWith('/') ? NpcInstancedLayer.SPRITE_SRC : '/' + NpcInstancedLayer.SPRITE_SRC;
    img.onload = () => {
      this.texture = this.gl.createTexture()!;
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.textureLoaded = true;
    };

    const vertSrc = NpcInstancedLayer.USE_SCREEN_COORDS ? `
    precision highp float;
    uniform float u_pointSize;
    attribute vec2 a_pos;
    void main() {
      gl_Position = vec4(a_pos / vec2(512.0, 512.0) * 2.0 - 1.0, 0.0, 1.0);
      gl_PointSize = u_pointSize;
    }` : `
    precision highp float;
    uniform mat4 u_matrix;
    uniform float u_pointSize;
    attribute vec3 a_pos;   // relative world-pixel offset from centre (centre baked into matrix)
    void main() {
      gl_Position = u_matrix * vec4(a_pos, 1.0);
      gl_PointSize = u_pointSize;
    }`;

    const fragSrc = `
    precision highp float;
    uniform sampler2D u_tex;
    void main() {
      vec2 uv = gl_PointCoord.xy;
      vec4 color = texture2D(u_tex, uv);
      if (color.a < 0.1) discard;
      gl_FragColor = color;
    }`;

    const vert = compileShader(this.gl, this.gl.VERTEX_SHADER, vertSrc);
    const frag = compileShader(this.gl, this.gl.FRAGMENT_SHADER, fragSrc);
    this.program = this.gl.createProgram()!;
    this.gl.attachShader(this.program, vert);
    this.gl.attachShader(this.program, frag);
    this.gl.linkProgram(this.program);
    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + this.gl.getProgramInfoLog(this.program));
    }

    this.aPosLocation = this.gl.getAttribLocation(this.program, 'a_pos');
    this.uMatrixLocation     = this.gl.getUniformLocation(this.program, 'u_matrix')!;
    this.uTexLocation        = this.gl.getUniformLocation(this.program, 'u_tex')!;
    this.uPointSizeLocation  = this.gl.getUniformLocation(this.program, 'u_pointSize')!;

    // Create empty buffer upfront; we re-populate each frame
    this.posBuffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, 4, this.gl.DYNAMIC_DRAW); // placeholder
  }

  // Use `any` for the second param because MapLibre's type definition differs
  // between versions (number[] vs CustomRenderMethodInput). We only need the
  // first 16 values which represent the view-projection matrix.
  render(gl: WebGLRenderingContext, matrix: any): void {
    const g = this.gl; // WebGL2 context

    // Throttle debug output: once a second (~60 frames)
    this.dbgFrame = (this.dbgFrame + 1) % 60;

    // Gather NPC positions (lng, lat)
    let count = 0;
    let lngLatArray: Float32Array;
    if (bridge.isWorkerEnabled()) {
      const snap = bridge.getLatestNpcSnapshot();
      if (!snap) return;
      count = snap.length / 3;
      lngLatArray = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        lngLatArray[i * 2] = snap[i * 3];
        lngLatArray[i * 2 + 1] = snap[i * 3 + 1];
      }
    } else {
      const ents = this.query(world);
      count = ents.length;
      lngLatArray = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const eid = ents[i];
        lngLatArray[i * 2] = Position.x[eid];
        lngLatArray[i * 2 + 1] = Position.y[eid];
      }
    }

    if (count === 0) {
      if (this.dbgFrame === 0) console.debug('NpcInstancedLayer: no NPCs in snapshot');
      return;
    }

    // if (this.dbgFrame === 0) {
    //   console.debug(`NpcInstancedLayer: ${count} NPCs – first at lng=${lngLatArray[0].toFixed(5)}, lat=${lngLatArray[1].toFixed(5)}`);
    // }

    // Convert to mercator world coords expected by MapLibre matrix
    // Variables for centre translation uniform (populated when using Mercator coordinates)
    let centrePxX = 0;
    let centrePxY = 0;

    if (NpcInstancedLayer.USE_SCREEN_COORDS) {
      // Screen coordinate approach - should fix precision issues
      const screenArray = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const lng = lngLatArray[i * 2];
        const lat = lngLatArray[i * 2 + 1];
        const screenPos = this.map.project({ lng, lat });
        screenArray[i * 2] = screenPos.x;
        screenArray[i * 2 + 1] = screenPos.y;
      }
      
      // Upload screen coordinates (2D instead of 3D)
      g.bindBuffer(g.ARRAY_BUFFER, this.posBuffer);
      const neededBytes = screenArray.byteLength;
      const currentSize = g.getBufferParameter(g.ARRAY_BUFFER, g.BUFFER_SIZE);
      if (neededBytes > currentSize) {
        g.bufferData(g.ARRAY_BUFFER, neededBytes, g.DYNAMIC_DRAW);
      }
      g.bufferSubData(g.ARRAY_BUFFER, 0, screenArray);
      
      // Draw with 2D coordinates
      g.vertexAttribPointer(this.aPosLocation, 2, g.FLOAT, false, 0, 0);
      
    } else {
      // Original Mercator coordinate approach
      const mercArray = new Float32Array(count * 3);
      // Calculate map centre in Mercator coordinates to obtain a stable, small-offset origin
      const centreMerc = maplibregl.MercatorCoordinate.fromLngLat(this.map.getCenter());
      const worldSize = (this.map as any).transform?.worldSize || 512;
      const scale = worldSize;
      // Precompute world-pixel centre for shader uniform
      centrePxX = centreMerc.x * scale;
      centrePxY = centreMerc.y * scale;
      for (let i = 0; i < count; i++) {
        const lng = lngLatArray[i * 2];
        const lat = lngLatArray[i * 2 + 1];
        const merc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
        const dx = (merc.x - centreMerc.x) * scale;   //  <-- subtract first, then scale
        const dy = (merc.y - centreMerc.y) * scale;
        mercArray[i * 3] = dx;
        mercArray[i * 3 + 1] = dy;
        mercArray[i * 3 + 2] = 0.0; // altitude 0
      }

      // Upload data to buffer
      g.bindBuffer(g.ARRAY_BUFFER, this.posBuffer);
      const neededBytes = mercArray.byteLength;
      const currentSize = g.getBufferParameter(g.ARRAY_BUFFER, g.BUFFER_SIZE);
      if (neededBytes > currentSize) {
        g.bufferData(g.ARRAY_BUFFER, neededBytes, g.DYNAMIC_DRAW);
      }
      g.bufferSubData(g.ARRAY_BUFFER, 0, mercArray);
      
      // Draw with 3D coordinates
      g.vertexAttribPointer(this.aPosLocation, 3, g.FLOAT, false, 0, 0);

      // Debug code - move here
      if (this.dbgFrame === 0 && count > 0) {
        console.log(`WebGL Debug - First NPC:`);
        console.log(`  lng/lat: ${lngLatArray[0].toFixed(9)}, ${lngLatArray[1].toFixed(9)}`);
        console.log(`  mercator: ${mercArray[0].toFixed(9)}, ${mercArray[1].toFixed(9)}`);
        console.log(`  worldSize: ${worldSize}`);
        console.log(`  map center: ${this.map.getCenter().lng.toFixed(9)}, ${this.map.getCenter().lat.toFixed(9)}`);
        console.log(`  map zoom: ${this.map.getZoom().toFixed(3)}`);
      }
    }

    // Set state and draw
    g.useProgram(this.program);
    // Bind texture if ready
    if (this.textureLoaded) {
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, this.texture);
      g.uniform1i(this.uTexLocation, 0);
    }

    // No need for centre uniform – baked into adjusted matrix

    // Set point size (account for devicePixelRatio so on high-DPI displays the sprite stays crisp)
    const zoom = this.map.getZoom();
    const sizePx = this.calculatePointSizePx(zoom) * (window.devicePixelRatio || 1);
    g.uniform1f(this.uPointSizeLocation, sizePx);

    // Ensure point size from shader is respected (WebGL2 constant 0x8642)
    if ((g as any).PROGRAM_POINT_SIZE) {
      g.enable((g as any).PROGRAM_POINT_SIZE);
    }

    // MapLibre versions provide the matrix in different locations:
    //  • v1.x: second argument is Float32Array (16)
    //  • v2.x+: second argument is an object implementing CustomRenderMethodInput
    //           with modelViewProjectionMatrix (Float32Array)
    //           some bleeding-edge builds still expose .matrix property.
    let matInput: any = (matrix as any)?.matrix
      ?? (matrix as any)?.modelViewProjectionMatrix
      ?? matrix;
    let matF32: Float32Array | null = null;
    if (matInput instanceof Float32Array && matInput.length === 16) {
      matF32 = matInput;
    } else if (matInput instanceof Float64Array && matInput.length === 16) {
      matF32 = new Float32Array(matInput);
    } else if (Array.isArray(matInput) && matInput.length >= 16) {
      matF32 = new Float32Array(matInput.slice(0, 16));
    } else if (matInput && typeof matInput.toFloat32Array === 'function') {
      matF32 = matInput.toFloat32Array();
    }
    if (!matF32 || matF32.length !== 16) {
      console.warn('NpcInstancedLayer: unexpected matrix format', matInput);
      return; // skip this frame to avoid GL error
    }

    // ─── Inject centre translation so vertex coords remain relative (small) ───
    if (!NpcInstancedLayer.USE_SCREEN_COORDS) {
      // Construct a new matrix: matF32 * Translate(centrePxX, centrePxY)
      const tx = centrePxX;
      const ty = centrePxY;
      // Manual multiplication of matF32 * translation matrix [1 0 0 tx; 0 1 0 ty; 0 0 1 0; 0 0 0 1]
      // Only the 4th column changes: newCol = mat * vec4(tx, ty, 0, 1)
      const m = matF32;
      const newMat = new Float32Array(16);
      // Copy first three columns (indices 0..11)
      newMat[0] = m[0];  newMat[1] = m[1];  newMat[2] = m[2];  newMat[3] = m[3];
      newMat[4] = m[4];  newMat[5] = m[5];  newMat[6] = m[6];  newMat[7] = m[7];
      newMat[8] = m[8];  newMat[9] = m[9];  newMat[10]= m[10]; newMat[11]= m[11];
      // Compute translated 4th column
      newMat[12] = m[0]*tx + m[4]*ty + m[12];
      newMat[13] = m[1]*tx + m[5]*ty + m[13];
      newMat[14] = m[2]*tx + m[6]*ty + m[14];
      newMat[15] = m[3]*tx + m[7]*ty + m[15];
      matF32 = newMat;
    }

    // Ensure we draw above the basemap — disable depth test for this 2-D layer
    g.disable(g.DEPTH_TEST);
    // Enable alpha blending so semi-transparent points blend correctly
    g.enable(g.BLEND);
    g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
    g.uniformMatrix4fv(this.uMatrixLocation, false, matF32);

    g.enableVertexAttribArray(this.aPosLocation);
    // g.vertexAttribPointer(this.aPosLocation, 3, g.FLOAT, false, 0, 0); // This line is now handled by the if/else block

    g.drawArrays(g.POINTS, 0, count);

    // Clean up (restore depth state for other layers)
    g.disableVertexAttribArray(this.aPosLocation);
    g.disable(g.BLEND);
    g.enable(g.DEPTH_TEST);
  }

  onRemove(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    const g = this.gl;
    if (this.posBuffer) g.deleteBuffer(this.posBuffer);
    if (this.program) g.deleteProgram(this.program);
  }
} 
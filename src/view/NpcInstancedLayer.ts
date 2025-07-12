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
  private static readonly BASE_SIZE_PX = 60;

  private calculatePointSizePx(zoom: number): number {
    const referenceZoom   = 21.5;          // looks correct at this zoom
    const scale  = Math.pow(2, (zoom - referenceZoom) / 1.4);
    const size   = Math.max(4, Math.min(60, NpcInstancedLayer.BASE_SIZE_PX * scale));
    console.log('size', size);
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

    const vertSrc = `
    precision mediump float;
    uniform mat4 u_matrix;
    uniform float u_pointSize;
    attribute vec3 a_pos;
    void main() {
      gl_Position = u_matrix * vec4(a_pos, 1.0);
      gl_PointSize = u_pointSize;
    }`;

    const fragSrc = `
    precision mediump float;
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
    const mercArray = new Float32Array(count * 3);
    const worldSize = (this.map as any).transform?.worldSize || 512;
    // MapLibre expects coordinates in "world" units where the full map width at the
    // current zoom equals `transform.worldSize`. Multiply the normalised Mercator
    // [0-1] coordinate by this `worldSize` to get the correct value for every zoom.
    const scale = worldSize;
    for (let i = 0; i < count; i++) {
      const lng = lngLatArray[i * 2];
      const lat = lngLatArray[i * 2 + 1];
      const merc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
      // MapLibre's matrix expects world coordinates where the full world at zoom 0
      // spans 512 units. Multiply by 512 so points land at the right spot regardless
      // of projection (mercator vs. globe).
      mercArray[i * 3] = merc.x * scale;
      mercArray[i * 3 + 1] = merc.y * scale;
      mercArray[i * 3 + 2] = 0.0; // altitude 0
    }

    // Upload data to buffer
    g.bindBuffer(g.ARRAY_BUFFER, this.posBuffer);
    // Resize buffer if needed
    const neededBytes = mercArray.byteLength;
    const currentSize = g.getBufferParameter(g.ARRAY_BUFFER, g.BUFFER_SIZE);
    if (neededBytes > currentSize) {
      g.bufferData(g.ARRAY_BUFFER, neededBytes, g.DYNAMIC_DRAW);
    }
    g.bufferSubData(g.ARRAY_BUFFER, 0, mercArray);

    // Set state and draw
    g.useProgram(this.program);
    // Bind texture if ready
    if (this.textureLoaded) {
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, this.texture);
      g.uniform1i(this.uTexLocation, 0);
    }

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

    // Ensure we draw above the basemap — disable depth test for this 2-D layer
    g.disable(g.DEPTH_TEST);
    // Enable alpha blending so semi-transparent points blend correctly
    g.enable(g.BLEND);
    g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
    g.uniformMatrix4fv(this.uMatrixLocation, false, matF32);

    g.enableVertexAttribArray(this.aPosLocation);
    g.vertexAttribPointer(this.aPosLocation, 3, g.FLOAT, false, 0, 0);

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
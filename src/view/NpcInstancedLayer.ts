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

  // Debug helper
  private dbgFrame = 0;

  // ECS query for fallback path (no worker)
  private query = defineQuery([NpcTag, Position]);

  /* ---------------- MapLibre hooks ---------------- */
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    this.map = map;
    // Ensure we are working with a WebGL2 context – MapLibre creates WebGL1 but we can cast.
    this.gl = gl as WebGLRenderingContext;

    const vertSrc = `
    precision mediump float;
    uniform mat4 u_matrix;
    attribute vec3 a_pos;
    void main() {
      gl_Position = u_matrix * vec4(a_pos, 1.0);
      gl_PointSize = 10.0; // pixel size of NPC square for better visibility
    }`;

    const fragSrc = `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(0.8, 0.0, 0.0, 0.6);
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
    this.uMatrixLocation = this.gl.getUniformLocation(this.program, 'u_matrix')!;

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

    if (this.dbgFrame === 0) {
      console.debug(`NpcInstancedLayer: ${count} NPCs – first at lng=${lngLatArray[0].toFixed(5)}, lat=${lngLatArray[1].toFixed(5)}`);
    }

    // Convert to mercator world coords expected by MapLibre matrix
    const mercArray = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const lng = lngLatArray[i * 2];
      const lat = lngLatArray[i * 2 + 1];
      const merc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
      // MapLibre's matrix expects world coordinates where the full world at zoom 0
      // spans 512 units. Multiply by 512 so points land at the right spot regardless
      // of projection (mercator vs. globe).
      mercArray[i * 3] = merc.x;
      mercArray[i * 3 + 1] = merc.y;
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
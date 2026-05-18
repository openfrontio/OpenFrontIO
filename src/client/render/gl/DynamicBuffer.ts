/**
 * DynamicInstanceBuffer — manages grow-on-demand instance buffers.
 *
 * Encapsulates the pattern of doubling capacity when needed, allocating new
 * Float32Array, copying old data, and rebinding the GL buffer.
 */

export class DynamicInstanceBuffer {
  private data: Float32Array;
  private bytes: Uint8Array;
  private capacity: number;

  constructor(
    private gl: WebGL2RenderingContext,
    private buf: WebGLBuffer,
    initialCapacity: number,
    private floatsPerInstance: number,
  ) {
    this.capacity = initialCapacity;
    this.data = new Float32Array(initialCapacity * floatsPerInstance);
    this.bytes = new Uint8Array(this.data.buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }

  ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    while (this.capacity < needed) this.capacity *= 2;
    const newData = new Float32Array(this.capacity * this.floatsPerInstance);
    newData.set(this.data);
    this.data = newData;
    this.bytes = new Uint8Array(newData.buffer);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }

  get float32(): Float32Array {
    return this.data;
  }

  get uint8(): Uint8Array {
    return this.bytes;
  }

  get buffer(): WebGLBuffer {
    return this.buf;
  }

  dispose(): void {
    if (this.buf !== null && this.buf !== undefined) {
      this.gl.deleteBuffer(this.buf);
    }
  }
}

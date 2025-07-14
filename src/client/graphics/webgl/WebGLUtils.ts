export class WebGLUtils {
  /**
   * Creates and compiles a WebGL shader
   */
  static createShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) {
      console.error("Failed to create shader");
      return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      console.error("Shader compilation error:", error);
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Creates a WebGL program from vertex and fragment shaders
   */
  static createProgram(
    gl: WebGLRenderingContext,
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader,
  ): WebGLProgram | null {
    const program = gl.createProgram();
    if (!program) {
      console.error("Failed to create program");
      return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      console.error("Program linking error:", error);
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  /**
   * Checks if WebGL is supported in the current browser
   */
  static isWebGLSupported(): boolean {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      return gl !== null;
    } catch (e) {
      return false;
    }
  }
}

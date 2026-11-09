import { describe, expect, it } from "vitest";
import {
  compileShader,
  createProgram,
  GLContextLostError,
} from "../src/client/render/gl/utils/GlUtils";

const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;
const VERTEX_SHADER = 0x8b31;
const CONTEXT_LOST_WEBGL = 0x9242;
const UNMASKED_RENDERER = 0x9246;

interface FakeGLOpts {
  /** Emulate a context that died: every query returns null (WebGL 1.0 §5.15.2). */
  contextLost?: boolean;
  compileOk?: boolean;
  linkOk?: boolean;
  shaderLog?: string | null;
  programLog?: string | null;
  /** Unmasked renderer string; undefined means the debug extension is hidden. */
  renderer?: string;
}

/**
 * Minimal WebGL2 stand-in. The important part is the lost-context behaviour:
 * a lost context does not throw or return false, it returns *null* from every
 * getXParameter / getXInfoLog call.
 */
function fakeGL(opts: FakeGLOpts = {}): WebGL2RenderingContext {
  const lost = opts.contextLost ?? false;
  const nullIfLost = <T>(v: T) => (lost ? null : v);
  return {
    COMPILE_STATUS,
    LINK_STATUS,
    VERTEX_SHADER,
    FRAGMENT_SHADER: 0x8b30,
    isContextLost: () => lost,
    getError: () => (lost ? CONTEXT_LOST_WEBGL : 0),
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    deleteShader: () => {},
    getShaderParameter: () => nullIfLost(opts.compileOk ?? true),
    getShaderInfoLog: () => nullIfLost(opts.shaderLog ?? ""),
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    deleteProgram: () => {},
    getProgramParameter: () => nullIfLost(opts.linkOk ?? true),
    getProgramInfoLog: () => nullIfLost(opts.programLog ?? ""),
    getExtension: (ext: string) =>
      ext === "WEBGL_debug_renderer_info" && opts.renderer !== undefined
        ? { UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER }
        : null,
    getParameter: (p: number) =>
      p === UNMASKED_RENDERER ? opts.renderer : null,
  } as unknown as WebGL2RenderingContext;
}

describe("createProgram", () => {
  it("returns the program when the shaders compile and link", () => {
    expect(createProgram(fakeGL(), "vert", "frag", "TestPass")).toBeTruthy();
  });

  it("reports a real link failure with the driver's info log", () => {
    const gl = fakeGL({ linkOk: false, programLog: "varying count exceeded" });
    expect(() => createProgram(gl, "vert", "frag", "TestPass")).toThrow(
      /Program link error \[TestPass, GPU: unknown\]:\nvarying count exceeded/,
    );
  });

  it("includes the GL error code when a real link failure has no info log", () => {
    // Drivers are allowed to link-fail with an empty log; without the error
    // code such a report carries no information at all.
    const gl = fakeGL({ linkOk: false, programLog: "" });
    expect(() => createProgram(gl, "vert", "frag", "TestPass")).toThrow(
      /Program link error \[TestPass, GPU: unknown\]: \(no info log, glGetError=0\)/,
    );
  });

  it("names the program and the GPU when a link fails with no info log", () => {
    // Mobile drivers link-fail with an empty log; the program name and the
    // renderer string are then the only way to tell which pass broke where.
    const gl = fakeGL({
      linkOk: false,
      programLog: "",
      renderer: "Adreno (TM) 610",
    });
    expect(() => createProgram(gl, "vert", "frag", "UnitPass")).toThrow(
      "Program link error [UnitPass, GPU: Adreno (TM) 610]: " +
        "(no info log, glGetError=0)",
    );
  });

  it("names which shader of the program failed to compile", () => {
    const gl = fakeGL({
      compileOk: false,
      shaderLog: "",
      renderer: "Mali-G52",
    });
    expect(() => createProgram(gl, "vert", "frag", "UnitPass")).toThrow(
      "Shader compile error [UnitPass vertex, GPU: Mali-G52]: " +
        "(no info log, glGetError=0)",
    );
  });

  it("reports a lost context as a lost context, not a link error", () => {
    // Shaders compiled fine, then the GPU process died. LINK_STATUS reads null
    // (falsy) and getProgramInfoLog returns null, so the old code blamed the
    // shader and printed an empty log.
    const gl = fakeGL({ contextLost: true });
    let thrown: unknown;
    try {
      createProgram(gl, "vert", "frag", "TestPass");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(GLContextLostError);
    expect((thrown as Error).message).not.toMatch(/link error/i);
    expect((thrown as Error).message).toMatch(/not a shader error/);
  });
});

describe("compileShader", () => {
  it("reports a real compile failure with the driver's info log", () => {
    const gl = fakeGL({ compileOk: false, shaderLog: "syntax error" });
    expect(() =>
      compileShader(gl, VERTEX_SHADER, "src", "TestPass vertex"),
    ).toThrow(
      /Shader compile error \[TestPass vertex, GPU: unknown\]:\nsyntax error/,
    );
  });

  it("reports a lost context as a lost context", () => {
    const gl = fakeGL({ contextLost: true });
    expect(() =>
      compileShader(gl, VERTEX_SHADER, "src", "TestPass vertex"),
    ).toThrow(GLContextLostError);
  });
});

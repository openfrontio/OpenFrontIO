/**
 * Utility for loading WGSL shader sources bundled by Vite.
 * Uses a static glob so production builds reliably include all shaders.
 */

const shaderSources = import.meta.glob("../shaders/**/*.wgsl", {
  as: "raw",
  eager: true,
}) as Record<string, string>;

export async function loadShader(path: string): Promise<string> {
  const key = `../shaders/${path}`;
  const src = shaderSources[key];
  if (!src) {
    throw new Error(`Missing WGSL shader source: ${key}`);
  }
  return src;
}

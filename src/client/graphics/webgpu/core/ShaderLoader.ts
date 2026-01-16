/**
 * Utility for loading WGSL shader files via Vite ?raw imports.
 * Caches loaded shaders to avoid re-importing.
 */

const shaderCache = new Map<string, Promise<string>>();

/**
 * Load a shader file from the shaders directory.
 * @param path Relative path from shaders/ directory (e.g., "compute/state-update.wgsl")
 * @returns Promise resolving to the shader code as a string
 */
export async function loadShader(path: string): Promise<string> {
  // Check cache first
  if (shaderCache.has(path)) {
    return shaderCache.get(path)!;
  }

  // Import shader using Vite ?raw import
  const shaderPromise = import(`../shaders/${path}?raw`).then(
    (module) => module.default as string,
  );

  // Cache the promise
  shaderCache.set(path, shaderPromise);

  return shaderPromise;
}

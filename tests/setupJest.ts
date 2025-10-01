import { readFileSync } from "fs";
import { join } from "path";

// Mock the fetch API for WASM loading in Jest
global.fetch = jest.fn((url: RequestInfo | URL) => {
  const urlString = typeof url === "string" ? url : url.toString();
  if (urlString.endsWith("pathfinding_bg.wasm")) {
    const wasmBuffer = readFileSync(
      join(__dirname, "../static/js/pathfinding_bg.wasm"),
    );
    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(wasmBuffer.buffer),
      headers: new Headers(),
      ok: true,
      redirected: false,
      status: 200,
      statusText: "OK",
      type: "basic",
      url: urlString,
      clone: () => global.fetch(url),
    } as Response);
  }
  return Promise.reject(new Error(`Unhandled fetch request for: ${urlString}`));
});

// Mock WebAssembly.instantiateStreaming for Node.js environment
// This is needed because wasm-bindgen generated code uses instantiateStreaming
// but Jest runs in Node.js where it's not available.
global.WebAssembly.instantiateStreaming = jest.fn<
  Promise<WebAssembly.WebAssemblyInstantiatedSource>,
  [Response | PromiseLike<Response>, WebAssembly.Imports?]
>(
  async (
    source: Response | PromiseLike<Response>,
    importObject: WebAssembly.Imports | undefined,
  ) => {
    const response = await source;
    const buffer = await response.arrayBuffer();
    return WebAssembly.instantiate(buffer, importObject);
    }
    const response = await source;
    const buffer = await response.arrayBuffer();
    return WebAssembly.instantiate(buffer, importObject);
  },
);

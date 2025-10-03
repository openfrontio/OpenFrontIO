import { readFileSync } from "fs";
import { join } from "path";

let wasm: typeof import("../wasm/pathfinding/pkg");

async function loadWasm() {
  if (!wasm) {
    const pkg = await import("../wasm/pathfinding/pkg");

    // Manually load the wasm file
    const wasmPath = join(__dirname, "../static/js/pathfinding_bg.wasm");
    const wasmBuffer = readFileSync(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuffer);

    wasm = await pkg.default({ data: wasmModule }); // Pass the compiled module to init
  }
}

describe("WASM Vec<u8> transfer", () => {
  test("should correctly transfer Array to Vec<u8>", async () => {
    await loadWasm();

    const testArray = [1, 2, 3, 4, 5]; // Changed to Array
    const len = wasm.get_vec_len(testArray);
    expect(len).toBe(5);

    const emptyArray = []; // Changed to Array
    const emptyLen = wasm.get_vec_len(emptyArray);
    expect(emptyLen).toBe(0);
  });
});

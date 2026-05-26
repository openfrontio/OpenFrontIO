import { describe, expect, test } from "vitest";
import {
  selectTerritoryBackend,
  type TerritoryBackendCandidate,
  type TerritoryRendererId,
  type TerritoryRendererPreference,
} from "../src/client/graphics/layers/TerritoryBackend";

type FakeBackendSpec = {
  initError?: string;
  ready?: boolean;
  failureReason?: string;
};

type FakeBackendSpecs = Partial<Record<TerritoryRendererId, FakeBackendSpec>>;

class FakeBackend implements TerritoryBackendCandidate {
  initialized = false;
  disposed = false;

  constructor(
    readonly id: TerritoryRendererId,
    private readonly spec: FakeBackendSpec = {},
  ) {}

  init() {
    this.initialized = true;
    if (this.spec.initError) {
      throw new Error(this.spec.initError);
    }
  }

  async whenReady(): Promise<boolean> {
    return this.spec.ready ?? true;
  }

  getFailureReason(): string | null {
    return this.spec.failureReason ?? null;
  }

  dispose() {
    this.disposed = true;
  }
}

class RendererSelectionHarness {
  active: TerritoryRendererId | null = null;
  readonly failed = new Set<TerritoryRendererId>();
  preference: TerritoryRendererPreference;

  constructor(preference: TerritoryRendererPreference) {
    this.preference = preference;
  }

  setPreference(preference: TerritoryRendererPreference) {
    this.preference = preference;
    this.failed.clear();
  }

  async select(specs: FakeBackendSpecs = {}) {
    const created: FakeBackend[] = [];
    const selection = await selectTerritoryBackend(
      this.preference,
      this.failed,
      (id) => {
        const backend = new FakeBackend(id, specs[id]);
        created.push(backend);
        return backend;
      },
    );

    for (const failure of selection.failures) {
      if (failure.id !== "classic") {
        this.failed.add(failure.id);
      }
    }
    if (selection.backend) {
      this.active = selection.backend.id;
    }

    return { ...selection, created };
  }

  async failActiveRuntime(specs: FakeBackendSpecs = {}) {
    if (this.active && this.active !== "classic") {
      this.failed.add(this.active);
    }
    return this.select(specs);
  }
}

describe("territory renderer backend selection", () => {
  test("auto selects WebGPU when ready", async () => {
    const harness = new RendererSelectionHarness("auto");

    const result = await harness.select();

    expect(result.backend?.id).toBe("webgpu");
    expect(harness.active).toBe("webgpu");
    expect(result.failures).toEqual([]);
    expect(result.created.map((backend) => backend.id)).toEqual(["webgpu"]);
  });

  test("auto falls back to WebGL when WebGPU init fails", async () => {
    const harness = new RendererSelectionHarness("auto");

    const result = await harness.select({
      webgpu: { initError: "navigator.gpu unavailable" },
    });

    expect(result.backend?.id).toBe("webgl");
    expect(harness.active).toBe("webgl");
    expect(result.failures.map((failure) => failure.id)).toEqual(["webgpu"]);
    expect(result.created[0].disposed).toBe(true);
  });

  test("auto falls back to classic when both accelerated backends fail", async () => {
    const harness = new RendererSelectionHarness("auto");

    const result = await harness.select({
      webgpu: { initError: "navigator.gpu unavailable" },
      webgl: { failureReason: "WebGL2 unavailable" },
    });

    expect(result.backend?.id).toBe("classic");
    expect(harness.active).toBe("classic");
    expect(result.failures.map((failure) => failure.id)).toEqual([
      "webgpu",
      "webgl",
    ]);
  });

  test("forced WebGPU falls back on runtime failure without changing saved setting", async () => {
    const harness = new RendererSelectionHarness("webgpu");
    await harness.select();

    const result = await harness.failActiveRuntime();

    expect(result.backend?.id).toBe("webgl");
    expect(harness.active).toBe("webgl");
    expect(harness.preference).toBe("webgpu");
    expect(harness.failed.has("webgpu")).toBe(true);
  });

  test("manual setting change retries previously failed backends", async () => {
    const harness = new RendererSelectionHarness("auto");
    await harness.select({
      webgpu: { initError: "navigator.gpu unavailable" },
    });

    expect(harness.active).toBe("webgl");
    expect(harness.failed.has("webgpu")).toBe(true);

    harness.setPreference("auto");
    const retry = await harness.select();

    expect(retry.backend?.id).toBe("webgpu");
    expect(harness.active).toBe("webgpu");
    expect(harness.failed.size).toBe(0);
  });
});

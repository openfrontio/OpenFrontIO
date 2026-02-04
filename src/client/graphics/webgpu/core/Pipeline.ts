type AnyFn = (...args: any[]) => any;
type SlowPipelineKind = "compute" | "render";
type SlowPipelineEvent = {
  kind: SlowPipelineKind;
  ms: number;
  label?: string;
};

function getOptionalMethod<T extends AnyFn>(
  obj: unknown,
  name: string,
): T | undefined {
  const anyObj = obj as any;
  const value = anyObj?.[name];
  return typeof value === "function" ? (value as T) : undefined;
}

function emitSlowPipelineEvent(event: SlowPipelineEvent): void {
  const hook = (globalThis as any).__webgpuSlowPipelineHook;
  if (typeof hook !== "function") {
    return;
  }
  try {
    hook(event);
  } catch {
    // ignore
  }
}

export async function createComputePipeline(
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
  debugLabel?: string,
): Promise<GPUComputePipeline> {
  const start = performance.now();

  const maybeAsync = getOptionalMethod<
    (desc: GPUComputePipelineDescriptor) => Promise<GPUComputePipeline>
  >(device, "createComputePipelineAsync");

  const pipeline = maybeAsync
    ? await maybeAsync.call(device, descriptor)
    : device.createComputePipeline(descriptor);

  const ms = performance.now() - start;
  if (ms > 250) {
    console.warn("WebGPU slow compute pipeline compile", {
      ms: Math.round(ms),
      label: debugLabel,
    });
    emitSlowPipelineEvent({
      kind: "compute",
      ms,
      label: debugLabel,
    });
  }

  return pipeline;
}

export async function createRenderPipeline(
  device: GPUDevice,
  descriptor: GPURenderPipelineDescriptor,
  debugLabel?: string,
): Promise<GPURenderPipeline> {
  const start = performance.now();

  const maybeAsync = getOptionalMethod<
    (desc: GPURenderPipelineDescriptor) => Promise<GPURenderPipeline>
  >(device, "createRenderPipelineAsync");

  const pipeline = maybeAsync
    ? await maybeAsync.call(device, descriptor)
    : device.createRenderPipeline(descriptor);

  const ms = performance.now() - start;
  if (ms > 250) {
    console.warn("WebGPU slow render pipeline compile", {
      ms: Math.round(ms),
      label: debugLabel,
    });
    emitSlowPipelineEvent({
      kind: "render",
      ms,
      label: debugLabel,
    });
  }

  return pipeline;
}

import { Layer } from "./Layer";

export type TerritoryRendererId = "classic" | "webgl" | "webgpu";
export type TerritoryRendererPreference = "auto" | TerritoryRendererId;
export const TERRITORY_RENDERER_STATUS_EVENT =
  "event:territory-renderer-status";

export const TERRITORY_RENDERER_OPTIONS: TerritoryRendererPreference[] = [
  "auto",
  "classic",
  "webgl",
  "webgpu",
];

export interface TerritoryBackend extends Layer {
  readonly id: TerritoryRendererId;
  dispose?: () => void;
  getFailureReason?: () => string | null;
  whenReady?: () => Promise<boolean>;
}

export interface TerritoryRendererStatus {
  active: TerritoryRendererId | null;
  preference: TerritoryRendererPreference;
  failedBackends: TerritoryRendererId[];
  message: string | null;
}

export interface TerritoryBackendCandidate {
  readonly id: TerritoryRendererId;
  init?: () => void | Promise<void>;
  dispose?: () => void;
  getFailureReason?: () => string | null;
  whenReady?: () => Promise<boolean>;
}

export interface TerritoryBackendSelectionFailure {
  id: TerritoryRendererId;
  reason: string;
  error?: unknown;
}

export interface TerritoryBackendSelection<
  T extends TerritoryBackendCandidate,
> {
  backend: T | null;
  failures: TerritoryBackendSelectionFailure[];
  cancelled: boolean;
}

export function normalizeTerritoryRendererPreference(
  value: string | null | undefined,
): TerritoryRendererPreference {
  if (
    value === "classic" ||
    value === "webgl" ||
    value === "webgpu" ||
    value === "auto"
  ) {
    return value;
  }
  return "auto";
}

export function territoryRendererOrder(
  preference: TerritoryRendererPreference,
  failedBackends: ReadonlySet<TerritoryRendererId> = new Set(),
): TerritoryRendererId[] {
  const preferredOrder: TerritoryRendererId[] =
    preference === "classic"
      ? ["classic"]
      : preference === "webgl"
        ? ["webgl", "classic"]
        : ["webgpu", "webgl", "classic"];

  return preferredOrder.filter(
    (id) => id === "classic" || !failedBackends.has(id),
  );
}

export async function selectTerritoryBackend<
  T extends TerritoryBackendCandidate,
>(
  preference: TerritoryRendererPreference,
  failedBackends: ReadonlySet<TerritoryRendererId>,
  createBackend: (id: TerritoryRendererId) => T,
  shouldContinue: () => boolean = () => true,
): Promise<TerritoryBackendSelection<T>> {
  const failures: TerritoryBackendSelectionFailure[] = [];

  for (const id of territoryRendererOrder(preference, failedBackends)) {
    if (!shouldContinue()) {
      return { backend: null, failures, cancelled: true };
    }

    const backend = createBackend(id);
    try {
      await backend.init?.();

      if (!shouldContinue()) {
        backend.dispose?.();
        return { backend: null, failures, cancelled: true };
      }

      let reason = backend.getFailureReason?.() ?? null;
      if (reason !== null) {
        backend.dispose?.();
        failures.push({ id, reason });
        continue;
      }

      if (backend.whenReady) {
        const ready = await backend.whenReady();

        if (!shouldContinue()) {
          backend.dispose?.();
          return { backend: null, failures, cancelled: true };
        }

        reason = backend.getFailureReason?.() ?? null;
        if (!ready || reason !== null) {
          backend.dispose?.();
          failures.push({
            id,
            reason: reason ?? "initialization failed",
          });
          continue;
        }
      }

      return { backend, failures, cancelled: false };
    } catch (error) {
      backend.dispose?.();
      failures.push({
        id,
        reason: error instanceof Error ? error.message : String(error),
        error,
      });
    }
  }

  return { backend: null, failures, cancelled: false };
}

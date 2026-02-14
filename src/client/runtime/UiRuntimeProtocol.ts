import protocolManifestJson from "../../../protocol/ui_runtime_protocol.json" with { type: "json" };

export type UiRuntimePayloadFieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "stringOrNull"
  | "numberOrNull"
  | "booleanOrNull"
  | "any";

export interface UiRuntimePayloadFieldSpec {
  type: UiRuntimePayloadFieldType;
  required: boolean;
}

export interface UiRuntimeMessageSpec {
  name: string;
  payload: Record<string, UiRuntimePayloadFieldSpec>;
}

interface UiRuntimeProtocolManifest {
  version: number;
  actions: Record<string, UiRuntimeMessageSpec>;
  events: Record<string, UiRuntimeMessageSpec>;
  snapshots: Record<string, UiRuntimeMessageSpec>;
}

const manifest = protocolManifestJson as UiRuntimeProtocolManifest;

export const UI_RUNTIME_PROTOCOL_VERSION = manifest.version;

function mapNames<T extends Record<string, UiRuntimeMessageSpec>>(
  group: T,
): { [K in keyof T]: string } {
  const entries = Object.entries(group).map(([key, spec]) => [key, spec.name]);
  return Object.fromEntries(entries) as { [K in keyof T]: string };
}

export const UI_RUNTIME_ACTIONS = mapNames(manifest.actions);
export const UI_RUNTIME_EVENTS = mapNames(manifest.events);
export const UI_RUNTIME_SNAPSHOTS = mapNames(manifest.snapshots);

export type UiRuntimeActionKey = keyof typeof UI_RUNTIME_ACTIONS;
export type UiRuntimeEventKey = keyof typeof UI_RUNTIME_EVENTS;
export type UiRuntimeSnapshotKey = keyof typeof UI_RUNTIME_SNAPSHOTS;

const actionSpecsByType = new Map<string, UiRuntimeMessageSpec>(
  Object.values(manifest.actions).map((spec) => [spec.name, spec]),
);
const eventSpecsByType = new Map<string, UiRuntimeMessageSpec>(
  Object.values(manifest.events).map((spec) => [spec.name, spec]),
);
const snapshotSpecsByType = new Map<string, UiRuntimeMessageSpec>(
  Object.values(manifest.snapshots).map((spec) => [spec.name, spec]),
);

function typeMatches(
  value: unknown,
  expected: UiRuntimePayloadFieldType,
): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "stringOrNull":
      return value === null || typeof value === "string";
    case "numberOrNull":
      return (
        value === null ||
        (typeof value === "number" && Number.isFinite(value))
      );
    case "booleanOrNull":
      return value === null || typeof value === "boolean";
    case "any":
      return true;
    default:
      return false;
  }
}

function validateMessagePayload(
  typeName: string,
  payload: unknown,
  spec: UiRuntimeMessageSpec | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!spec) {
    return { ok: true };
  }

  const fieldEntries = Object.entries(spec.payload);
  if (fieldEntries.length === 0) {
    return { ok: true };
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    const missingRequired = fieldEntries.some(([, fieldSpec]) => fieldSpec.required);
    if (!missingRequired && (payload === undefined || payload === null)) {
      return { ok: true };
    }
    return {
      ok: false,
      error: `Runtime payload for ${typeName} must be an object`,
    };
  }

  const objectPayload = payload as Record<string, unknown>;
  for (const [fieldName, fieldSpec] of fieldEntries) {
    const value = objectPayload[fieldName];

    if (value === undefined) {
      if (fieldSpec.required) {
        return {
          ok: false,
          error: `Runtime payload for ${typeName} is missing required field \`${fieldName}\``,
        };
      }
      continue;
    }

    if (!typeMatches(value, fieldSpec.type)) {
      return {
        ok: false,
        error: `Runtime payload for ${typeName} has invalid field \`${fieldName}\`; expected ${fieldSpec.type}`,
      };
    }
  }

  return { ok: true };
}

export function validateUiRuntimeActionPayload(
  actionType: string,
  payload: unknown,
): { ok: true } | { ok: false; error: string } {
  return validateMessagePayload(actionType, payload, actionSpecsByType.get(actionType));
}

export function validateUiRuntimeEventPayload(
  eventType: string,
  payload: unknown,
): { ok: true } | { ok: false; error: string } {
  return validateMessagePayload(eventType, payload, eventSpecsByType.get(eventType));
}

export function validateUiRuntimeSnapshotPayload(
  snapshotType: string,
  payload: unknown,
): { ok: true } | { ok: false; error: string } {
  return validateMessagePayload(
    snapshotType,
    payload,
    snapshotSpecsByType.get(snapshotType),
  );
}

export function getUiRuntimeProtocolManifest(): UiRuntimeProtocolManifest {
  return manifest;
}

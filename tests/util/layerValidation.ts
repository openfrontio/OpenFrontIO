/**
 * Shared layer validation logic used by both MapConsistency and MapLayers tests.
 * Mirrors the validation in map-generator/codegen.go.
 */

const VALID_ID_RE = /^[a-zA-Z0-9-]+$/;

export interface LayerDefinition {
  id: unknown;
  placement: unknown;
  nukeable?: unknown;
}

/**
 * Validate a single layer definition.  Returns an array of error strings
 * (empty if the layer is valid).  `index` and `mapName` are used only for
 * error messages.
 */
export function validateLayer(
  layer: LayerDefinition,
  index: number,
  mapName: string,
  seenIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const prefix = `${mapName}: layers[${index}]`;

  if (typeof layer.id !== "string") {
    errors.push(`${prefix} "id" must be a string, got ${typeof layer.id}`);
    return errors;
  }
  if (layer.id === "") {
    errors.push(`${prefix} "id" must not be empty`);
  }
  if (layer.id === "image") {
    errors.push(`${prefix} "id" must not be "image" (reserved)`);
  }
  if (layer.id !== "" && !VALID_ID_RE.test(layer.id)) {
    errors.push(
      `${prefix} "id" (${JSON.stringify(layer.id)}) must be alphanumeric (hyphens allowed)`,
    );
  }
  if (seenIds.has(layer.id)) {
    errors.push(`${prefix} duplicate layer id ${JSON.stringify(layer.id)}`);
  }
  seenIds.add(layer.id);
  if (layer.placement !== "land" && layer.placement !== "water") {
    errors.push(
      `${prefix} "placement" (${JSON.stringify(layer.placement)}) must be "land" or "water"`,
    );
  }
  if (layer.nukeable !== undefined && typeof layer.nukeable !== "boolean") {
    errors.push(
      `${prefix} "nukeable" must be a boolean if present, got ${typeof layer.nukeable}`,
    );
  }

  return errors;
}

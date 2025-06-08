import { base64url } from "jose";
import rawTerritoryPatterns from "../../resources/cosmetic/cosmetic.json" with { type: "json" };
import { CosmeticsSchema } from "./Schemas";

export const territoryPatterns = CosmeticsSchema.parse(rawTerritoryPatterns);

/**
 * Converts a UUID string to a base64url-encoded binary representation.
 * @param uuid - The UUID string (e.g., '123e4567-e89b-12d3-a456-426614174000')
 * @returns base64url string (e.g., 'Ej5FZ+i7EtOkVkJmFBdAAA')
 */
export function uuidToBase64url(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);

  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return base64url.encode(bytes);
}

/**
 * Converts a base64url-encoded binary UUID back to its canonical UUID string.
 * @param encoded - base64url string (e.g., 'Ej5FZ+i7EtOkVkJmFBdAAA')
 * @returns UUID string (e.g., '123e4567-e89b-12d3-a456-426614174000')
 */
export function base64urlToUuid(encoded: string): string {
  const bytes = base64url.decode(encoded);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * API Client utility for handling cross-origin requests
 * When the client is deployed on a different host than the server (e.g., Vercel),
 * this ensures API calls are made to the correct server host.
 */

/**
 * Get the base URL for API requests
 * Uses WEBSOCKET_HOST environment variable when available (production)
 * Falls back to current location for development or same-host deployments
 */
export function getApiBaseUrl(): string {
  if (process.env.WEBSOCKET_HOST) {
    // In production with separate hosts, use the configured server host
    const protocol = window.location.protocol;
    return `${protocol}//${process.env.WEBSOCKET_HOST}`;
  }
  // In development or same-host deployment, use relative URLs
  return '';
}

/**
 * Make a fetch request with the correct base URL
 * @param path The API path (e.g., "/api/env")
 * @param options Fetch options
 */
export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path}`;
  return fetch(url, options);
}
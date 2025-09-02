/**
 * API Client utility for handling cross-origin requests
 * When the client is deployed on a different host than the server (e.g., Vercel),
 * this ensures API calls are made to the correct server host.
 */

/**
 * Get the base URL for API requests
 * Always returns empty string to use relative URLs.
 * This ensures requests go through Vercel's proxy which handles
 * forwarding to the actual server without CORS issues.
 */
export function getApiBaseUrl(): string {
  // Always use relative URLs - Vercel proxy rewrites handle the routing
  // This avoids CORS issues since all requests appear same-origin to the browser
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
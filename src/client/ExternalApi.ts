const LOCAL_API_PORT = "8787";
const LOCAL_API_HOSTS = new Set(["localhost", "127.0.0.1"]);

function tryParseApiBase(apiBase: string): URL | null {
  try {
    return new URL(apiBase);
  } catch {
    return null;
  }
}

export function isLocalExternalApiBase(apiBase: string): boolean {
  const parsed = tryParseApiBase(apiBase);
  if (!parsed) return false;
  return (
    LOCAL_API_HOSTS.has(parsed.hostname.toLowerCase()) &&
    parsed.port === LOCAL_API_PORT
  );
}

export function isLikelyApiUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("unexpected status 5") ||
    message.includes("http error! status: 5")
  );
}

export function localApiUnavailableMessage(featureLabel: string): string {
  return `${featureLabel} service is unavailable in this local dev environment.`;
}

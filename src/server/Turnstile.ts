import { ServerConfig } from "../core/configuration/Config";

type TurnstileResponse =
  | { status: "approved" }
  | { status: "rejected"; reason: string }
  | { status: "error"; reason: string };

export async function verifyTurnstileToken(
  ip: string,
  turnstileToken: string | null,
  config: ServerConfig,
): Promise<TurnstileResponse> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${config.jwtIssuer()}/turnstile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey(),
      },
      body: JSON.stringify({ ip, token: turnstileToken }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        status: "error",
        reason: `api-worker returned ${response.status}`,
      };
    }

    return (await response.json()) as TurnstileResponse;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return {
        status: "error",
        reason: "Turnstile token validation timed out after 5 seconds",
      };
    }
    return {
      status: "error",
      reason: `Turnstile token validation failed, ${e}`,
    };
  }
}

import { z } from "zod";
import { ServerConfig } from "../core/configuration/Config";

const TurnstileVerdictSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("approved") }),
  z.object({ status: z.literal("rejected"), reason: z.string() }),
]);

type TurnstileVerdict = z.infer<typeof TurnstileVerdictSchema>;

export type TurnstileResponse =
  | TurnstileVerdict
  | { status: "error"; reason: string };

export async function verifyTurnstileToken(
  ip: string,
  turnstileToken: string | null,
  config: ServerConfig,
): Promise<TurnstileResponse> {
  if (!turnstileToken) {
    return { status: "rejected", reason: "No turnstile token provided" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

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

    const parsed = TurnstileVerdictSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        status: "error",
        reason: `api-worker returned malformed response: ${parsed.error.message}`,
      };
    }
    return parsed.data;
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

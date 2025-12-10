export async function verifyTurnstileToken(
  ip: string,
  turnstileToken: string | null,
  turnstileSecret: string,
): Promise<
  | { status: "approved" }
  | { status: "rejected"; reason: string }
  | { status: "error"; reason: string }
> {
  if (!turnstileToken) {
    return { status: "rejected", reason: "No turnstile token provided" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          secret: turnstileSecret,
          response: turnstileToken,
          remoteip: ip,
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        status: "error",
        reason: `Turnstile API returned ${response.status}`,
      };
    }

    const result = (await response.json()) as {
      success: boolean;
      challenge_ts?: string;
      hostname?: string;
      "error-codes"?: string[];
      action?: string;
      cdata?: string;
    };

    if (!result.success) {
      const codes = result["error-codes"]?.join(", ") ?? "unknown";
      return {
        status: "rejected",
        reason: `Turnstile token validation failed: ${codes}`,
      };
    }

    return { status: "approved" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return {
        status: "error",
        reason: "Turnstile token validation timed out after 3 seconds",
      };
    }
    return {
      status: "error",
      reason: `Turnstile token validation failed, ${e}`,
    };
  }
}

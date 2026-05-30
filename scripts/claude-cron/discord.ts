import { truncateForDiscord } from "./digest-formatter";

export async function postToDiscord(
  webhookUrl: string,
  markdown: string,
): Promise<void> {
  const body = JSON.stringify({ content: truncateForDiscord(markdown) });
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new Error(
      `Discord webhook failed: ${response.status} ${response.statusText} — ${text}`,
    );
  }
}

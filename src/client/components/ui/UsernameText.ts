import { html, nothing, TemplateResult } from "lit";

// The server renders account usernames as "base.1234" — the suffix is exactly
// four digits (leading zeros kept) and bases can never contain a dot
// (AccountUsernameSchema), so a trailing ".dddd" is unambiguously the
// discriminator. Entitled claim holders render bare and have no suffix at all.
const DISCRIMINATOR_PATTERN = /^(.+)\.(\d{4})$/;

export function splitAccountUsername(username: string): {
  base: string;
  discriminator: string | null;
} {
  const match = DISCRIMINATOR_PATTERN.exec(username);
  if (match === null) return { base: username, discriminator: null };
  return { base: match[1], discriminator: match[2] };
}

/**
 * Account username as a blue base plus a muted "#1234" (bare names render as
 * just the base). `baseClass` styles the base span, so a caller's own row
 * styling — color, weight, truncation — wins over the default.
 */
export function usernameText(
  username: string,
  baseClass = "text-blue-300",
): TemplateResult {
  const { base, discriminator } = splitAccountUsername(username);
  // The outer span keeps the name a single flex item: a bare separator text
  // node becomes an item of its own and collects the parent's `gap` on both
  // sides. The separator itself must be real text, not padding or margin — a
  // caller's hover:underline is painted per text run, so a box gap splits it.
  return html`<span
    ><span class=${baseClass}>${base}</span>${discriminator === null
      ? nothing
      : html`&nbsp;<span class="text-white/40 font-normal"
            >#${discriminator}</span
          >`}</span
  >`;
}

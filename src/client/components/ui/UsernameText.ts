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
 * Standard visual form of an account username: the base in blue followed by a
 * muted "#1234". The gap before the "#" is a left margin rather than a literal
 * space so it never wraps or collapses away from the name it belongs to. Bare
 * names (verified claim holders) render as just the blue base.
 *
 * `baseClass` lets a caller keep its own name styling (weight, truncation,
 * hover) — it is applied to the base span, whose own color declaration wins
 * over any color inherited from the row around it.
 */
export function usernameText(
  username: string,
  baseClass = "text-blue-300",
): TemplateResult {
  const { base, discriminator } = splitAccountUsername(username);
  return html`<span class=${baseClass}>${base}</span>${discriminator === null
      ? nothing
      : html`<span class="ml-1 text-white/40 font-normal"
          >#${discriminator}</span
        >`}`;
}

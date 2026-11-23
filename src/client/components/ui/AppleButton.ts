import { html, svg, TemplateResult } from "lit";
import { translateText } from "../../Utils";

const APPLE_LOGO_PATH =
  "M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z";

export const appleGlyph = (cls: string): TemplateResult => html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    class=${cls}
    aria-hidden="true"
  >
    ${svg`<path d=${APPLE_LOGO_PATH}></path>`}
  </svg>
`;

/**
 * A Sign in with Apple button. Apple's design rules: a black (or white)
 * surface, the Apple logo, and Apple's own wording on the caption. Shared by
 * the sign-in options and the account's "Link Apple" so the two stay alike.
 */
export const appleButton = (
  onClick: (event: MouseEvent) => unknown,
  labelKey: string,
  size: "large" | "small" = "small",
): TemplateResult => html`
  <button
    @click=${onClick}
    class="w-full px-6 ${
      size === "large" ? "py-4" : "py-3"
    } text-white bg-black hover:bg-[#1a1a1a] border border-white/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white transition-colors duration-200 flex items-center justify-center gap-3 shadow-lg"
  >
    ${appleGlyph(size === "large" ? "w-6 h-6 shrink-0" : "w-5 h-5 shrink-0")}
    <span class="font-bold tracking-wide">${translateText(labelKey)}</span>
  </button>
`;

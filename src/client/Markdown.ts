import DOMPurify from "dompurify";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";

/**
 * Render markdown to a sanitized lit template value. Images are stripped
 * unless `includeImages` is set (matching the lit-markdown default this
 * replaces — lit-markdown pulled in sanitize-html (~325 KB min); DOMPurify is
 * already in the bundle).
 */
export function renderMarkdown(
  rawMarkdown: string,
  options?: { includeImages?: boolean },
) {
  const rawHTML = marked.parse(rawMarkdown, { async: false });
  const cleanHTML = DOMPurify.sanitize(
    rawHTML,
    options?.includeImages ? {} : { FORBID_TAGS: ["img"] },
  );
  return unsafeHTML(cleanHTML);
}

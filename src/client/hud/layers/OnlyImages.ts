import DOMPurify from "dompurify";

// Not in shared's SharedUtil: the homepage imports that, and DOMPurify sets
// itself up on import, so the homepage bundle would carry it unused.
export function onlyImages(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["span", "img"],
    ALLOWED_ATTR: ["src", "alt", "class", "style"],
    ALLOWED_URI_REGEXP: /^https:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji/,
    ADD_ATTR: ["style"],
  });
}

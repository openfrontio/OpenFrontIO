/**
 * Directly sets the document title.
 * The caller is responsible for string concatenation and localization if needed.
 */
export function setTitle(title: string): void {
  document.title = title;
}

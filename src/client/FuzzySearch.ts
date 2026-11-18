/**
 * Fuzzy matches a pattern against a string.
 * Returns true if:
 * 1. Pattern is empty
 * 2. Pattern is a substring of text (case-insensitive)
 * 3. All characters of pattern appear in order in text (case-insensitive)
 */
export function fuzzyMatch(pattern: string, text: string): boolean {
  const p = pattern.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!p) return true;
  if (t.includes(p)) return true;
  let pIdx = 0;
  for (let i = 0; i < t.length && pIdx < p.length; i++) {
    if (t[i] === p[pIdx]) {
      pIdx++;
    }
  }
  return pIdx === p.length;
}

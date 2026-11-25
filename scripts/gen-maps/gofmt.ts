// Go-compatible formatting helpers: strconv.Quote (fmt's %q) and
// encoding/json's map marshalling (sorted keys, Go's string escaping), from
// when the generator was written in Go, so its output stays the same.

const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]$/u;

/** Go's strconv.Quote. */
export function goQuote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"' || ch === "\\") out += "\\" + ch;
    else if (cp < 0x80 && cp >= 0x20 && cp !== 0x7f) out += ch;
    else if (cp >= 0x80 && PRINTABLE.test(ch)) out += ch;
    else {
      const esc: Record<string, string> = {
        "\x07": "\\a",
        "\b": "\\b",
        "\f": "\\f",
        "\n": "\\n",
        "\r": "\\r",
        "\t": "\\t",
        "\v": "\\v",
      };
      if (esc[ch]) out += esc[ch];
      else if (cp < 0x80) out += "\\x" + cp.toString(16).padStart(2, "0");
      else if (cp < 0x10000) out += "\\u" + cp.toString(16).padStart(4, "0");
      else out += "\\U" + cp.toString(16).padStart(8, "0");
    }
  }
  return out + '"';
}

function jsonString(s: string, escapeHTML: boolean): string {
  let out = JSON.stringify(s)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  if (escapeHTML)
    out = out
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");
  return out;
}

/**
 * json.MarshalIndent(v, "", indent) for values decoded into interface{}:
 * object keys sorted at every level. No trailing newline (add one for
 * json.Encoder output).
 */
export function goJSON(
  v: unknown,
  indent: string,
  escapeHTML: boolean,
  prefix = "",
): string {
  if (v === null) return "null";
  if (typeof v === "string") return jsonString(v, escapeHTML);
  if (typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  const inner = prefix + indent;
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((e) => inner + goJSON(e, indent, escapeHTML, inner)).join(",\n")}\n${prefix}]`;
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (keys.length === 0) return "{}";
  const body = keys.map(
    (k) =>
      `${inner}${jsonString(k, escapeHTML)}: ${goJSON(obj[k], indent, escapeHTML, inner)}`,
  );
  return `{\n${body.join(",\n")}\n${prefix}}`;
}

/** strconv.FormatFloat(f, 'f', -1, 64): shortest round-trip digits, never an exponent. */
export function formatFloatF(f: number): string {
  if (Object.is(f, -0)) return "-0";
  const s = String(f);
  if (!s.includes("e")) return s;
  const neg = f < 0;
  const [mant, expStr] = (neg ? s.slice(1) : s).split("e");
  const exp = Number(expStr);
  const [intPart, frac = ""] = mant.split(".");
  const digits = intPart + frac;
  const point = intPart.length + exp;
  let out: string;
  if (point <= 0) out = "0." + "0".repeat(-point) + digits;
  else if (point >= digits.length)
    out = digits + "0".repeat(point - digits.length);
  else out = digits.slice(0, point) + "." + digits.slice(point);
  return (neg ? "-" : "") + out;
}

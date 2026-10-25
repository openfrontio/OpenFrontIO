import fs from "fs";
import IntlMessageFormat from "intl-messageformat";
import {
  type CallExpression,
  type Expression,
  type Node,
  type ObjectProperty,
  type PropertyKey,
  type StringLiteral,
  type TemplateLiteral,
} from "oxc-parser";
import path from "path";
import { forEachChild, isStringLiteral, parseSource } from "./util/sourceAst";

const PROJECT_ROOT = path.join(__dirname, "..");
const LANGUAGE_DIR = path.join(PROJECT_ROOT, "resources", "lang");
const FLAG_DIR = path.join(PROJECT_ROOT, "resources", "flags");
const METADATA_FILE = path.join(LANGUAGE_DIR, "metadata.json");

/**
 * Regex patterns for keys that are intentionally generated dynamically.
 * This keeps dynamic handling explicit and reviewable.
 */
const DYNAMIC_KEY_PATTERNS: RegExp[] = [
  /^difficulty\.[^.]+$/,
  /^map\.[^.]+$/,
  /^map_categories\.[^.]+$/,
  /^chat\.[^.]+\.[^.]+$/,
  /^player_stats_table\.unit\.[^.]+$/,
  /^host_modal\.teams_.+$/,
  /^public_lobby\.teams_.+$/,
  /^team_colors\.[^.]+$/,
  /^territory_patterns\.pattern\.[^.]+$/,
  /^territory_patterns\.pattern_owned\.[^.]+$/,
  /^territory_patterns\.color_palette\.[^.]+$/,
  /^build_menu\.desc\.[^.]+$/,
  /^unit_type\.[^.]+$/,
  /^news_box\.(tournament|tutorial|news|warning|firefox_warning)$/,
  // Built-in graphics preset names/descriptions are referenced from
  // src/client/render/gl/graphics-presets.json, not translateText literals.
  /^graphics_setting\.preset_(default|night|evans_pick|colorblind)(_desc)?$/,
];

/**
 * Keys that are intentionally not expected to be used via translateText.
 */
const IGNORED_UNUSED_KEY_PATTERNS: RegExp[] = [
  /^lang\./, // language metadata, not a UI translation key
  // Steam rich presence status frames. Never rendered by the client, so there
  // is no translateText() call to find: the Electron shell reads them out of
  // resources/lang/*.json at build time and writes them into the localization
  // file Steam resolves against, in the *viewing* friend's language rather
  // than the player's. They live here so Crowdin picks them up like any other
  // string.
  /^desktop_presence\./,
  // The Electron shell's account-linking gate. Same situation as the rich
  // presence frames above, and for the same reason: the gate is a page the
  // shell serves from its OWN assets before the client boots, so there is no
  // translateText() call in this repo to find. The shell's build reads these
  // out of resources/lang/*.json and emits per-language files next to that
  // page. They live here so Crowdin picks them up like any other string.
  /^desktop_gate\./,
];

type NestedTranslations = Record<string, unknown>;

type ParsedTranslationFile = {
  file: string;
  flatMessages: Record<string, string>;
};

type ScanResult = {
  usedKeys: Set<string>;
  referencedStaticKeys: Set<string>;
  dynamicPrefixes: Set<string>;
};

/** A template literal without substitutions. */
type PlainTemplateLiteral = TemplateLiteral & { expressions: [] };

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function flattenTranslations(
  obj: NestedTranslations,
  file: string,
  parentKey = "",
  result: Record<string, string> = {},
  errors: string[] = [],
): Record<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    if (typeof value === "string") {
      result[fullKey] = value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenTranslations(
        value as NestedTranslations,
        file,
        fullKey,
        result,
        errors,
      );
      continue;
    }
    errors.push(
      `${file}:${fullKey} has invalid type ${Array.isArray(value) ? "array" : typeof value}`,
    );
  }
  return result;
}

function listLanguageJsonFiles(): string[] {
  return fs
    .readdirSync(LANGUAGE_DIR)
    .filter((file) => file.endsWith(".json") && file !== "metadata.json")
    .sort();
}

function loadTranslationFiles(): {
  files: ParsedTranslationFile[];
  errors: string[];
} {
  const errors: string[] = [];
  const files: ParsedTranslationFile[] = [];

  for (const file of listLanguageJsonFiles()) {
    const fullPath = path.join(LANGUAGE_DIR, file);
    let raw: string;
    try {
      raw = fs.readFileSync(fullPath, "utf-8");
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: failed to read file (${details})`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: invalid JSON (${details})`);
      continue;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push(`${file}: root must be an object`);
      continue;
    }

    files.push({
      file,
      flatMessages: flattenTranslations(
        parsed as NestedTranslations,
        file,
        "",
        {},
        errors,
      ),
    });
  }

  return { files, errors };
}

function getAllFiles(
  dir: string,
  extensions: string[],
  /** Tracks visited real paths to guard against symlink cycles. */
  seen: Set<string> = new Set(),
): string[] {
  const realDir = fs.realpathSync(dir);
  if (seen.has(realDir)) return []; // cycle via directory symlink
  seen.add(realDir);

  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath, extensions, seen));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prefixToRegex(prefix: string): RegExp {
  return new RegExp(`^${escapeRegex(prefix)}.+$`);
}

function isTranslateTextCall(node: CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === "Identifier") {
    return callee.name === "translateText";
  }
  // A computed member expression (`obj["translateText"]`) is not a plain
  // property access, so it does not count.
  if (
    callee.type === "MemberExpression" &&
    callee.computed === false &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name === "translateText";
  }
  return false;
}

function isTemplateLiteral(node: Node): node is PlainTemplateLiteral {
  return node.type === "TemplateLiteral" && node.expressions.length === 0;
}

/**
 * A string literal, or a template literal without substitutions: both stand
 * in for a translation key.
 */
function isStringLiteralLike(
  node: Node,
): node is StringLiteral | PlainTemplateLiteral {
  return isStringLiteral(node) || isTemplateLiteral(node);
}

/** The text of a string literal, or of a template literal without substitutions. */
function stringLiteralText(node: StringLiteral | PlainTemplateLiteral): string {
  if (node.type === "Literal") return node.value;
  return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
}

function getPlusOperands(expr: Expression): Expression[] {
  if (expr.type === "BinaryExpression" && expr.operator === "+") {
    return [...getPlusOperands(expr.left), ...getPlusOperands(expr.right)];
  }
  return [expr];
}

function getStaticStringFromPlus(expr: Expression): string | null {
  const parts = getPlusOperands(expr);
  let value = "";
  for (const part of parts) {
    if (!isStringLiteralLike(part)) return null;
    value += stringLiteralText(part);
  }
  return value;
}

function getDynamicPrefixFromPlus(expr: Expression): string | null {
  const parts = getPlusOperands(expr);
  if (parts.length === 0) return null;
  const first = parts[0];
  if (!isStringLiteralLike(first)) return null;
  if (parts.every((part) => isStringLiteralLike(part))) return null;
  return stringLiteralText(first) || null;
}

function extractDataI18nKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const attrRegex =
    /data-i18n(?:-title|-alt|-aria-label|-placeholder)?\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

function extractTranslationKeyLikeAttrs(content: string): Set<string> {
  const keys = new Set<string>();
  const keyLikeAttrRegex =
    /\b(?:translationKey|labelKey|defaultLabelKey|disabledKey|titleKey|ariaLabelKey|placeholderKey)\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = keyLikeAttrRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

function isPotentialTranslationKey(
  key: string,
  rootKeys: Set<string>,
  enKeySet: Set<string>,
  allowBareRoot = false,
): boolean {
  if (enKeySet.has(key)) return true;
  if (allowBareRoot && rootKeys.has(key)) return true;
  if (!key.includes(".")) return false;
  const root = key.split(".")[0];
  return rootKeys.has(root);
}

function isKeyNamedProperty(name: PropertyKey): boolean {
  if (name.type === "Identifier") return /key$/i.test(name.name);
  if (isStringLiteral(name)) return /key$/i.test(name.value);
  if (isTemplateLiteral(name)) {
    return /key$/i.test(stringLiteralText(name));
  }
  return false;
}

/**
 * A property assignment (`{ key: value }`) whose name ends in "key".
 * Shorthand properties, methods and accessors are separate node kinds and
 * do not count, and a computed name (`{ [key]: value }`) is not a name at
 * all.
 */
function isKeyNamedPropertyAssignment(node: ObjectProperty): boolean {
  if (node.kind !== "init" || node.shorthand || node.method || node.computed) {
    return false;
  }
  return isKeyNamedProperty(node.key);
}

function collectFromExpression(
  expression: Expression,
  result: ScanResult,
  rootKeys: Set<string>,
  enKeySet: Set<string>,
  allowBareRoot = false,
): void {
  if (isStringLiteralLike(expression)) {
    const text = stringLiteralText(expression);
    if (isPotentialTranslationKey(text, rootKeys, enKeySet, allowBareRoot)) {
      result.referencedStaticKeys.add(text);
    }
    return;
  }

  if (expression.type === "TemplateLiteral") {
    const prefix = expression.quasis[0].value.cooked ?? "";
    if (
      prefix.length > 0 &&
      /[._]$/.test(prefix) &&
      isPotentialTranslationKey(prefix, rootKeys, enKeySet)
    ) {
      result.dynamicPrefixes.add(prefix);
    }
    return;
  }

  if (expression.type === "BinaryExpression" && expression.operator === "+") {
    const staticValue = getStaticStringFromPlus(expression);
    if (staticValue !== null) {
      if (isPotentialTranslationKey(staticValue, rootKeys, enKeySet)) {
        result.referencedStaticKeys.add(staticValue);
      }
      return;
    }

    const prefix = getDynamicPrefixFromPlus(expression);
    if (
      prefix !== null &&
      /[._]$/.test(prefix) &&
      isPotentialTranslationKey(prefix, rootKeys, enKeySet)
    ) {
      result.dynamicPrefixes.add(prefix);
    }
    return;
  }

  if (expression.type === "ParenthesizedExpression") {
    collectFromExpression(
      expression.expression,
      result,
      rootKeys,
      enKeySet,
      allowBareRoot,
    );
    return;
  }

  if (expression.type === "ConditionalExpression") {
    collectFromExpression(
      expression.consequent,
      result,
      rootKeys,
      enKeySet,
      allowBareRoot,
    );
    collectFromExpression(
      expression.alternate,
      result,
      rootKeys,
      enKeySet,
      allowBareRoot,
    );
    return;
  }
}

function scanTsFile(
  filePath: string,
  rootKeys: Set<string>,
  enKeySet: Set<string>,
): ScanResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const program = parseSource(filePath, content);

  const result: ScanResult = {
    usedKeys: new Set<string>(),
    referencedStaticKeys: new Set<string>(),
    dynamicPrefixes: new Set<string>(),
  };

  const dataI18nKeys = extractDataI18nKeys(content);
  for (const key of dataI18nKeys) {
    result.referencedStaticKeys.add(key);
  }
  const keyLikeAttrKeys = extractTranslationKeyLikeAttrs(content);
  for (const key of keyLikeAttrKeys) {
    result.referencedStaticKeys.add(key);
  }

  const visit = (node: Node) => {
    // Broad match: any string literal in any .ts/.tsx file that exactly
    // matches an en.json key is counted as "used". This is intentionally
    // permissive to avoid false-positive "unused" reports, but it means a
    // key appearing in an unrelated context (e.g. a log message or object
    // key that happens to share the same name) will mask a genuinely
    // unused translation key.
    if (isStringLiteralLike(node)) {
      const text = stringLiteralText(node);
      if (enKeySet.has(text)) {
        result.usedKeys.add(text);
      }
    }

    if (node.type === "CallExpression" && isTranslateTextCall(node)) {
      const firstArg = node.arguments[0];
      if (firstArg !== undefined && firstArg.type !== "SpreadElement") {
        collectFromExpression(firstArg, result, rootKeys, enKeySet, true);
      }
    }

    // Property assignments are read off the object literal they belong to:
    // the AST also uses the "Property" type for destructuring targets, which
    // are not property assignments.
    if (node.type === "ObjectExpression") {
      for (const property of node.properties) {
        if (
          property.type === "Property" &&
          isKeyNamedPropertyAssignment(property)
        ) {
          collectFromExpression(property.value, result, rootKeys, enKeySet);
        }
      }
    }

    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      /key$/i.test(node.id.name) &&
      node.init !== null &&
      node.init !== undefined
    ) {
      collectFromExpression(node.init, result, rootKeys, enKeySet);
    }

    forEachChild(node, visit);
  };

  visit(program);

  for (const key of dataI18nKeys) {
    if (enKeySet.has(key)) {
      result.usedKeys.add(key);
    }
  }
  for (const key of keyLikeAttrKeys) {
    if (enKeySet.has(key)) {
      result.usedKeys.add(key);
    }
  }

  return result;
}

describe("Translation System", () => {
  test("metadata languages point to existing lang json and flag files", () => {
    if (!fs.existsSync(METADATA_FILE)) {
      console.log(
        "No resources/lang/metadata.json file found. Skipping check.",
      );
      return;
    }

    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, "utf-8"));
    if (!Array.isArray(metadata) || metadata.length === 0) {
      console.log(
        "No language entries found in metadata.json. Skipping check.",
      );
      return;
    }

    const knownLanguageFiles = new Set(listLanguageJsonFiles());
    const errors: string[] = [];

    for (const entry of metadata) {
      const code = entry?.code;
      const svg = entry?.svg;

      if (typeof code !== "string" || code.length === 0) {
        errors.push(
          `metadata entry missing valid code: ${JSON.stringify(entry)}`,
        );
        continue;
      }

      if (typeof svg !== "string" || svg.length === 0) {
        errors.push(
          `[${code}]: metadata svg is missing or not a non-empty string`,
        );
        continue;
      }

      if (!knownLanguageFiles.has(`${code}.json`)) {
        errors.push(`[${code}]: lang json file does not exist: ${code}.json`);
      }

      const svgFile = svg.endsWith(".svg") ? svg : `${svg}.svg`;
      const flagPath = path.join(FLAG_DIR, svgFile);
      if (!fs.existsSync(flagPath)) {
        errors.push(`[${code}]: SVG file does not exist: ${svgFile}`);
      }
    }

    if (errors.length > 0) {
      console.error(
        "Metadata lang or SVG file check failed:\n" + errors.join("\n"),
      );
    }
    expect(errors).toEqual([]);
  });

  test("all translation strings are valid ICU messages", () => {
    const { files, errors } = loadTranslationFiles();

    for (const { file, flatMessages } of files) {
      for (const [key, message] of Object.entries(flatMessages)) {
        try {
          new IntlMessageFormat(message, "en");
        } catch (error) {
          const details =
            error instanceof Error ? error.message : String(error);
          errors.push(`${file}:${key} has invalid ICU syntax (${details})`);
        }
      }
    }

    if (errors.length > 0) {
      console.error("ICU translation validation failed:\n" + errors.join("\n"));
    }
    expect(errors).toEqual([]);
  });

  test("en.json keys stay in sync with source usage", () => {
    const enJsonPath = path.join(LANGUAGE_DIR, "en.json");
    const enJson = JSON.parse(fs.readFileSync(enJsonPath, "utf-8"));
    const allKeys = flattenKeys(enJson);
    const enKeySet = new Set(allKeys);
    const rootKeys = new Set(Object.keys(enJson as Record<string, unknown>));

    // The engine packages emit message keys too.
    const sourceFiles = ["src", "packages"].flatMap((dir) =>
      getAllFiles(path.join(PROJECT_ROOT, dir), [".ts", ".tsx", ".js", ".jsx"]),
    );

    const usedKeys = new Set<string>();
    const referencedStaticKeys = new Set<string>();
    const dynamicPrefixes = new Set<string>();

    for (const file of sourceFiles) {
      const scan = scanTsFile(file, rootKeys, enKeySet);
      for (const key of scan.usedKeys) usedKeys.add(key);
      for (const key of scan.referencedStaticKeys) {
        referencedStaticKeys.add(key);
      }
      for (const prefix of scan.dynamicPrefixes) dynamicPrefixes.add(prefix);
    }

    const indexHtmlPath = path.join(PROJECT_ROOT, "index.html");
    if (fs.existsSync(indexHtmlPath)) {
      const htmlContent = fs.readFileSync(indexHtmlPath, "utf-8");
      const htmlDataI18nKeys = extractDataI18nKeys(htmlContent);
      for (const key of htmlDataI18nKeys) {
        referencedStaticKeys.add(key);
        if (enKeySet.has(key)) {
          usedKeys.add(key);
        }
      }
    }

    const derivedDynamicPatterns = Array.from(dynamicPrefixes)
      .sort()
      .map((prefix) => prefixToRegex(prefix));
    const dynamicKeyPatterns = [
      ...DYNAMIC_KEY_PATTERNS,
      ...derivedDynamicPatterns,
    ];

    const unusedKeys: string[] = [];
    const dynamicKeys: string[] = [];
    const missingKeys: string[] = [];

    // NOTE: The isPotentialTranslationKey check below intentionally skips any
    // referenced key whose root namespace (the part before the first ".") is
    // not already present in en.json's rootKeys. This means keys under entirely
    // new namespaces (e.g. "brand_new_namespace.some_key") will NOT be reported
    // as missing. This trade-off was chosen to reduce false-positive noise from
    // string literals that look like translation keys but aren't (config keys,
    // CSS classes, etc.). It is a known limitation: if a real translation key
    // is added under a brand-new namespace and no en.json entry exists yet,
    // this test will not catch it.
    for (const key of Array.from(referencedStaticKeys).sort()) {
      if (enKeySet.has(key)) continue;
      if (!isPotentialTranslationKey(key, rootKeys, enKeySet)) continue;
      missingKeys.push(key);
    }

    for (const key of allKeys) {
      if (usedKeys.has(key)) continue;
      if (IGNORED_UNUSED_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        continue;
      }

      const isDynamic = dynamicKeyPatterns.some((pattern) => pattern.test(key));
      if (isDynamic) {
        dynamicKeys.push(key);
      } else {
        unusedKeys.push(key);
      }
    }

    const hasFailing = missingKeys.length > 0 || unusedKeys.length > 0;
    if (hasFailing) {
      if (derivedDynamicPatterns.length > 0) {
        console.log(
          `\nDerived dynamic patterns (${derivedDynamicPatterns.length}):\n` +
            derivedDynamicPatterns.map((p) => `  ${p.source}`).join("\n"),
        );
      }

      if (dynamicKeys.length > 0) {
        console.log(
          `\nDynamically referenced keys (${dynamicKeys.length}) - verify manually:\n` +
            dynamicKeys.map((k) => `  ${k}`).join("\n"),
        );
      }

      if (missingKeys.length > 0) {
        console.error(
          `\nMissing translation keys in en.json (${missingKeys.length}):\n` +
            missingKeys.map((k) => `  ${k}`).join("\n"),
        );
      }

      if (unusedKeys.length > 0) {
        console.error(
          `\nUnused translation keys (${unusedKeys.length}):\n` +
            unusedKeys.map((k) => `  ${k}`).join("\n"),
        );
      }
    }

    expect(missingKeys).toEqual([]);
    expect(unusedKeys).toEqual([]);
    // 60s, raised from the 30s added in #3861 (May 2026). This is starvation
    // headroom, not a budget. Measured over 566 source files (5.0MB): ~1.1s
    // locally with oxc-parser, and ~1.3s under the v8 coverage CI actually
    // runs (`npm run test:coverage`, ci.yml:47). What exhausted the old 30s
    // on 1 Sept 2026 was >12x starvation from concurrent suites on one
    // machine, which no speedup of this size survives. A timeout here reads
    // exactly like the i18n regression this test exists to catch, and costs
    // an investigation every time, so the margin is deliberately generous.
  }, 60000);
});

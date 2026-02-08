import fs from "fs";
import path from "path";
import ts from "typescript";

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
];

/**
 * Keys that are intentionally not expected to be used via translateText.
 */
const IGNORED_UNUSED_KEY_PATTERNS: RegExp[] = [
  /^lang\./, // language metadata, not a UI translation key
];

type ScanResult = {
  usedKeys: Set<string>;
  referencedStaticKeys: Set<string>;
  dynamicPrefixes: Set<string>;
};

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

function isTranslateTextCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === "translateText";
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text === "translateText";
  }
  return false;
}

function isStringLiteralLike(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function getPlusOperands(expr: ts.Expression): ts.Expression[] {
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return [...getPlusOperands(expr.left), ...getPlusOperands(expr.right)];
  }
  return [expr];
}

function getStaticStringFromPlus(expr: ts.Expression): string | null {
  const parts = getPlusOperands(expr);
  let value = "";
  for (const part of parts) {
    if (!isStringLiteralLike(part)) return null;
    value += part.text;
  }
  return value;
}

function getDynamicPrefixFromPlus(expr: ts.Expression): string | null {
  const parts = getPlusOperands(expr);
  if (parts.length === 0) return null;
  const first = parts[0];
  if (!isStringLiteralLike(first)) return null;
  if (parts.every((part) => isStringLiteralLike(part))) return null;
  return first.text || null;
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
    /\b(?:translationKey|labelKey|disabledKey|titleKey|ariaLabelKey|placeholderKey)\s*=\s*["']([^"']+)["']/g;
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

function isKeyNamedProperty(name: ts.PropertyName): boolean {
  if (ts.isIdentifier(name)) return /key$/i.test(name.text);
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return /key$/i.test(name.text);
  }
  return false;
}

function collectFromExpression(
  expression: ts.Expression,
  result: ScanResult,
  rootKeys: Set<string>,
  enKeySet: Set<string>,
  allowBareRoot = false,
): void {
  if (isStringLiteralLike(expression)) {
    if (
      isPotentialTranslationKey(
        expression.text,
        rootKeys,
        enKeySet,
        allowBareRoot,
      )
    ) {
      result.referencedStaticKeys.add(expression.text);
    }
    return;
  }

  if (ts.isTemplateExpression(expression)) {
    const prefix = expression.head.text;
    if (
      prefix.length > 0 &&
      /[._]$/.test(prefix) &&
      isPotentialTranslationKey(prefix, rootKeys, enKeySet)
    ) {
      result.dynamicPrefixes.add(prefix);
    }
    return;
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
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

  if (ts.isParenthesizedExpression(expression)) {
    collectFromExpression(
      expression.expression,
      result,
      rootKeys,
      enKeySet,
      allowBareRoot,
    );
    return;
  }

  if (ts.isConditionalExpression(expression)) {
    collectFromExpression(
      expression.whenTrue,
      result,
      rootKeys,
      enKeySet,
      allowBareRoot,
    );
    collectFromExpression(
      expression.whenFalse,
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
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

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

  const visit = (node: ts.Node) => {
    // Broad match: any string literal in any .ts/.tsx file that exactly
    // matches an en.json key is counted as "used". This is intentionally
    // permissive to avoid false-positive "unused" reports, but it means a
    // key appearing in an unrelated context (e.g. a log message or object
    // key that happens to share the same name) will mask a genuinely
    // unused translation key.
    if (isStringLiteralLike(node) && enKeySet.has(node.text)) {
      result.usedKeys.add(node.text);
    }

    if (ts.isCallExpression(node) && isTranslateTextCall(node)) {
      const firstArg = node.arguments[0];
      if (firstArg !== undefined) {
        collectFromExpression(firstArg, result, rootKeys, enKeySet, true);
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      isKeyNamedProperty(node.name) &&
      ts.isExpression(node.initializer)
    ) {
      collectFromExpression(node.initializer, result, rootKeys, enKeySet);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /key$/i.test(node.name.text) &&
      node.initializer !== undefined
    ) {
      collectFromExpression(node.initializer, result, rootKeys, enKeySet);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

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

describe("Unused Translation Keys", () => {
  test("en.json keys stay in sync with source usage", () => {
    const enJsonPath = path.join(__dirname, "../resources/lang/en.json");
    const enJson = JSON.parse(fs.readFileSync(enJsonPath, "utf-8"));
    const allKeys = flattenKeys(enJson);
    const enKeySet = new Set(allKeys);
    const rootKeys = new Set(Object.keys(enJson as Record<string, unknown>));

    const srcDir = path.join(__dirname, "../src");
    const sourceFiles = getAllFiles(srcDir, [".ts", ".tsx", ".js", ".jsx"]);

    const usedKeys = new Set<string>();
    const referencedStaticKeys = new Set<string>();
    const dynamicPrefixes = new Set<string>();

    for (const file of sourceFiles) {
      const scan = scanTsFile(file, rootKeys, enKeySet);
      for (const key of scan.usedKeys) usedKeys.add(key);
      for (const key of scan.referencedStaticKeys)
        referencedStaticKeys.add(key);
      for (const prefix of scan.dynamicPrefixes) dynamicPrefixes.add(prefix);
    }

    const indexHtmlPath = path.join(__dirname, "../index.html");
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
  });
});

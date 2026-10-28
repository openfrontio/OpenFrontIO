/**
 * Reading the repository's own source with the oxc parser.
 *
 * The oxc parser is a standalone TypeScript-aware parser: it needs no
 * TypeScript compiler, so the tests that scan the source tree keep working
 * with TypeScript 7, which ships no compiler API.
 */
import {
  parseSync,
  visitorKeys,
  type Node,
  type Program,
  type StringLiteral,
} from "oxc-parser";

/** Every literal node shares the type "Literal"; the value tells them apart. */
type AnyLiteral = Extract<Node, { type: "Literal" }>;

/**
 * Parses a TypeScript source file. The language follows the file extension.
 */
export function parseSource(fileName: string, text: string): Program {
  const { program, errors } = parseSync(fileName, text, {
    lang: fileName.endsWith(".tsx") ? "tsx" : "ts",
    sourceType: "unambiguous",
  });
  if (errors.length > 0) {
    throw new Error(`${fileName}: ${errors[0].message}`);
  }
  return program;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Visits the child nodes of a node, in the order the oxc AST lists them. */
export function forEachChild(node: Node, visit: (child: Node) => void): void {
  const keys = visitorKeys[node.type];
  if (keys === undefined) return;
  const record = node as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) visit(item);
      }
    } else if (isNode(value)) {
      visit(value);
    }
  }
}

/** Whether a node is a string literal, and not another kind of literal. */
export function isStringLiteral(node: Node): node is StringLiteral {
  return (
    node.type === "Literal" && typeof (node as AnyLiteral).value === "string"
  );
}

import { includeIgnoreFile } from "@eslint/compat";
import pluginJs from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

/** @type {import('eslint').Linter.Config[]} */
export default [
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      "src/server/gatekeeper/**",
      "tests/pathfinding/playground/**",
      ".claude/**",
    ],
  },
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "__mocks__/fileMock.js",
            "eslint.config.js",
            "scripts/sync-assets.mjs",
            "tests/matchmaking/*.mjs",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Disable rules that would fail. The failures should be fixed, and the entries here removed.
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
    },
  },
  {
    // The simulation must be bit-identical on every client. Math.exp & co.
    // are only "implementation approximated" by the spec; use DetMath.
    files: ["src/core/**/*.ts"],
    ignores: ["src/core/DetMath.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...[
          "exp",
          "expm1",
          "log",
          "log1p",
          "log2",
          "log10",
          "pow",
          "sin",
          "cos",
          "tan",
          "asin",
          "acos",
          "atan",
          "atan2",
          "sinh",
          "cosh",
          "tanh",
          "cbrt",
          "hypot",
        ].map((property) => ({
          object: "Math",
          property,
          message: `Math.${property} differs between JS engines; use src/core/DetMath.ts to keep the simulation deterministic.`,
        })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator='**']:not([right.type='Literal'][right.value=2])",
          message:
            "`**` with a non-2 exponent differs between JS engines; use src/core/DetMath.ts to keep the simulation deterministic.",
        },
      ],
    },
  },
  {
    rules: {
      // Enable rules
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      eqeqeq: "error",
      "no-case-declarations": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          caughtErrors: "none",
        },
      ],
    },
  },
];

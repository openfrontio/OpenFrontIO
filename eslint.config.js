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
  { ignores: ["src/server/gatekeeper/**"] },
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
            "jest.config.ts",
            "postcss.config.js",
            "tailwind.config.js",
            "webpack.config.js",
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
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-case-declarations": "off",
    },
  },
  {
    rules: {
      // Enable rules
      "@typescript-eslint/consistent-type-definitions": [
        "error",
        "type",
        // TODO: { assertionStyle: "never" }, https://github.com/openfrontio/OpenFrontIO/issues/1033
      ],
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-inferrable-types": "error",
      "@typescript-eslint/no-mixed-enums": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/prefer-function-type": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-literal-enum-member": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      eqeqeq: "error",
      "sort-keys": "error",
    },
  },
  {
    files: [
      "**/*.config.{js,ts,jsx,tsx}",
      "**/*.test.{js,ts,jsx,tsx}",
      "src/client/**/*.{js,ts,jsx,tsx}",
    ],
    rules: {
      "sort-keys": "off",
    },
  },
];

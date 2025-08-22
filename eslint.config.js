import eslintConfigPrettier from "eslint-config-prettier/flat";
import eslintPluginLocal from "./eslint-plugin-local/plugin.js";
import { fileURLToPath } from "node:url";
import globals from "globals";
import { includeIgnoreFile } from "@eslint/compat";
import jest from "eslint-plugin-jest";
import path from "node:path";
import pluginJs from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
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
            "eslint-plugin-local/plugin.js",
            "eslint-plugin-local/rules/no-z-array.js",
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
      "@typescript-eslint/no-unused-expressions": "off", // https://github.com/openfrontio/OpenFrontIO/issues/1790
      "no-case-declarations": "off", // https://github.com/openfrontio/OpenFrontIO/issues/1791
    },
  },
  {
    plugins: {
      "@stylistic": stylistic,
    },
    rules: {
      // Enable rules
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
      "@stylistic/indent": ["error", 2],
      "@stylistic/semi": "error",
      "@stylistic/space-infix-ops": "error",
      "@stylistic/type-annotation-spacing": [
        "error",
        {
          after: true,
          before: true,
          overrides: {
            colon: {
              before: false,
            },
          },
        },
      ],
      "@stylistic/eol-last": "error",
      "@typescript-eslint/consistent-type-definitions": [
        "error",
        "type",
      ],
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-inferrable-types": "error",
      "@typescript-eslint/no-mixed-enums": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/prefer-function-type": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-literal-enum-member": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "eqeqeq": "error",
      "indent": "off", // @stylistic/indent
      "sort-keys": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      // "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }], // TODO: Enable this rule, https://github.com/openfrontio/OpenFrontIO/issues/1784
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/prefer-for-of": "error",
      "array-bracket-newline": ["error", "consistent"],
      "array-bracket-spacing": ["error", "never"],
      "array-element-newline": ["error", "consistent"],
      "arrow-parens": ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "comma-spacing": ["error", { before: false, after: true }],
      "func-call-spacing": ["error", "never"],
      "function-call-argument-newline": ["error", "consistent"],
      "max-depth": ["error", { max: 5 }],
      "max-len": ["error", { code: 120 }],
      "max-lines": ["error", { max: 676, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 561 }],
      "no-loss-of-precision": "error",
      "no-multi-spaces": "error",
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
      "no-trailing-spaces": "error",
      "object-curly-newline": ["error", { multiline: true, consistent: true }],
      "object-curly-spacing": ["error", "always"],
      "object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],
      "object-shorthand": ["error", "always"],
      "no-undef": "error",
      "no-unused-vars": "off", // @typescript-eslint/no-unused-vars
      "prefer-destructuring": ["error", {
        array: false,
        object: true,
      }],
      "quote-props": ["error", "consistent-as-needed"],
      "space-before-blocks": ["error", "always"],
      "space-before-function-paren": ["error", {
        anonymous: "always",
        named: "never",
        asyncArrow: "always",
      }],
      "space-infix-ops": "off",
    },
  },
  {
    files: [
      "**/*.config.{js,ts,jsx,tsx}",
      "**/*.test.{js,ts,jsx,tsx}",
      "tests/**/*.{js,ts,jsx,tsx}",
      "eslint-plugin-local/**/*.{js,ts,jsx,tsx}",
    ],
    rules: {
      // Disabled rules for tests, configs
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "max-len": "off",
      "sort-keys": "off",
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    files: [
      "**/*.test.{js,ts,jsx,tsx}",
      "tests/**/*.{js,ts,jsx,tsx}",
    ],
    plugins: ["jest"],
    ...jest.configs["flat/style"],
  },
  {
    files: [
      "src/client/**/*.{js,ts,jsx,tsx}",
    ],
    rules: {
      // Disabled rules for frontend
      "sort-keys": "off",
    },
  },
  {
    plugins: {
      local: eslintPluginLocal,
    },
    rules: {
      "local/no-z-array": "error",
    },
  },
];

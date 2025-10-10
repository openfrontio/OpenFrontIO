export default {
  testEnvironment: "node",
  testRegex: "/tests/.*\\.(test|spec)?\\.(ts|tsx)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
      "<rootDir>/__mocks__/fileMock.js",
    "\\.(css|less)$": "<rootDir>/__mocks__/fileMock.js",
    "^../../wasm/pathfinding/pkg$": "<rootDir>/static/js/pathfinding",
  },
  transform: {
    "^.+\\.tsx?$": ["@swc/jest"],
    // Add a transform rule for pathfinding.js
    "^.+\\.js$": ["@swc/jest"], // This will transform all .js files, including pathfinding.js
  },
  transformIgnorePatterns: ["node_modules/(?!(node:)/)"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  coverageThreshold: {
    global: {
      statements: 21.5,
      branches: 16,
      lines: 21.0,
      functions: 20.5,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
};

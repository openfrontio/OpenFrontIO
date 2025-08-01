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
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          target: "ES2020",
          module: "es2022",
          moduleResolution: "node",
          experimentalDecorators: true,
          types: ["jest", "node"],
        },
      },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!(node:)/)"],
  preset: "ts-jest/presets/default-esm",
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  coverageThreshold: {
    global: {
      statements: 22.0,
      branches: 17.0,
      lines: 22.5,
      functions: 21.0,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
};

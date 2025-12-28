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
    "^.+\\.tsx?$": ["@swc/jest"],
    "^.+\\.mjs$": ["@swc/jest"],
    "^.+\\.js$": ["@swc/jest"],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(nanoid|@jsep|fastpriorityqueue|@datastructures-js|jose|lit.*|@lit)/)",
  ],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  coverageThreshold: {
    global: {
      statements: 21,
      branches: 16,
      lines: 21.0,
      functions: 20.5,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
};

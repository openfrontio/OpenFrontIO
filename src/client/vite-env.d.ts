/// <reference types="vite/client" />

// Percent of en.json each language translates, keyed by code (vite.config.ts).
declare const __LANG_COVERAGE__: Record<string, number>;

declare module "*.bin" {
  const binContent: string;
  export default binContent;
}

declare module "*.md" {
  const mdContent: string;
  export default mdContent;
}

declare module "*.html" {
  const htmlContent: string;
  export default htmlContent;
}

declare module "*.xml" {
  const xmlContent: string;
  export default xmlContent;
}

declare module "*.txt" {
  const txtContent: string;
  export default txtContent;
}

declare module "*.txt?raw" {
  const txtRawContent: string;
  export default txtRawContent;
}

declare module "*.webp" {
  const webpContent: string;
  export default webpContent;
}

/// <reference types="vite/client" />

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

// keyboard API is 'Expirimental' even if 8 years old because only supported in Chromium
// but we want to use it without having to cast 'as any', so define it here.
// https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API
interface Navigator {
  keyboard?: {
    getLayoutMap(): Promise<Map<string, string>>;
  };
}

/// <reference types="vite/client" />

declare module "*.bin" {
  const binContent: string;
  export default binContent;
}

declare module "*.md" {
  const mdContent: string;
  export default mdContent;
}

declare module "*.md?url" {
  const mdUrl: string;
  export default mdUrl;
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

declare module "*.svg?url" {
  const svgUrl: string;
  export default svgUrl;
}

declare module "*.wgsl?raw" {
  const content: string;
  export default content;
}

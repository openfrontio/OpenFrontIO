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

declare module "*.webp" {
  const webpContent: string;
  export default webpContent;
}

declare module "*.png" {
  const content: string;
  export default content;
}
declare module "*.jpg" {
  const value: string;
  export default value;
}

declare module "*.webp" {
  const value: string;
  export default value;
}

declare module "*.jpeg" {
  const value: string;
  export default value;
}
declare module "*.svg" {
  const value: string;
  export default value;
}
declare module "*.bin" {
  const value: string;
  export default value;
}
declare module "*.md" {
  const value: string;
  export default value;
}
declare module "*.txt" {
  const value: string;
  export default value;
}
declare module "*.html" {
  const content: string;
  export default content;
}
declare module "*.xml" {
  const value: string;
  export default value;
}

declare namespace NodeJS {
  interface ProcessEnv {
    readonly VITE_WALLETCONNECT_PROJECT_ID: string
    readonly VITE_PRIVY_APP_ID: string
    readonly VITE_PRIVY_CLIENT_ID: string
  }
}

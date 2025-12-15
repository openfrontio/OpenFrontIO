import type { EventBus } from "./core/EventBus";

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

declare module "*.mp3" {
  const value: string;
  export default value;
}

declare global {
  interface Window {
    __eventBus?: EventBus;
    __username?: string;
  }
}

import type { EventBus } from "../core/EventBus";

declare global {
  interface Window {
    __eventBus?: EventBus;
    __username?: string;
  }
}

export {};

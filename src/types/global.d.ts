declare global {
  interface Window {
    showPage?: (pageId: string) => void;
  }
}

export {};

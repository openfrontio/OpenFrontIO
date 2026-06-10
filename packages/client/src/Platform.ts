export const Platform = (() => {
  const isBrowser =
    typeof window !== "undefined" && typeof navigator !== "undefined";

  const normalizePlatform = (platform: string): string => {
    const normalized = platform.toLowerCase();
    if (normalized.includes("windows")) return "Windows";
    if (
      normalized.includes("iphone") ||
      normalized.includes("ipad") ||
      normalized.includes("ipod") ||
      normalized.includes("ios")
    ) {
      return "iOS";
    }
    if (
      normalized.includes("mac") ||
      normalized.includes("macintosh") ||
      normalized.includes("macos")
    ) {
      return "macOS";
    }
    if (normalized.includes("android")) return "Android";
    if (normalized.includes("chrome os")) return "Linux";
    if (normalized.includes("linux")) return "Linux";
    return "Unknown";
  };

  // OS Extraction
  const extractOS = (): string => {
    if (!isBrowser) return "Unknown";

    const uaData = (navigator as any).userAgentData;
    if (uaData?.platform) {
      return normalizePlatform(uaData.platform);
    }

    const ua = navigator.userAgent;
    if (/windows nt/i.test(ua)) return "Windows";
    if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
    if (
      /mac os x/i.test(ua) &&
      ((navigator.maxTouchPoints ?? 0) > 1 || /ipad/i.test(ua))
    ) {
      return "iOS";
    }
    if (/mac os x/i.test(ua)) return "macOS";
    if (/android/i.test(ua)) return "Android";
    if (/linux/i.test(ua)) return "Linux";
    return "Unknown";
  };

  const currentOS = extractOS();

  // Environment Extraction
  const performElectronCheck = (): boolean => {
    // Renderer process
    if (
      typeof window !== "undefined" &&
      typeof (window as any).process === "object" &&
      (window as any).process.type === "renderer"
    ) {
      return true;
    }

    // Main process
    if (
      typeof process !== "undefined" &&
      typeof process.versions === "object" &&
      !!process.versions.electron
    ) {
      return true;
    }

    // Detect the user agent when the `nodeIntegration` option is set to false
    if (
      isBrowser &&
      typeof navigator.userAgent === "string" &&
      navigator.userAgent.indexOf("Electron") >= 0
    ) {
      return true;
    }

    return false;
  };

  const isMac = currentOS === "macOS";

  return {
    os: currentOS,
    isMac,
    isWindows: currentOS === "Windows",
    isIOS: currentOS === "iOS",
    isAndroid: currentOS === "Android",
    isLinux: currentOS === "Linux",
    isElectron: performElectronCheck(),

    get isMobileWidth(): boolean {
      return isBrowser ? window.innerWidth < 768 : false;
    },

    get isTabletWidth(): boolean {
      return isBrowser
        ? window.innerWidth >= 768 && window.innerWidth < 1024
        : false;
    },

    get isDesktopWidth(): boolean {
      return isBrowser ? window.innerWidth >= 1024 : false;
    },
  };
})();

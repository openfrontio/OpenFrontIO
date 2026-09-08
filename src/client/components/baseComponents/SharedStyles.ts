/**
 * Shared constructed stylesheet mirroring the document's global CSS, for
 * shadow-DOM components that want the page's Tailwind styles. Importing
 * styles.css?inline instead would ship the full Tailwind CSS a second time
 * (~160 KB) inside the JS bundle.
 *
 * In production the page stylesheet <link> is fetched (same URL the browser
 * already loaded, so it resolves from HTTP cache); in dev Vite injects
 * <style> tags whose text is read directly and re-read on HMR updates.
 */

let sheet: CSSStyleSheet | null = null;

async function populate(target: CSSStyleSheet): Promise<void> {
  const parts: string[] = [];
  for (const style of Array.from(document.querySelectorAll("style"))) {
    parts.push(style.textContent ?? "");
  }
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  );
  await Promise.all(
    links.map(async (link) => {
      try {
        const response = await fetch(link.href);
        if (response.ok) {
          parts.push(await response.text());
        }
      } catch {
        // Unreachable stylesheet — skip; the component renders unstyled
        // rather than breaking.
      }
    }),
  );
  await target.replace(parts.join("\n"));
}

export function documentStylesSheet(): CSSStyleSheet {
  if (sheet === null) {
    sheet = new CSSStyleSheet();
    void populate(sheet);
    // In dev this module evaluates before Vite injects the page's <style>
    // tags (Main.ts imports the components ahead of styles.css), so the read
    // above sees almost nothing — re-read once the module graph has finished
    // executing (constructed sheets are live, so components pick up the
    // styles without re-rendering). DOMContentLoaded fires right after the
    // deferred module scripts; `load` is not usable here — the header ad's
    // iframes can keep it from ever firing, which left modals unstyled.
    if (document.readyState !== "complete") {
      const populated = sheet;
      document.addEventListener(
        "DOMContentLoaded",
        () => void populate(populated),
        { once: true },
      );
    }
  }
  return sheet;
}

// Keep the copy in sync when Vite hot-replaces CSS in dev.
if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", () => {
    if (sheet !== null) {
      void populate(sheet);
    }
  });
}

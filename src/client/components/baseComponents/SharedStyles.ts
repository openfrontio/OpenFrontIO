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
    // tags, so the read above sees almost nothing — re-read once the page
    // has fully loaded (constructed sheets are live, so components pick up
    // the styles without re-rendering).
    if (document.readyState !== "complete") {
      const populated = sheet;
      window.addEventListener("load", () => void populate(populated), {
        once: true,
      });
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

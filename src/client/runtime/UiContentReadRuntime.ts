import { render as litRender } from "lit";
import { resolveMarkdown } from "lit-markdown";

const DEFAULT_TIMEOUT_MS = 5000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function readLanguageBundle(
  lang: string,
  options?: { timeoutMs?: number },
): Promise<Record<string, unknown> | null> {
  const normalizedLang = lang.trim();
  if (!normalizedLang) {
    return null;
  }

  const response = await fetchWithTimeout(
    `/lang/${encodeURIComponent(normalizedLang)}.json`,
    undefined,
    options?.timeoutMs,
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
}

export async function readTextAsset(
  assetUrl: string,
  options?: { timeoutMs?: number },
): Promise<string | null> {
  if (!assetUrl) {
    return null;
  }

  const response = await fetchWithTimeout(
    assetUrl,
    undefined,
    options?.timeoutMs,
  );
  if (!response.ok) {
    return null;
  }

  return response.text();
}

function preprocessChangelogMarkdown(markdown: string): string {
  return markdown
    .replace(/^([^\-*\s].*?) \*\*(.+?)\*\*$/gm, "## $1 $2")
    .replace(
      /(?<!\()\bhttps:\/\/github\.com\/openfrontio\/OpenFrontIO\/pull\/(\d+)\b/g,
      (_match: string, prNumber: string) =>
        `[#${prNumber}](https://github.com/openfrontio/OpenFrontIO/pull/${prNumber})`,
    )
    .replace(
      /(?<!\()\bhttps:\/\/github\.com\/openfrontio\/OpenFrontIO\/compare\/([\w.-]+)\b/g,
      (_match: string, comparison: string) =>
        `[${comparison}](https://github.com/openfrontio/OpenFrontIO/compare/${comparison})`,
    );
}

function isMarkdownLoadingPlaceholder(renderedHtml: string): boolean {
  const normalized = renderedHtml.replace(/<!---->/g, "").trim();
  return normalized === "" || normalized === "<p>Loading...</p>";
}

async function waitForMarkdownRender(
  tempDiv: HTMLDivElement,
): Promise<string> {
  const maxAttempts = 40; // ~640ms at 16ms intervals
  let renderedHtml = tempDiv.innerHTML.trim();
  let attempts = 0;

  while (isMarkdownLoadingPlaceholder(renderedHtml) && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 16));
    renderedHtml = tempDiv.innerHTML.trim();
    attempts += 1;
  }

  return renderedHtml;
}

export async function renderChangelogAssetHtml(
  assetUrl: string,
): Promise<string> {
  const markdownAsset = await readTextAsset(assetUrl);
  const markdown = preprocessChangelogMarkdown(markdownAsset ?? "Failed to load");

  const tempDiv = document.createElement("div");
  const result = resolveMarkdown(markdown, {
    includeImages: true,
    includeCodeBlockClassNames: true,
  });
  litRender(result, tempDiv);

  let renderedHtml = await waitForMarkdownRender(tempDiv);
  if (isMarkdownLoadingPlaceholder(renderedHtml)) {
    const escaped = markdown
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    renderedHtml = `<pre class="whitespace-pre-wrap text-sm leading-relaxed">${escaped}</pre>`;
  }

  return renderedHtml;
}

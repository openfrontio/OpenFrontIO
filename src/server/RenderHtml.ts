import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";
import { templateRenderContext } from "./RuntimeConfig";

export async function renderHtmlContent(htmlPath: string): Promise<string> {
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  const context = templateRenderContext();
  return ejs.render(htmlContent, {
    gitCommit: JSON.stringify(context.gitCommit),
    instanceId: JSON.stringify(context.instanceId),
  });
}

export function setHtmlNoCacheHeaders(res: Response): void {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("ETag", "");
  res.setHeader("Content-Type", "text/html");
}

export async function renderHtml(
  res: Response,
  htmlPath: string,
): Promise<void> {
  const rendered = await renderHtmlContent(htmlPath);
  setHtmlNoCacheHeaders(res);
  res.send(rendered);
}

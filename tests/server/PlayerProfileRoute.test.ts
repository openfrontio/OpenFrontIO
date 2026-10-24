import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const renderAppShellMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/RenderHtml", () => ({
  renderAppShell: renderAppShellMock,
}));

import { registerPlayerProfileRoute } from "../../src/server/PlayerProfileRoute";
import { stripWorkerPrefix } from "../../src/server/WorkerPathPrefix";

describe("profile link route", () => {
  let server: http.Server;
  let base: string;
  const log = { error: vi.fn() };

  beforeEach(async () => {
    renderAppShellMock.mockReset();
    renderAppShellMock.mockImplementation(
      async (res: express.Response, htmlPath: string) => {
        res.setHeader("Content-Type", "text/html");
        res.send(`<html>shell:${htmlPath.replace(/\\/g, "/")}</html>`);
      },
    );
    log.error.mockReset();
    const app = express();
    // As the worker mounts it: the /w<n> prefix is stripped before routing.
    app.use(stripWorkerPrefix(0));
    registerPlayerProfileRoute({
      app,
      log: log as never,
      baseDir: "/srv/app/dist/server",
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("serves the app shell for a profile path", async () => {
    const res = await fetch(`${base}/player/aB3dE5fX`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("shell:/srv/app/static/index.html");
  });

  test("serves it with a trailing slash, a tab, and the worker prefix", async () => {
    for (const path of [
      "/player/aB3dE5fX/",
      "/player/aB3dE5fX?tab=progression",
      "/w0/player/aB3dE5fX",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain("shell:");
    }
  });

  test("leaves other paths alone", async () => {
    expect((await fetch(`${base}/player`)).status).toBe(404);
    expect((await fetch(`${base}/player/a/b`)).status).toBe(404);
    expect(renderAppShellMock).not.toHaveBeenCalled();
  });

  test("answers 500 when the shell can't be rendered", async () => {
    renderAppShellMock.mockRejectedValue(new Error("missing index.html"));
    const res = await fetch(`${base}/player/aB3dE5fX`);
    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalled();
  });
});

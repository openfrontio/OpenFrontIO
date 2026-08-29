// Serves the lab game viewer: npm run lab:review  →  http://localhost:8787
// Recordings come from lab-out/ (LAB_REC to override), written by tests/lab/playbook.lab.test.ts with RECORD=1.
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REC = process.env.LAB_REC ?? path.join(here, "../../../lab-out");
const PORT = Number(process.env.PORT ?? 8787);

function summary(file) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(REC, file), "utf8"));
    const fin = (d.rows.find((r) => r.includes("FINAL")) ?? "").trim();
    const m = /rank=(\d+) share=([\d.]+).*alive=(\w+) tiles=(\d+)/.exec(fin);
    return m
      ? `${m[3] === "true" ? "rank " + m[1] : "dead"} · ${m[4]} tiles · ${d.frames.length} frames`
      : `${d.frames.length} frames`;
  } catch {
    return "";
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/games") {
      const files = fs.existsSync(REC)
        ? fs
            .readdirSync(REC)
            .filter((f) => f.endsWith(".json"))
            .sort()
        : [];
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          files.map((f) => ({
            file: f,
            name: f.replace(/\.json$/, ""),
            summary: summary(f),
          })),
        ),
      );
      return;
    }
    if (url.pathname.startsWith("/games/")) {
      const f = path.join(REC, path.basename(url.pathname));
      if (!fs.existsSync(f)) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("content-type", "application/json");
      fs.createReadStream(f).pipe(res);
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    fs.createReadStream(path.join(here, "index.html")).pipe(res);
  })
  .listen(PORT, () =>
    console.log(`lab review: http://localhost:${PORT}  (recordings in ${REC})`),
  );

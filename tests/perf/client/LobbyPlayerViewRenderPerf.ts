/**
 * <lobby-player-view> render cost with ~150 clients, with and without level
 * badges.
 *
 * The lobby list re-renders on every lobby_info frame (once a second): each
 * frame decodes into a brand-new ClientInfo[] of brand-new objects, so this
 * times both the first paint and that steady-state "same roster, new objects"
 * update, which is what the player pays every second while waiting.
 *
 * Scenarios (150 clients):
 *   - FFA pills, no badges / every player badged;
 *   - team mode (Players column + team cards), no badges / every player
 *     badged / half badged (the other half get the empty alignment slot);
 *   - and a 1-in-150 change (one player joins) on top of a badged roster.
 *
 * Runs under jsdom, so absolute numbers are jsdom's (no layout or paint) and
 * only the relative cost is meaningful. Reports median / p95 over many runs
 * after a warm-up, two ways: "list" stops at the list's own updateComplete;
 * "drawn" stops once the level badges it staggers onto later animation frames
 * (LevelBadgeFill) are all drawn too, so it includes waiting for those frames
 * (jsdom runs them at 60 fps) and reads as latency rather than work.
 *
 * Usage: npx tsx tests/perf/client/LobbyPlayerViewRenderPerf.ts
 *   (RUNS=n to change the sample count, LOBBY_PERF_SRC=<other checkout>/src
 *   to time another branch's component with the same harness)
 */
import { packLevelBadge } from "@openfront/shared/LevelBadgeWire";
import { readFileSync } from "fs";
// @ts-expect-error -- jsdom ships no types and @types/jsdom is not a dependency
import { JSDOM } from "jsdom";
import { performance } from "perf_hooks";
import { pathToFileURL } from "url";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
// Expose jsdom's window as the global scope, like vitest's jsdom environment:
// every window property Node doesn't already have, plus the few it has its
// own versions of.
const w = dom.window as unknown as Record<string, unknown>;
const OVERRIDE = new Set(["navigator", "localStorage", "sessionStorage"]);
for (const key of Object.getOwnPropertyNames(w)) {
  if (key in globalThis && !OVERRIDE.has(key)) continue;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: w[key],
  });
}
Object.defineProperty(globalThis, "window", { value: globalThis });

const RUNS = Number(process.env.RUNS ?? 100);
const WARMUP = 20;
// Point at another checkout's src/ to compare branches, e.g.
// LOBBY_PERF_SRC=../other-checkout/src
const SRC = process.env.LOBBY_PERF_SRC
  ? pathToFileURL(process.env.LOBBY_PERF_SRC.replace(/\/?$/, "/")).href
  : new URL("../../../src/", import.meta.url).href;

interface Client {
  clientID: string;
  username: string;
  clanTag: string | null;
  verified?: boolean;
  // Packed, as lobby_info carries it (packLevelBadge).
  levelBadge?: number;
}

function roster(n: number, badged: (i: number) => boolean): Client[] {
  return Array.from({ length: n }, (_, i) => {
    const c: Client = {
      clientID: `c${String(i).padStart(7, "0")}`,
      username: `Player${i}`,
      clanTag: i % 3 === 0 ? "CLAN" : null,
    };
    if (i % 4 === 0) c.verified = true;
    if (badged(i)) {
      c.levelBadge = packLevelBadge({
        level: 1 + ((i * 37) % 100),
        prestige: i % 11,
        legend: i === 7,
      });
    }
    return c;
  });
}

// A lobby_info frame decodes to fresh objects every time; the packed badge
// is a plain number, so it passes through unchanged.
const fresh = (clients: Client[]): Client[] => clients.map((c) => ({ ...c }));

function stats(samples: number[]): string {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return `median ${at(0.5).toFixed(3)} ms   p95 ${at(0.95).toFixed(3)} ms`;
}

// The two end points of each sample: the list's update, then its badges.
class Timings {
  list: number[] = [];
  drawn: number[] = [];
  report(): string {
    return `list ${stats(this.list)}   |   drawn ${stats(this.drawn)}`;
  }
}

// translateText() looks the <lang-selector> up once and caches it; without one
// in the page it re-runs document.querySelector on EVERY call, which scans the
// whole lobby list and swamps the timings. The real page always has one, so
// stand one in with the English strings.
function installLangSelector() {
  const flat: Record<string, string> = {};
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") flat[prefix + k] = v;
      else walk(v as Record<string, unknown>, `${prefix}${k}.`);
    }
  };
  walk(
    JSON.parse(
      readFileSync(
        new URL("../../../resources/lang/en.json", import.meta.url),
        "utf8",
      ),
    ),
    "",
  );
  const sel = document.createElement("lang-selector") as HTMLElement & {
    currentLang: string;
    translations: Record<string, string>;
    defaultTranslations: Record<string, string>;
  };
  sel.currentLang = "en";
  sel.translations = flat;
  sel.defaultTranslations = flat;
  document.body.append(sel);
}

async function main() {
  installLangSelector();
  const { GameMode } = await import("@openfront/engine-api/game/GameTypes");
  await import(SRC + "client/components/LobbyPlayerView.ts");
  // Resolves once every staggered badge is drawn. A checkout from before the
  // stagger draws them all in the list's own update, so there it is immediate.
  const badgesDrawn: () => Promise<void> = await import(
    SRC + "client/components/LevelBadgeFill.ts"
  ).then(
    (m: { badgesDrawn: () => Promise<void> }) => m.badgesDrawn,
    () => () => Promise.resolve(),
  );

  type View = HTMLElement & {
    gameMode: unknown;
    clients: Client[];
    currentClientID: string;
    teamCount: unknown;
    updateComplete: Promise<boolean>;
  };

  async function mount(mode: unknown, clients: Client[]): Promise<View> {
    const view = document.createElement("lobby-player-view") as View;
    view.gameMode = mode;
    view.teamCount = 2;
    view.currentClientID = clients[0].clientID;
    view.clients = clients;
    document.body.append(view);
    await view.updateComplete;
    return view;
  }

  async function firstPaint(mode: unknown, clients: Client[]) {
    const t = new Timings();
    for (let i = 0; i < WARMUP + RUNS; i++) {
      const t0 = performance.now();
      const view = await mount(mode, fresh(clients));
      const t1 = performance.now();
      await badgesDrawn();
      const t2 = performance.now();
      view.remove();
      if (i >= WARMUP) {
        t.list.push(t1 - t0);
        t.drawn.push(t2 - t0);
      }
    }
    return t.report();
  }

  // Times the change from roster `a` to roster `b` (the same roster as new
  // objects when `b` is `a`). The view goes back to `a` between samples,
  // untimed, so every sample is that one change and never its reverse.
  async function update(mode: unknown, a: Client[], b: Client[] = a) {
    const view = await mount(mode, fresh(a));
    await badgesDrawn();
    const t = new Timings();
    for (let i = 0; i < WARMUP + RUNS; i++) {
      view.clients = fresh(a);
      await view.updateComplete;
      await badgesDrawn();
      const next = fresh(b);
      const t0 = performance.now();
      view.clients = next;
      await view.updateComplete;
      const t1 = performance.now();
      await badgesDrawn();
      const t2 = performance.now();
      if (i >= WARMUP) {
        t.list.push(t1 - t0);
        t.drawn.push(t2 - t0);
      }
    }
    view.remove();
    return t.report();
  }

  const N = 150;
  const none = roster(N, () => false);
  const all = roster(N, () => true);
  const half = roster(N, (i) => i % 2 === 0);
  const allPlusOne = [...all, ...roster(N + 1, () => true).slice(N)];

  const rows: [string, () => Promise<string>][] = [
    ["FFA  first paint, no badges     ", () => firstPaint(GameMode.FFA, none)],
    ["FFA  first paint, all badged    ", () => firstPaint(GameMode.FFA, all)],
    ["FFA  update,      no badges     ", () => update(GameMode.FFA, none)],
    ["FFA  update,      all badged    ", () => update(GameMode.FFA, all)],
    [
      "FFA  update,      +1 join badged",
      () => update(GameMode.FFA, all, allPlusOne),
    ],
    ["Team first paint, no badges     ", () => firstPaint(GameMode.Team, none)],
    ["Team first paint, all badged    ", () => firstPaint(GameMode.Team, all)],
    ["Team first paint, half (slots)  ", () => firstPaint(GameMode.Team, half)],
    ["Team update,      no badges     ", () => update(GameMode.Team, none)],
    ["Team update,      all badged    ", () => update(GameMode.Team, all)],
    ["Team update,      half (slots)  ", () => update(GameMode.Team, half)],
  ];
  console.log(
    `=== <lobby-player-view>, ${N} clients, jsdom, ${RUNS} runs after ${WARMUP} warm-up ===`,
  );
  // ONLY=<substring> runs just the matching rows (e.g. ONLY="first paint").
  const only = process.env.ONLY;
  for (const [name, run] of rows) {
    if (only !== undefined && !name.includes(only)) continue;
    console.log(`${name}  ${await run()}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

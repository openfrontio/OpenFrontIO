// The map generator's command-line tool: every map in map-generator/assets
// to resources/maps (the terrain itself is engine-lib/mapgen), then
// Maps.gen.ts and en.json from their info.json. See map-generator/README.md.
//   npm run gen-maps -- [--maps=a,b] [--workers=N] [-v] ...
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, relative } from "node:path";
import { Worker } from "node:worker_threads";
import { generateEnJSON, generateMapsTS, loadMapInfos } from "./codegen";
import { determineLogLevel, Logger, type LogFlags } from "./logger";
import { discoverMaps, inputMapDir, type MapEntry, repoRoot } from "./paths";

interface Flags {
  maps: string;
  workers: number;
  timings: boolean;
  log: LogFlags;
}

const TRUE = new Set(["1", "t", "T", "true", "TRUE", "True"]);
const FALSE = new Set(["0", "f", "F", "false", "FALSE", "False"]);

// Go's flag package: -name or --name, "=value" or a separate argument for non-bools.
function parseFlags(argv: string[]): Flags {
  const f: Flags = {
    maps: "",
    workers: 4,
    timings: false,
    log: { logLevel: "", verbose: false, performance: false, removal: false },
  };
  const bools: Record<string, (v: boolean) => void> = {
    verbose: (v) => (f.log.verbose = v),
    v: (v) => (f.log.verbose = v),
    "log-performance": (v) => (f.log.performance = v),
    "log-removal": (v) => (f.log.removal = v),
    timings: (v) => (f.timings = v),
  };
  const values: Record<string, (v: string) => void> = {
    maps: (v) => (f.maps = v),
    workers: (v) => {
      if (!/^[+-]?\d+$/.test(v))
        usage(`invalid value "${v}" for flag -workers: parse error`);
      f.workers = Number(v);
    },
    "log-level": (v) => (f.log.logLevel = v),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const m = /^--?([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) break; // first non-flag argument stops parsing, like Go
    const [, name, inline] = m;
    if (name === "h" || name === "help") {
      process.stderr.write(HELP);
      process.exit(0);
    }
    // Own keys only: --toString must be an unknown flag.
    const own = (o: object) => Object.prototype.hasOwnProperty.call(o, name);
    if (own(bools)) {
      // strconv.ParseBool's spellings, as Go's flag package accepts.
      if (inline === undefined || TRUE.has(inline)) bools[name](true);
      else if (FALSE.has(inline)) bools[name](false);
      else usage(`invalid boolean value "${inline}" for -${name}: parse error`);
    } else if (own(values)) {
      const v = inline ?? argv[++i];
      if (v === undefined) usage(`flag needs an argument: -${name}`);
      values[name](v);
    } else usage(`flag provided but not defined: -${name}`);
  }
  return f;
}

const HELP = `Usage: npm run gen-maps -- [flags]
  --maps=a,b         only generate these maps (default: all)
  --workers=n        maps to process at once (default 4); lower uses less memory
  --timings          print how long each map took, slowest first
  --log-level=level  ALL, DEBUG, INFO (default), WARN or ERROR
  --verbose, -v      debug logs prefixed with [mapname]; same as --log-level=DEBUG
  --log-performance  log performance recommendations; sets --log-level=DEBUG
  --log-removal      log each removed island and lake; sets --log-level=DEBUG
`;

// Like Go's flag package: the error, then the usage, exit status 2.
function usage(msg: string): never {
  process.stderr.write(msg + "\n" + HELP);
  process.exit(2);
}

function fatal(msg: string): never {
  process.stderr.write(
    `${new Date().toISOString().replace("T", " ").slice(0, 19).replace(/-/g, "/")} ${msg}\n`,
  );
  process.exit(1);
}

function selectMaps(maps: MapEntry[], mapsFlag: string): MapEntry[] {
  if (mapsFlag === "") return maps;
  const valid = new Set(maps.map((m) => m.name));
  const selected = new Set<string>();
  for (const name of mapsFlag.split(",")) {
    if (!valid.has(name)) throw new Error(`map "${name}" is not defined`);
    selected.add(name);
  }
  return maps.filter((m) => selected.has(m.name));
}

/** Generates the maps on a pool of worker threads, largest image first. */
async function loadTerrainMaps(
  selected: MapEntry[],
  flags: Flags,
  level: number,
): Promise<string[]> {
  if (flags.workers < 1)
    throw new Error(`--workers must be >= 1, got ${flags.workers}`);
  const size = (m: MapEntry) =>
    statSync(join(inputMapDir(m.isTest), m.name, "image.png"), {
      throwIfNoEntry: false,
    })?.size ?? 0;
  const queue = [...selected].sort((a, b) => size(b) - size(a));
  const poolSize = Math.min(flags.workers, queue.length);
  const manifestPaths: string[] = [];
  const errors: string[] = [];
  const timings: [string, number][] = [];

  await Promise.all(
    Array.from({ length: poolSize }, async () => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), {
        workerData: { level, flags: flags.log },
      });
      const exited = new Promise((resolve) => worker.once("exit", resolve));
      try {
        for (let task = queue.shift(); task; task = queue.shift()) {
          const res = await new Promise<{
            name: string;
            manifestPath?: string;
            error?: string;
            ms: number;
          }>((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.postMessage(task);
          });
          worker.removeAllListeners("error");
          timings.push([res.name, res.ms]);
          if (res.error !== undefined) errors.push(res.error);
          else manifestPaths.push(res.manifestPath!);
        }
      } finally {
        // null asks it to exit. Not terminate(), which drops its logs that
        // haven't reached this thread yet.
        worker.postMessage(null);
        await exited;
      }
    }),
  );
  if (flags.timings) {
    for (const [name, ms] of timings.sort((a, b) => b[1] - a[1]))
      process.stderr.write(`MAPTIME ${name} ${Math.round(ms)}\n`);
  }
  if (errors.length > 0) throw new Error(errors[0]);
  return manifestPaths;
}

function runOxfmt(files: string[]): void {
  if (files.length === 0) return;
  // Run oxfmt's bin script with this node, not through npx: on Windows npx
  // is npx.cmd, which spawnSync can't start without a shell.
  const args = [
    join(repoRoot, "node_modules/oxfmt/bin/oxfmt"),
    "--write",
    ...files.map((f) => relative(repoRoot, f).split("\\").join("/")),
  ];
  const r = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (r.error || r.status !== 0) {
    throw new Error(
      `oxfmt --write failed (is \`npm ci\` up to date?): ${r.error?.message ?? `exit status ${r.status}`}`,
    );
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const level = determineLogLevel(flags.log);
  const log = new Logger(level, flags.log);

  let maps: MapEntry[];
  try {
    maps = discoverMaps();
  } catch (e) {
    fatal(`Error discovering maps: ${(e as Error).message}`);
  }

  let manifestPaths: string[];
  try {
    manifestPaths = await loadTerrainMaps(
      selectMaps(maps, flags.maps),
      flags,
      level,
    );
  } catch (e) {
    fatal(`Error generating terrain maps: ${(e as Error).message}`);
  }

  let infos;
  try {
    infos = loadMapInfos(maps);
  } catch (e) {
    fatal(`Error loading map info: ${(e as Error).message}`);
  }
  let mapsTSPath: string, enJSONPath: string;
  try {
    mapsTSPath = generateMapsTS(infos);
  } catch (e) {
    fatal(`Error generating Maps.gen.ts: ${(e as Error).message}`);
  }
  try {
    enJSONPath = generateEnJSON(infos);
  } catch (e) {
    fatal(`Error generating en.json map section: ${(e as Error).message}`);
  }

  try {
    runOxfmt([...manifestPaths, mapsTSPath, enJSONPath]);
  } catch (e) {
    log.warn(
      `Failed to auto-format generated files with Oxfmt; run \`npm run format\` manually: ${(e as Error).message}`,
    );
  }
  process.stdout.write("Terrain maps generated successfully\n");
}

await main();

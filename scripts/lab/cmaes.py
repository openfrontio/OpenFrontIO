#!/usr/bin/env python3
"""CMA-ES over continuous PlaybookParams, one lab sweep per generation.

Each generation samples a population of parameter sets, writes them as the
CONFIGS JSON of one sweep (scripts/lab/remote.sh on Hetzner, or sweep.sh
locally with --runner local), scores every game with summarize.py (score =
landScore + rankScore + crown, see its docstring; --old-fitness for the old
alive + share + top3) and updates the search distribution. Same grid every
generation, so scores are paired.

Noise handling (2026-08-30):
  * every generation also runs the current distribution mean as config
    "mean" (--reeval-mean, default on; --no-reeval-mean to skip; --with-base
    still adds "base": {} as a drift reference);
  * the value handed to CMA-ES for a member is the mean over the grid of
    (member score - "mean" score on the same game) — a common-random-numbers
    paired difference, so the per-game scenario noise cancels. --raw-fitness
    ranks by plain mean score instead (the old behaviour);
  * --games-growth: once sigma falls below --grow-below (0.12) every later
    generation also runs --extra-batches ("med5 … med9", SPAWNRANK 5–9 on
    Medium; see docs/PlaybookBotLab.md), i.e. 60 games per config, so the
    fine end of the search is not fitted to 30 fixed scenarios;
  * gen_N.json stores the per-game score matrix of every config
    ("per_game", plus "per_game_old"), and --rescore OUT recomputes the score
    fields of every gen_N.json from the stored ab30 files with the current
    summarize.py without running anything (the CMA state is left as it was —
    the populations were sampled from it).

  python3 scripts/lab/cmaes.py --out lab-out/cma --pop 10 --gens 12 --minutes 20     # Hetzner
  python3 scripts/lab/cmaes.py --out /tmp/cma --pop 4 --gens 2 --dry-run              # no games, synthetic fitness
  python3 scripts/lab/cmaes.py --out lab-out/cma --pop 10 --gens 12                   # again = resume from the last gen_N.json
  python3 scripts/lab/cmaes.py --rescore lab-out/cma                                 # re-score stored results, no games

State lives in OUT/gen_N.json (population, scores, mean, sigma, C, paths);
the sweep results of generation N are in OUT/gen_N/. Re-running with the same
--out resumes: a finished generation is skipped, a generation whose sweep
already produced 30 games per config is scored without re-running it.

The search space is the unit cube; each parameter is mapped linearly onto
[lo, hi] ("int" parameters are rounded). Bounds come from --spec (JSON file)
or --param name=lo:hi[:init][:int]; the built-in spec is the 12-parameter
list of docs/PlaybookBotPlan.md (C3). Hetzner env vars (SERVER_TYPE, NAME,
LOCATION, …) pass through to remote.sh; the server is kept between
generations (KEEP=1, REUSE=1 after the first) and is never deleted here — run
`hcloud server delete $(hcloud server list -l lab=1 -o noheader -o columns=name)`
when the campaign is over. WORKERS=4 in the env spreads each generation over
four boxes (one shard each; ~15 min a generation for pop 10).

Pure python (stdlib only); numpy is used for the eigendecomposition when it
happens to be installed, a Jacobi solver otherwise.
"""
import argparse
import glob
import json
import math
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SUMMARIZE = os.path.join(HERE, "summarize.py")

# name: (lo, hi, init, int?) — init = DEFAULT_PLAYBOOK on 2026-08-29, keep in sync by hand
BUILTIN_SPEC = {
    "expandContested": (0.05, 0.5, 0.2, False),
    "expandFree": (0.03, 0.3, 0.1, False),
    "botRatio": (1.1, 3.0, 1.67, False),
    "botClickCap": (0.1, 0.6, 0.3, False),
    "fightAbove": (0.4, 0.95, 0.7, False),
    "fightMaxShare": (0.3, 0.9, 0.6, False),
    "reserveShare": (0.1, 0.5, 0.3, False),
    "retreatBelowRatio": (0.1, 0.8, 0.4, False),
    "capFullShare": (0.3, 0.9, 0.6, False),
    "bombReserve": (0, 1_000_000, 250_000, True),
    "railSpacing": (8, 32, 16, True),
}

SPAWNS = ["north-russia", "north-america", "east-asia", "africa", "south-america", "australia"]
BATCHES = ["med0", "med1", "med2", "med3", "med4"]
EXTRA_BATCHES = "med5 med6 med7 med8 med9"   # SPAWNRANK 5-9 on Medium (sweep.sh: med[0-9] -> DIFF=medium SPAWNRANK=k)


# ---------------------------------------------------------------- linear algebra (pure python)

def zeros(n):
    return [[0.0] * n for _ in range(n)]


def eye(n):
    m = zeros(n)
    for i in range(n):
        m[i][i] = 1.0
    return m


def matvec(m, v):
    return [sum(m[i][j] * v[j] for j in range(len(v))) for i in range(len(m))]


def eigh(C):
    """Symmetric eigendecomposition -> (eigenvalues, B) with C = B diag(vals) B^T; B[i][k] = k-th vector's i-th comp."""
    try:
        import numpy as np  # optional fast path

        vals, vecs = np.linalg.eigh(np.array(C))
        return [float(v) for v in vals], [[float(x) for x in row] for row in vecs]
    except ImportError:
        pass
    n = len(C)
    a = [row[:] for row in C]
    v = eye(n)
    for _ in range(100):
        off = sum(a[i][j] ** 2 for i in range(n) for j in range(n) if i != j)
        if off < 1e-22:
            break
        for p in range(n - 1):
            for q in range(p + 1, n):
                if abs(a[p][q]) < 1e-300:
                    continue
                theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
                t = (1.0 if theta >= 0 else -1.0) / (abs(theta) + math.sqrt(theta * theta + 1))
                c = 1 / math.sqrt(t * t + 1)
                s = t * c
                for k in range(n):
                    akp, akq = a[k][p], a[k][q]
                    a[k][p], a[k][q] = c * akp - s * akq, s * akp + c * akq
                for k in range(n):
                    apk, aqk = a[p][k], a[q][k]
                    a[p][k], a[q][k] = c * apk - s * aqk, s * apk + c * aqk
                for k in range(n):
                    vkp, vkq = v[k][p], v[k][q]
                    v[k][p], v[k][q] = c * vkp - s * vkq, s * vkp + c * vkq
    return [a[i][i] for i in range(n)], v


# ---------------------------------------------------------------- CMA-ES

class CMA:
    """Minimal (mu/mu_w, lambda)-CMA-ES after Hansen's tutorial; maximises."""

    def __init__(self, n, lam, sigma, mean=None, rng=None):
        self.n, self.lam, self.sigma = n, lam, sigma
        self.rng = rng or random.Random(0)
        self.mean = mean[:] if mean else [0.5] * n
        self.mu = lam // 2
        w = [math.log(self.mu + 0.5) - math.log(i + 1) for i in range(self.mu)]
        self.w = [x / sum(w) for x in w]
        self.mueff = 1 / sum(x * x for x in self.w)
        self.cc = (4 + self.mueff / n) / (n + 4 + 2 * self.mueff / n)
        self.cs = (self.mueff + 2) / (n + self.mueff + 5)
        self.c1 = 2 / ((n + 1.3) ** 2 + self.mueff)
        self.cmu = min(1 - self.c1, 2 * (self.mueff - 2 + 1 / self.mueff) / ((n + 2) ** 2 + self.mueff))
        self.damps = 1 + 2 * max(0.0, math.sqrt((self.mueff - 1) / (n + 1)) - 1) + self.cs
        self.chiN = math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n))
        self.C = eye(n)
        self.pc = [0.0] * n
        self.ps = [0.0] * n
        self._decompose()

    def _decompose(self):
        vals, self.B = eigh(self.C)
        self.D = [math.sqrt(max(v, 1e-20)) for v in vals]

    def ask(self):
        pop = []
        for _ in range(self.lam):
            z = [self.rng.gauss(0, 1) for _ in range(self.n)]
            y = [sum(self.B[i][k] * self.D[k] * z[k] for k in range(self.n)) for i in range(self.n)]
            x = [min(1.0, max(0.0, self.mean[i] + self.sigma * y[i])) for i in range(self.n)]
            pop.append(x)
        return pop

    def tell(self, pop, scores):
        n = self.n
        order = sorted(range(len(pop)), key=lambda i: -scores[i])
        ys = [[(pop[i][j] - self.mean[j]) / self.sigma for j in range(n)] for i in order[: self.mu]]
        yw = [sum(self.w[k] * ys[k][j] for k in range(self.mu)) for j in range(n)]
        self.mean = [self.mean[j] + self.sigma * yw[j] for j in range(n)]
        # C^{-1/2} yw = B D^{-1} B^T yw
        bt = [sum(self.B[i][k] * yw[i] for i in range(n)) / self.D[k] for k in range(n)]
        cinv_yw = [sum(self.B[i][k] * bt[k] for k in range(n)) for i in range(n)]
        f = math.sqrt(self.cs * (2 - self.cs) * self.mueff)
        self.ps = [(1 - self.cs) * self.ps[i] + f * cinv_yw[i] for i in range(n)]
        norm_ps = math.sqrt(sum(x * x for x in self.ps))
        hsig = 1.0 if norm_ps / math.sqrt(1 - (1 - self.cs) ** (2 * (self.gen + 1))) / self.chiN < 1.4 + 2 / (n + 1) else 0.0
        f = math.sqrt(self.cc * (2 - self.cc) * self.mueff)
        self.pc = [(1 - self.cc) * self.pc[i] + hsig * f * yw[i] for i in range(n)]
        for i in range(n):
            for j in range(n):
                rank1 = self.pc[i] * self.pc[j] + (1 - hsig) * self.cc * (2 - self.cc) * self.C[i][j]
                rankmu = sum(self.w[k] * ys[k][i] * ys[k][j] for k in range(self.mu))
                self.C[i][j] = (1 - self.c1 - self.cmu) * self.C[i][j] + self.c1 * rank1 + self.cmu * rankmu
        self.sigma *= math.exp((self.cs / self.damps) * (norm_ps / self.chiN - 1))
        self._decompose()

    gen = 0

    def state(self):
        return {"mean": self.mean, "sigma": self.sigma, "C": self.C, "pc": self.pc, "ps": self.ps, "gen": self.gen}

    def load(self, s):
        self.mean, self.sigma, self.C, self.pc, self.ps, self.gen = s["mean"], s["sigma"], s["C"], s["pc"], s["ps"], s["gen"]
        self._decompose()


# ---------------------------------------------------------------- parameter mapping

def parse_spec(args):
    if args.spec:
        raw = json.load(open(args.spec))
        spec = {}
        for k, v in raw.items():
            if isinstance(v, dict):
                spec[k] = (v["lo"], v["hi"], v.get("init", (v["lo"] + v["hi"]) / 2), bool(v.get("int", False)))
            else:
                is_int = len(v) > 3 and v[3] == "int"
                spec[k] = (v[0], v[1], v[2] if len(v) > 2 and v[2] != "int" else (v[0] + v[1]) / 2, is_int)
    elif args.param:
        spec = {}
        for p in args.param:
            name, _, rest = p.partition("=")
            parts = rest.split(":")
            lo, hi = float(parts[0]), float(parts[1])
            is_int = "int" in parts[2:]
            nums = [x for x in parts[2:] if x != "int"]
            spec[name] = (lo, hi, float(nums[0]) if nums else (lo + hi) / 2, is_int)
    else:
        spec = dict(BUILTIN_SPEC)
    if args.init:
        init = json.load(open(args.init)) if os.path.exists(args.init) else json.loads(args.init)
        for k, v in init.items():
            if k in spec:
                lo, hi, _, is_int = spec[k]
                spec[k] = (lo, hi, v, is_int)
    return spec


def to_params(spec, x):
    out = {}
    for (name, (lo, hi, _, is_int)), xi in zip(spec.items(), x):
        v = lo + xi * (hi - lo)
        out[name] = int(round(v)) if is_int else round(v, 4)
    return out


def to_unit(spec):
    return [(init - lo) / (hi - lo) if hi > lo else 0.5 for lo, hi, init, _ in spec.values()]


# ---------------------------------------------------------------- sweeps

def results_complete(results_dir, names, batches=BATCHES):
    if not os.path.isdir(results_dir):
        return False
    for n in names:
        for b in batches:
            f = os.path.join(results_dir, f"ab30_{n}_{b}.txt")
            if not os.path.isfile(f) or sum(1 for l in open(f) if "FINAL" in l) < len(SPAWNS):
                return False
    return True


def run_sweep(args, gen, configs, results_dir, batches):
    os.makedirs(results_dir, exist_ok=True)
    env = dict(os.environ)
    env["CONFIGS"] = json.dumps(configs)
    env["MINUTES"] = str(args.minutes)
    env["BATCHES"] = " ".join(batches)
    if args.runner == "local":
        env["OUT"] = results_dir
        env.setdefault("JOBS", str(args.jobs or os.cpu_count() or 4))
        cmd = [os.path.join(HERE, "sweep.sh")]
    else:
        env["DEST"] = results_dir
        env["KEEP"] = "1"
        # gen 0 creates the box (KEEP=1); later generations reuse it. Resuming gen 0
        # after a failed sweep with the box still up: pass REUSE=1 in the env.
        if gen > 0:
            env["REUSE"] = "1"
        env.setdefault("SERVER_TYPE", "cpx51")
        cmd = [os.path.join(HERE, "remote.sh")]
    log = os.path.join(results_dir, "runner.log")
    print(f"  sweep: {' '.join(cmd)} ({len(configs)} configs, {len(batches) * len(SPAWNS)} games each, {args.minutes} min) -> {results_dir}; log {log}")
    with open(log, "a") as lf:
        rc = subprocess.call(cmd, cwd=ROOT, env=env, stdout=lf, stderr=subprocess.STDOUT)
    if rc != 0:
        sys.exit(f"sweep failed (exit {rc}); see {log}. Re-run the same command to resume.")


def fake_sweep(args, spec, configs, results_dir, target, rng, batches):
    """--dry-run: write ab30 files whose FINAL lines encode a synthetic per-game score.

    Each (batch, region) scenario has its own fixed offset shared by every config
    (common random numbers — what the paired objective cancels), plus a small
    per-config noise. The FINAL lines carry players= and fired= like the real bot."""
    os.makedirs(results_dir, exist_ok=True)
    keys = list(spec.keys())
    for name, params in configs.items():
        # a config without a key (the {} base) sits at the spec's init value
        x = [(params.get(k, spec[k][2]) - spec[k][0]) / (spec[k][1] - spec[k][0]) if spec[k][1] > spec[k][0] else 0.5 for k in keys]
        d2 = sum((xi - ti) ** 2 for xi, ti in zip(x, target))
        q = math.exp(-4.0 * d2 / len(keys))  # 1 at the target, ~0.5 at a typical random point
        for b in batches:
            with open(os.path.join(results_dir, f"ab30_{name}_{b}.txt"), "w") as fh:
                for sp in SPAWNS:
                    scen = random.Random(f"{b}/{sp}").gauss(0, 0.15)  # per-scenario, same for every config
                    qq = min(1.0, max(0.0, q + scen + rng.gauss(0, 0.05)))
                    alive = qq > 0.05
                    tiles = int(10 ** (2 + 3 * qq)) if alive else 0  # 100 .. 100k
                    rank = 1 + int(round((1 - qq) * 39))
                    share = min(1.0, max(0.0, qq))
                    fired = "sim:3,trust:1" if qq > 0.5 else "-"
                    if alive:
                        fh.write(f"== {sp} | spawn 0,0 (dry run) | Medium == FINAL rank={rank} share={share:.2f} alive=true tiles={tiles} troops=0k players=40 fired={fired}\n")
                    else:
                        fh.write(f"== {sp} | spawn 0,0 (dry run) | Medium == DEAD at 100s FINAL alive=false tiles=0 troops=0k players=40 fired={fired}\n")


def score(results_dir, names, old=False, expect=30):
    cmd = [sys.executable, SUMMARIZE] + (["--old-fitness"] if old else []) + ["--fitness", results_dir] + names
    out = subprocess.check_output(cmd, text=True)
    fit = json.loads(out)
    for n in names:
        if fit[n]["games"] < expect:
            print(f"  warning: {n} has only {fit[n]['games']} games (expected {expect})")
    return fit


def objective(fit, names, ref, raw):
    """Value handed to CMA-ES per member: the mean over shared games of (member - ref) with common random
    numbers, or the plain mean score when raw (or when ref has no results)."""
    if raw or ref not in fit or not fit[ref]["per_game"]:
        return [fit[n]["fitness"] for n in names], "raw"
    ref_pg = fit[ref]["per_game"]
    vals = []
    for n in names:
        pg = fit[n]["per_game"]
        shared = [k for k in pg if k in ref_pg]
        vals.append(sum(pg[k] - ref_pg[k] for k in shared) / len(shared) if shared else 0.0)
    return vals, f"paired-vs-{ref}"


def score_record(record, results_dir, names, pop_names, configs, args):
    """Fill the score fields of a gen record from results_dir; returns the CMA objective per member."""
    fit = score(results_dir, names, old=args.old_fitness, expect=len(record.get("batches", BATCHES)) * len(SPAWNS))
    ref = "mean" if args.reeval_mean else "base"
    obj, kind = objective(fit, pop_names, ref, args.raw_fitness)
    best = max(range(len(pop_names)), key=lambda i: obj[i])
    record.update({
        "scoring": "fit_old" if args.old_fitness else "score",
        "objective_kind": kind,
        "objective": dict(zip(pop_names, obj)),
        "scores": {nm: {k: v for k, v in fit[nm].items() if not k.startswith("per_game")} for nm in names},
        "per_game": {nm: fit[nm]["per_game"] for nm in names},
        "per_game_old": {nm: fit[nm]["per_game_old"] for nm in names},
        "best": {"name": pop_names[best], "objective": obj[best], "fitness": fit[pop_names[best]]["fitness"], "params": configs[pop_names[best]]},
        "mean_fitness": sum(fit[nm]["fitness"] for nm in pop_names) / len(pop_names),
        "mean_objective": sum(obj) / len(obj),
    })
    return obj, fit


def rescore(args):
    """--rescore OUT: recompute the score fields of every gen_N.json from OUT/gen_N/ with the current summarize.py."""
    files = sorted(glob.glob(gen_file(args.rescore, "*")), key=lambda f: int(os.path.basename(f)[4:-5]))
    if not files:
        sys.exit(f"no gen_N.json in {args.rescore}")
    for f in files:
        record = json.load(open(f))
        g = record["gen"]
        results_dir = os.path.join(args.rescore, f"gen_{g}")
        pop_names = [m["name"] for m in record["population"]]
        configs = {m["name"]: m["params"] for m in record["population"]}
        names = list(pop_names)
        for extra in ("mean", "base"):
            if glob.glob(os.path.join(results_dir, f"ab30_{extra}_*.txt")):
                names.append(extra)
        batches = record.get("batches", BATCHES)
        if not results_complete(results_dir, names, batches):
            print(f"gen {g}: results incomplete in {results_dir}, skipped")
            continue
        args.reeval_mean = "mean" in names
        obj, fit = score_record(record, results_dir, names, pop_names, configs, args)
        json.dump(record, open(f, "w"), indent=1)
        extras = "".join(f", {x} {fit[x]['fitness']:.3f}" for x in ("mean", "base") if x in fit)
        print(f"gen {g}: rescored ({record['scoring']}, {record['objective_kind']}, {len(batches) * len(SPAWNS)} games) "
              f"mean fitness {record['mean_fitness']:.3f}, best {record['best']['name']} obj {record['best']['objective']:+.3f}{extras}")


# ---------------------------------------------------------------- driver

def gen_file(out, g):
    return os.path.join(out, f"gen_{g}.json")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help="campaign directory (gen_N.json + gen_N/ results); required unless --rescore")
    ap.add_argument("--pop", type=int, default=10, help="population per generation (configs per sweep)")
    ap.add_argument("--gens", type=int, default=12, help="total generations to reach (counting finished ones)")
    ap.add_argument("--sigma", type=float, default=0.25, help="initial step size in the unit cube")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--spec", help="JSON {name: [lo, hi, init, 'int'?]} or {name: {lo, hi, init, int}}")
    ap.add_argument("--param", action="append", help="name=lo:hi[:init][:int] (repeatable; replaces the built-in spec)")
    ap.add_argument("--init", help="JSON (file or string) of starting values, e.g. the current DEFAULT_PLAYBOOK subset")
    ap.add_argument("--runner", choices=["remote", "local"], default="remote")
    ap.add_argument("--minutes", type=int, default=20)
    ap.add_argument("--batches", help="override the grid batches (default med0..med4); must match every generation")
    ap.add_argument("--jobs", type=int, help="local runner: parallel games")
    ap.add_argument("--with-base", action="store_true", help="add 'base': {} to every sweep as a drift reference (30 more games)")
    ap.add_argument("--dry-run", action="store_true", help="no sweep: synthetic fitness, writes fake ab30 files")
    ap.add_argument("--reeval-mean", action=argparse.BooleanOptionalAction, default=True,
                    help="also run the distribution mean as config 'mean' every generation and rank members against it (default on)")
    ap.add_argument("--raw-fitness", action="store_true", help="rank members by plain mean score instead of the paired difference vs 'mean'")
    ap.add_argument("--old-fitness", action="store_true", help="score games with the old alive+share+top3 fitness")
    ap.add_argument("--games-growth", action="store_true", help="add --extra-batches once sigma < --grow-below (60 games per config)")
    ap.add_argument("--grow-below", type=float, default=0.12, help="sigma threshold for --games-growth")
    ap.add_argument("--extra-batches", default=EXTRA_BATCHES, help=f"batches added by --games-growth (default '{EXTRA_BATCHES}')")
    ap.add_argument("--rescore", metavar="OUT", help="recompute the scores of every gen_N.json in OUT from its stored results; runs nothing")
    args = ap.parse_args()
    if args.rescore:
        return rescore(args)
    if not args.out:
        ap.error("--out is required")

    spec = parse_spec(args)
    names_spec = list(spec.keys())
    n = len(names_spec)
    os.makedirs(args.out, exist_ok=True)
    rng = random.Random(args.seed)
    target = [rng.random() for _ in range(n)]  # dry-run optimum
    cma = CMA(n, args.pop, args.sigma, mean=to_unit(spec), rng=random.Random(args.seed))

    # resume
    done = sorted(int(os.path.basename(f)[4:-5]) for f in glob.glob(gen_file(args.out, "*")))
    start, pending = 0, None
    if done:
        last = json.load(open(gen_file(args.out, done[-1])))
        if "state_after" in last:
            cma.load(last["state_after"])
            start = done[-1] + 1
            print(f"resuming after generation {done[-1]} (sigma={cma.sigma:.4f})")
        else:
            cma.load(last["state_before"])
            start, pending = done[-1], last
            print(f"resuming generation {done[-1]} (population already sampled)")
        rng = random.Random(args.seed + start)
    base_batches = args.batches.split() if args.batches else list(BATCHES)
    for g in range(start, args.gens):
        cma.gen = g
        if pending:
            pop = [m["x"] for m in pending["population"]]
            batches = pending.get("batches", base_batches)
            pending = None
        else:
            cma.rng = random.Random(args.seed * 1000 + g)
            pop = cma.ask()
            batches = list(base_batches)
            if args.games_growth and cma.sigma < args.grow_below:
                batches += [b for b in args.extra_batches.split() if b not in batches]
        names = [f"g{g}p{i}" for i in range(len(pop))]
        configs = {nm: to_params(spec, x) for nm, x in zip(names, pop)}
        record = {
            "gen": g,
            "spec": {k: {"lo": v[0], "hi": v[1], "init": v[2], "int": v[3]} for k, v in spec.items()},
            "state_before": cma.state(),
            "population": [{"name": nm, "x": x, "params": configs[nm]} for nm, x in zip(names, pop)],
            "minutes": args.minutes,
            "batches": batches,
            "runner": "dry-run" if args.dry_run else args.runner,
        }
        json.dump(record, open(gen_file(args.out, g), "w"), indent=1)
        results_dir = os.path.join(args.out, f"gen_{g}")
        sweep_configs = dict(configs)
        if args.reeval_mean:
            sweep_configs["mean"] = to_params(spec, cma.mean)
        if args.with_base:
            sweep_configs["base"] = {}
        grown = " (grown grid)" if len(batches) > len(base_batches) else ""
        print(f"generation {g}: {len(sweep_configs)} configs x {len(batches) * len(SPAWNS)} games{grown}, sigma={cma.sigma:.4f}")
        if results_complete(results_dir, list(sweep_configs), batches):
            print("  results already present, scoring without a sweep")
        elif args.dry_run:
            fake_sweep(args, spec, sweep_configs, results_dir, target, random.Random(args.seed * 7 + g), batches)
        else:
            run_sweep(args, g, sweep_configs, results_dir, batches)
        obj, fit = score_record(record, results_dir, list(sweep_configs), names, configs, args)
        cma.tell(pop, obj)
        record.update({"mean_params": to_params(spec, cma.mean), "state_after": cma.state()})
        json.dump(record, open(gen_file(args.out, g), "w"), indent=1)
        best = record["best"]
        extras = "".join(f", {x} {fit[x]['fitness']:.3f}" for x in ("mean", "base") if x in fit)
        print(f"  mean fitness {record['mean_fitness']:.3f}{extras}; objective ({record['objective_kind']}) mean {record['mean_objective']:+.3f}, best {best['name']} {best['objective']:+.3f}")
        print(f"  best params: {json.dumps(best['params'])}")
        print(f"  new mean:    {json.dumps(record['mean_params'])}  sigma -> {cma.sigma:.4f}")
    if args.runner == "remote" and not args.dry_run:
        print("campaign done; the Hetzner server(s) are still running (KEEP=1) — delete them with: hcloud server delete $(hcloud server list -l lab=1 -o noheader -o columns=name)")


if __name__ == "__main__":
    main()

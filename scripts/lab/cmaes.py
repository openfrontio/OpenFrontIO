#!/usr/bin/env python3
"""CMA-ES over continuous PlaybookParams, one lab sweep per generation.

Each generation samples a population of parameter sets, writes them as the
CONFIGS JSON of one sweep (scripts/lab/remote.sh on Hetzner, or sweep.sh
locally with --runner local), scores every config with summarize.py
(fitness = mean over the 30-game grid of alive + share + top3) and updates the
search distribution. Same grid every generation, so scores are paired.

  python3 scripts/lab/cmaes.py --out lab-out/cma --pop 10 --gens 12 --minutes 20     # Hetzner
  python3 scripts/lab/cmaes.py --out /tmp/cma --pop 4 --gens 2 --dry-run              # no games, synthetic fitness
  python3 scripts/lab/cmaes.py --out lab-out/cma --pop 10 --gens 12                   # again = resume from the last gen_N.json

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


def run_sweep(args, gen, configs, results_dir):
    os.makedirs(results_dir, exist_ok=True)
    env = dict(os.environ)
    env["CONFIGS"] = json.dumps(configs)
    env["MINUTES"] = str(args.minutes)
    if args.batches:
        env["BATCHES"] = args.batches
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
    print(f"  sweep: {' '.join(cmd)} ({len(configs)} configs, {args.minutes} min) -> {results_dir}; log {log}")
    with open(log, "a") as lf:
        rc = subprocess.call(cmd, cwd=ROOT, env=env, stdout=lf, stderr=subprocess.STDOUT)
    if rc != 0:
        sys.exit(f"sweep failed (exit {rc}); see {log}. Re-run the same command to resume.")


def fake_sweep(args, spec, configs, results_dir, target, rng):
    """--dry-run: write ab30 files whose FINAL lines encode a synthetic fitness."""
    os.makedirs(results_dir, exist_ok=True)
    keys = list(spec.keys())
    for name, params in configs.items():
        # a config without a key (the {} base) sits at the spec's init value
        x = [(params.get(k, spec[k][2]) - spec[k][0]) / (spec[k][1] - spec[k][0]) if spec[k][1] > spec[k][0] else 0.5 for k in keys]
        d2 = sum((xi - ti) ** 2 for xi, ti in zip(x, target))
        f = 3.0 * math.exp(-4.0 * d2 / len(keys))  # 3 at the target, ~1.5 at a typical random point
        for b in (args.batches.split() if args.batches else BATCHES):
            with open(os.path.join(results_dir, f"ab30_{name}_{b}.txt"), "w") as fh:
                for sp in SPAWNS:
                    g = min(3.0, max(0.0, f + rng.gauss(0, 0.25)))
                    alive = g >= 0.5
                    share = min(1.0, max(0.0, g - 1.0)) if alive else 0.0
                    rank = 1 if g >= 2.9 else 2 if g >= 2.5 else 3 if g >= 2.0 else 5 + int((3 - g) * 3)
                    tiles = int(g * 20000)
                    if alive:
                        fh.write(f"== {sp} | spawn 0,0 (dry run) | Medium == FINAL rank={rank} share={share:.2f} alive=true tiles={tiles} troops=0k\n")
                    else:
                        fh.write(f"== {sp} | spawn 0,0 (dry run) | Medium == DEAD at 100s FINAL alive=false tiles=0 troops=0k\n")


def score(results_dir, names):
    out = subprocess.check_output([sys.executable, SUMMARIZE, "--fitness", results_dir] + names, text=True)
    fit = json.loads(out)
    for n in names:
        if fit[n]["games"] < 30:
            print(f"  warning: {n} has only {fit[n]['games']} games")
    return [fit[n]["fitness"] for n in names], fit


# ---------------------------------------------------------------- driver

def gen_file(out, g):
    return os.path.join(out, f"gen_{g}.json")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="campaign directory (gen_N.json + gen_N/ results)")
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
    args = ap.parse_args()

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
    for g in range(start, args.gens):
        cma.gen = g
        if pending:
            pop = [m["x"] for m in pending["population"]]
            pending = None
        else:
            cma.rng = random.Random(args.seed * 1000 + g)
            pop = cma.ask()
        names = [f"g{g}p{i}" for i in range(len(pop))]
        configs = {nm: to_params(spec, x) for nm, x in zip(names, pop)}
        record = {
            "gen": g,
            "spec": {k: {"lo": v[0], "hi": v[1], "init": v[2], "int": v[3]} for k, v in spec.items()},
            "state_before": cma.state(),
            "population": [{"name": nm, "x": x, "params": configs[nm]} for nm, x in zip(names, pop)],
            "minutes": args.minutes,
            "runner": "dry-run" if args.dry_run else args.runner,
        }
        json.dump(record, open(gen_file(args.out, g), "w"), indent=1)
        results_dir = os.path.join(args.out, f"gen_{g}")
        sweep_configs = dict(configs)
        if args.with_base:
            sweep_configs["base"] = {}
        print(f"generation {g}: {len(pop)} configs, sigma={cma.sigma:.4f}")
        if results_complete(results_dir, list(sweep_configs), args.batches.split() if args.batches else BATCHES):
            print("  results already present, scoring without a sweep")
        elif args.dry_run:
            fake_sweep(args, spec, sweep_configs, results_dir, target, random.Random(args.seed * 7 + g))
        else:
            run_sweep(args, g, sweep_configs, results_dir)
        scores, fit = score(results_dir, list(sweep_configs))
        pop_scores = scores[: len(pop)]
        cma.tell(pop, pop_scores)
        best = max(range(len(pop)), key=lambda i: pop_scores[i])
        record.update({
            "scores": {nm: fit[nm] for nm in sweep_configs},
            "best": {"name": names[best], "fitness": pop_scores[best], "params": configs[names[best]]},
            "mean_fitness": sum(pop_scores) / len(pop_scores),
            "mean_params": to_params(spec, cma.mean),
            "state_after": cma.state(),
        })
        json.dump(record, open(gen_file(args.out, g), "w"), indent=1)
        base_note = f", base {fit['base']['fitness']:.3f}" if args.with_base else ""
        print(f"  mean fitness {record['mean_fitness']:.3f}, best {names[best]} {pop_scores[best]:.3f}{base_note}")
        print(f"  best params: {json.dumps(configs[names[best]])}")
        print(f"  new mean:    {json.dumps(record['mean_params'])}  sigma -> {cma.sigma:.4f}")
    if args.runner == "remote" and not args.dry_run:
        print("campaign done; the Hetzner server(s) are still running (KEEP=1) — delete them with: hcloud server delete $(hcloud server list -l lab=1 -o noheader -o columns=name)")


if __name__ == "__main__":
    main()

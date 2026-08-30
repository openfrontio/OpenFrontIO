#!/usr/bin/env python3
"""Summarise PlaybookBot lab sweeps (python3 stdlib only).

Reads the ab30_<config>_<batch>.txt files a sweep leaves in a results dir
(one FINAL line per game, see docs/PlaybookBotLab.md) and prints, per config:
games, alive, crowns (rank 1), top-3, total tiles, median land, mean fitness;
then pairs every game by (batch, region) against the first config named and
prints wins / losses / identical pairs plus the biggest swings.

  python3 scripts/lab/summarize.py DIR                 # every config found in DIR, first is the baseline
  python3 scripts/lab/summarize.py DIR base cand1 …    # explicit order; first = baseline
  python3 scripts/lab/summarize.py --fitness DIR …     # JSON {config: {"fitness": …, "games": …}} for cmaes.py
  python3 scripts/lab/summarize.py --ladder DIR cand v-current v3 v2   # Bradley–Terry table over all pairs

Fitness of one game = alive (0/1) + share (0..1) + (rank <= 3 ? 1 : 0), so a
config's fitness is in [0, 3]; a dead game scores 0.
"""
import glob
import json
import math
import os
import re
import statistics
import sys

FINAL_RE = re.compile(
    r"== (?P<region>\S+) \|.*\| (?P<diff>\w+) ==.*FINAL(?: rank=(?P<rank>\d+))?"
    r"(?: share=(?P<share>[\d.]+))?.*?alive=(?P<alive>\w+) tiles=(?P<tiles>\d+)"
)
DEAD_RE = re.compile(r"DEAD at (\d+)s")


def parse_line(line):
    m = FINAL_RE.search(line)
    if not m:
        return None
    alive = m.group("alive") == "true"
    rank = int(m.group("rank")) if m.group("rank") else None
    share = float(m.group("share")) if m.group("share") else 0.0
    dead = DEAD_RE.search(line)
    return {
        "region": m.group("region"),
        "diff": m.group("diff"),
        "alive": alive,
        "rank": rank,
        "share": share,
        "tiles": int(m.group("tiles")),
        "deadAt": int(dead.group(1)) if dead else None,
    }


def fitness(g):
    return (1.0 if g["alive"] else 0.0) + g["share"] + (1.0 if g["rank"] is not None and g["rank"] <= 3 else 0.0)


def load(d, cfg):
    """{(batch, region): game} for one config. Falls back to the p_*.txt transcripts
    when the aggregated ab30 files are missing (sweep died before aggregating)."""
    games = {}
    files = sorted(glob.glob(os.path.join(d, f"ab30_{cfg}_*.txt")))
    for f in files:
        batch = os.path.basename(f)[:-4].split("_")[-1]
        for line in open(f):
            g = parse_line(line)
            if g:
                games[(batch, g["region"])] = g
    if not games:
        for f in sorted(glob.glob(os.path.join(d, f"p_{cfg}_*_*.txt"))):
            rest = os.path.basename(f)[len(f"p_{cfg}_"):-4]
            batch, _, region = rest.partition("_")
            text = open(f).read()
            joined = " ".join(l.strip() for l in text.splitlines() if l.startswith("==") or "DEAD" in l or "FINAL" in l)
            g = parse_line(joined)
            if g:
                games[(batch, region)] = g
    return games


def discover(d):
    names = []
    for f in sorted(glob.glob(os.path.join(d, "ab30_*_*.txt"))):
        stem = os.path.basename(f)[5:-4]
        name = stem.rsplit("_", 1)[0]
        if name not in names:
            names.append(name)
    return names


def summary(games):
    vals = list(games.values())
    tiles = [g["tiles"] for g in vals]
    return {
        "games": len(vals),
        "alive": sum(g["alive"] for g in vals),
        "crowns": sum(1 for g in vals if g["rank"] == 1),
        "top3": sum(1 for g in vals if g["rank"] is not None and g["rank"] <= 3),
        "tiles": sum(tiles),
        "median": statistics.median(tiles) if tiles else 0,
        "fitness": statistics.fmean(fitness(g) for g in vals) if vals else 0.0,
    }


def outcome(g):
    """Ordering key for a paired comparison: alive first, then land."""
    return (1 if g["alive"] else 0, g["tiles"])


def paired(a, b):
    """wins / losses / identical of a vs b over shared (batch, region) keys, plus the swings."""
    w = l = same = 0
    swings = []
    for k in sorted(set(a) & set(b)):
        ka, kb = outcome(a[k]), outcome(b[k])
        if ka == kb:
            same += 1
        elif ka > kb:
            w += 1
        else:
            l += 1
        swings.append((a[k]["tiles"] - b[k]["tiles"], k))
    swings.sort(key=lambda s: -abs(s[0]))
    return w, l, same, swings


def print_table(d, names):
    data = {n: load(d, n) for n in names}
    print(f"{'config':16s} {'games':>5s} {'alive':>5s} {'crown':>5s} {'top3':>4s} {'tiles':>9s} {'median':>7s} {'fit':>6s}")
    for n in names:
        s = summary(data[n])
        print(f"{n:16s} {s['games']:5d} {s['alive']:5d} {s['crowns']:5d} {s['top3']:4d} {s['tiles']:9d} {int(s['median']):7d} {s['fitness']:6.3f}")
    base = names[0]
    if len(names) > 1:
        print(f"\npaired vs {base} (by batch+region; identical = the change never triggered):")
        for n in names[1:]:
            w, l, same, swings = paired(data[n], data[base])
            top = ", ".join(f"{k[1]}/{k[0]} {dt:+d}" for dt, k in swings[:3])
            print(f"  {n:16s} wins {w:2d}  loses {l:2d}  identical {same:2d}   swings: {top}")
    missing = {n: 30 - len(data[n]) for n in names if len(data[n]) < 30}
    if missing:
        print("\nwarning: fewer than 30 games for " + ", ".join(f"{n} ({30 - m})" for n, m in missing.items()))


def bradley_terry(names, wins, iters=500):
    """Zermelo / MM fit of p_i (ties count half). wins[(i, j)] = wins of i over j."""
    n = len(names)
    p = [1.0] * n
    tot = {(i, j): wins.get((i, j), 0) + wins.get((j, i), 0) for i in range(n) for j in range(n) if i != j}
    for _ in range(iters):
        new = []
        for i in range(n):
            w_i = sum(wins.get((i, j), 0) for j in range(n) if j != i)
            denom = sum(tot[(i, j)] / (p[i] + p[j]) for j in range(n) if j != i and tot[(i, j)])
            new.append(w_i / denom if denom and w_i else 1e-6)
        gm = math.exp(sum(math.log(x) for x in new) / n)
        p = [x / gm for x in new]
    return p


def print_ladder(d, names):
    data = {n: load(d, n) for n in names}
    n = len(names)
    wins = {}
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            w, l, same, _ = paired(data[names[i]], data[names[j]])
            wins[(i, j)] = w + 0.5 * same
    p = bradley_terry(names, wins)
    order = sorted(range(n), key=lambda i: -p[i])
    head = "".join(f"{names[j][:10]:>11s}" for j in order)
    print(f"{'config':16s} {'strength':>8s} {'fit':>6s} {'alive':>5s} {'crown':>5s} |{head}")
    for i in order:
        s = summary(data[names[i]])
        row = ""
        for j in order:
            if i == j:
                row += f"{'-':>11s}"
            else:
                w, l, same, _ = paired(data[names[i]], data[names[j]])
                row += f"{f'{w}-{l}-{same}':>11s}"
        print(f"{names[i]:16s} {math.log(p[i]):8.3f} {s['fitness']:6.3f} {s['alive']:5d} {s['crowns']:5d} |{row}")
    print("\nstrength = log Bradley–Terry score (0 = average); cells = wins-losses-identical of row vs column")
    print("P(row beats column) = 1 / (1 + exp(strength_col - strength_row))")
    cand = names[0]
    ci = 0
    for j in range(1, n):
        prob = 1 / (1 + math.exp(math.log(p[j]) - math.log(p[ci])))
        print(f"  P({cand} beats {names[j]}) = {prob:.2f}")


def main(argv):
    mode = "table"
    if argv and argv[0] in ("--fitness", "--ladder"):
        mode = argv[0][2:]
        argv = argv[1:]
    if not argv:
        print(__doc__)
        return 2
    d = argv[0]
    names = argv[1:] or discover(d)
    if not names:
        print(f"no ab30_*.txt files in {d}")
        return 1
    if mode == "fitness":
        out = {}
        for n in names:
            s = summary(load(d, n))
            out[n] = {"fitness": s["fitness"], "games": s["games"], "alive": s["alive"], "top3": s["top3"], "tiles": s["tiles"]}
        print(json.dumps(out, indent=1))
    elif mode == "ladder":
        if len(names) < 2:
            print("--ladder needs a candidate and at least one version")
            return 2
        print_ladder(d, names)
    else:
        print_table(d, names)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Summarise PlaybookBot lab sweeps (python3 stdlib only).

Reads the ab30_<config>_<batch>.txt files a sweep leaves in a results dir
(one FINAL line per game, see docs/PlaybookBotLab.md) and prints, per config:
games, alive, crowns (rank 1), top-3, total tiles, median land, the old
fitness (`fit_old`) and the new score; then pairs every game by
(batch, region) against the first config named and prints wins / losses /
identical pairs, the biggest swings, and the live-game statistics below.

  python3 scripts/lab/summarize.py DIR                 # every config found in DIR, first is the baseline
  python3 scripts/lab/summarize.py DIR base cand1 …    # explicit order; first = baseline
  python3 scripts/lab/summarize.py --fitness DIR …     # JSON {config: {"fitness": …, "per_game": {…}, …}} for cmaes.py
  python3 scripts/lab/summarize.py --old-fitness --fitness DIR …   # "fitness" = the old alive+share+top3 instead
  python3 scripts/lab/summarize.py --ladder DIR cand v-current v3 v2   # Bradley–Terry table over all pairs
  python3 scripts/lab/summarize.py --at 600 DIR …      # same, but scored from the 10-minute row of each transcript
  python3 scripts/lab/summarize.py --verdict 3 DIR …   # per config: "clear" when |wins - losses| >= 3 vs the baseline, else "unclear"
                                                       # (exit 0 when every config is clear — remote.sh STAGED=1 uses this to skip the rest of the grid)
  python3 scripts/lab/summarize.py --selftest          # inline fixture, exit 0 iff the scoring is as documented here

Score of one game (2026-08-30, replaces the old fitness as the objective):

    score     = landScore + rankScore + crown                  # in [0.4, 2.25]
    landScore = log10(max(tiles, 100)) / 5                    # 100k tiles = 1.0, 10k = 0.8, dead (0 tiles) = 0.4
    rankScore = 1 - (rank - 1) / (players - 1)   if alive     # 1st = 1.0, last = 0.0; 0 when dead
    crown     = 0.25                             if rank == 1

`players` is the `players=N` field of the FINAL line (bot-side change of
2026-08-30). When it is missing we take the N of the last `rank=x/N` row of
the p_<config>_<batch>_<region>.txt transcript if that file is present, and
otherwise ASSUME N=40 (a note is printed). A config's score is its mean over
the grid. The old fitness, alive (0/1) + share (0..1) + (rank <= 3 ? 1 : 0)
in [0, 3], is still computed and printed as `fit_old`.

The FINAL line may also carry `fired=flag:count,flag:count` — which flagged
branches fired during that game (`fired=-` or absent = none). In the paired
report a game is *live* for a config when its `fired` is non-empty or its
outcome (alive, tiles) differs from the baseline's; wins / losses / ties, the
mean paired score difference with a bootstrap 95% CI (1000 resamples, seed 0)
and a two-sided sign test are over live games only, and the verdict is
"decisive win" / "decisive loss" when the sign test has p < 0.05, else
"undecided (n_live=…)".
"""
import glob
import json
import math
import os
import random
import re
import statistics
import sys

FINAL_RE = re.compile(
    r"== (?P<region>\S+) \|.*\| (?P<diff>\w+) ==.*FINAL(?: rank=(?P<rank>\d+))?"
    r"(?: share=(?P<share>[\d.]+))?.*?alive=(?P<alive>\w+) tiles=(?P<tiles>\d+)"
)
DEAD_RE = re.compile(r"DEAD at (\d+)s")
PLAYERS_RE = re.compile(r"\bplayers=(\d+)")
FIRED_RE = re.compile(r"\bfired=(\S+)")
# one per-30-s row of a transcript:  "  600s bots=… tiles=  12345 troops=… rank=3/41 share=0.62"
ROW_RE = re.compile(r"^\s*(?P<t>\d+)s .*?tiles=\s*(?P<tiles>\d+).*?rank=(?P<rank>\d+)/(?P<players>\d+)(?: share=(?P<share>[\d.]+))?")
AT = None  # --at SECONDS: score games from the row at that time instead of FINAL
ASSUMED_PLAYERS = 40
ASSUMED = {}  # config -> games whose player count had to be assumed (reported once)
BOOT_N = 1000
BOOT_SEED = 0


def parse_fired(s):
    """'a:3,b:1' -> {'a': 3, 'b': 1}; '-' / '' -> {}."""
    out = {}
    for part in (s or "").split(","):
        name, _, count = part.partition(":")
        if name and name != "-":
            out[name] = int(count) if count.isdigit() else 1
    return out


def parse_line(line):
    m = FINAL_RE.search(line)
    if not m:
        return None
    alive = m.group("alive") == "true"
    rank = int(m.group("rank")) if m.group("rank") else None
    share = float(m.group("share")) if m.group("share") else 0.0
    dead = DEAD_RE.search(line)
    players = PLAYERS_RE.search(line)
    fired = FIRED_RE.search(line)
    return {
        "region": m.group("region"),
        "diff": m.group("diff"),
        "alive": alive,
        "rank": rank,
        "share": share,
        "tiles": int(m.group("tiles")),
        "deadAt": int(dead.group(1)) if dead else None,
        "players": int(players.group(1)) if players else None,
        "fired": parse_fired(fired.group(1)) if fired else {},
    }


def fitness(g):
    """The old objective: alive + share + top3, in [0, 3]."""
    return (1.0 if g["alive"] else 0.0) + g["share"] + (1.0 if g["rank"] is not None and g["rank"] <= 3 else 0.0)


def land_score(tiles):
    return math.log10(max(tiles, 100)) / 5


def rank_score(g):
    if not g["alive"] or g["rank"] is None:
        return 0.0
    players = g.get("players") or ASSUMED_PLAYERS
    if players <= 1:
        return 1.0
    return max(0.0, 1 - (g["rank"] - 1) / (players - 1))


def score(g):
    crown = 0.25 if (g["alive"] and g["rank"] == 1) else 0.0
    return land_score(g["tiles"]) + rank_score(g) + crown


def parse_at(text, seconds):
    """Game state at `seconds` from a transcript: the last row at or before that time (dead = no row and a
    DEAD line before it). share needs the row's share= field (transcripts from 2026-08-30 on)."""
    header = next((l for l in text.splitlines() if l.startswith("==")), None)
    hm = re.search(r"== (?P<region>\S+) \|.*\| (?P<diff>\w+) ==", header or "")
    if not hm:
        return None
    row = None
    for l in text.splitlines():
        m = ROW_RE.match(l)
        if m and int(m.group("t")) <= seconds:
            row = m
    dead = DEAD_RE.search(text)
    dead_at = int(dead.group(1)) if dead else None
    alive = not (dead_at is not None and dead_at <= seconds)
    base = {"region": hm.group("region"), "diff": hm.group("diff"), "alive": alive, "deadAt": dead_at, "fired": {}}
    if row is None:
        return {**base, "rank": None, "share": 0.0, "tiles": 0, "players": None}
    return {
        **base,
        "rank": int(row.group("rank")) if alive else None,
        "share": float(row.group("share")) if (alive and row.group("share")) else 0.0,
        "tiles": int(row.group("tiles")) if alive else 0,
        "players": int(row.group("players")),
    }


def players_from_transcript(path):
    """N of the last 'rank=x/N' row of a transcript, or None."""
    if not os.path.isfile(path):
        return None
    n = None
    for l in open(path):
        m = ROW_RE.match(l)
        if m:
            n = int(m.group("players"))
    return n


def fill_players(d, cfg, games):
    for (batch, region), g in games.items():
        if g.get("players"):
            continue
        g["players"] = players_from_transcript(os.path.join(d, f"p_{cfg}_{batch}_{region}.txt"))
        if not g["players"]:
            ASSUMED.setdefault(cfg, 0)
            ASSUMED[cfg] += 1


def load(d, cfg):
    """{(batch, region): game} for one config. Falls back to the p_*.txt transcripts
    when the aggregated ab30 files are missing (sweep died before aggregating).
    With --at, always reads the transcripts."""
    games = {}
    if AT is not None:
        for f in sorted(glob.glob(os.path.join(d, f"p_{cfg}_*_*.txt"))):
            rest = os.path.basename(f)[len(f"p_{cfg}_"):-4]
            batch, _, region = rest.partition("_")
            g = parse_at(open(f).read(), AT)
            if g:
                games[(batch, region)] = g
        fill_players(d, cfg, games)
        return games
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
    fill_players(d, cfg, games)
    return games


def assumed_note():
    if not ASSUMED:
        return None
    return ("note: no players= on the FINAL line and no transcript for "
            + ", ".join(f"{c} ({n} games)" for c, n in ASSUMED.items())
            + f" — rankScore assumes {ASSUMED_PLAYERS} players")


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
        "score": statistics.fmean(score(g) for g in vals) if vals else 0.0,
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


def sign_test(w, l):
    """Two-sided exact sign test on wins vs losses (ties excluded)."""
    n = w + l
    if n == 0:
        return 1.0
    k = min(w, l)
    p = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * p)


def bootstrap_ci(diffs, n=BOOT_N, seed=BOOT_SEED):
    if not diffs:
        return (0.0, 0.0)
    rng = random.Random(seed)
    m = len(diffs)
    means = sorted(statistics.fmean(diffs[rng.randrange(m)] for _ in range(m)) for _ in range(n))
    return means[int(0.025 * n)], means[min(n - 1, int(0.975 * n))]


def live_stats(a, b):
    """Paired statistics of config a vs baseline b over *live* games (a fired something, or the outcome differs)."""
    keys = sorted(set(a) & set(b))
    diffs = []
    w = l = t = 0
    for k in keys:
        live = bool(a[k].get("fired")) or outcome(a[k]) != outcome(b[k])
        if not live:
            continue
        d = score(a[k]) - score(b[k])
        diffs.append(d)
        if d > 1e-12:
            w += 1
        elif d < -1e-12:
            l += 1
        else:
            t += 1
    mean = statistics.fmean(diffs) if diffs else 0.0
    lo, hi = bootstrap_ci(diffs)
    p = sign_test(w, l)
    if p < 0.05 and w > l:
        verdict = "decisive win"
    elif p < 0.05 and l > w:
        verdict = "decisive loss"
    else:
        verdict = f"undecided (n_live={len(diffs)})"
    return {"n": len(keys), "n_live": len(diffs), "wins": w, "losses": l, "ties": t,
            "mean_diff": mean, "ci": (lo, hi), "p": p, "verdict": verdict}


def format_live(n, s):
    return (f"  {n:16s} n_live {s['n_live']:2d}/{s['n']:2d}  W {s['wins']:2d} L {s['losses']:2d} T {s['ties']:2d}"
            f"  dScore {s['mean_diff']:+.3f} [{s['ci'][0]:+.3f}, {s['ci'][1]:+.3f}]  p={s['p']:.3f}  {s['verdict']}")


def print_table(d, names):
    data = {n: load(d, n) for n in names}
    print(f"{'config':16s} {'games':>5s} {'alive':>5s} {'crown':>5s} {'top3':>4s} {'tiles':>9s} {'median':>7s} {'fit_old':>7s} {'score':>6s}")
    for n in names:
        s = summary(data[n])
        print(f"{n:16s} {s['games']:5d} {s['alive']:5d} {s['crowns']:5d} {s['top3']:4d} {s['tiles']:9d} {int(s['median']):7d} {s['fitness']:7.3f} {s['score']:6.3f}")
    base = names[0]
    if len(names) > 1:
        print(f"\npaired vs {base} (by batch+region; identical = the change never triggered):")
        for n in names[1:]:
            w, l, same, swings = paired(data[n], data[base])
            top = ", ".join(f"{k[1]}/{k[0]} {dt:+d}" for dt, k in swings[:3])
            print(f"  {n:16s} wins {w:2d}  loses {l:2d}  identical {same:2d}   swings: {top}")
        print(f"\nlive games vs {base} (fired non-empty or outcome differs; score = land+rank+crown; sign test, bootstrap 95% CI):")
        for n in names[1:]:
            print(format_live(n, live_stats(data[n], data[base])))
    missing = {n: 30 - len(data[n]) for n in names if len(data[n]) < 30}
    if missing:
        print("\nwarning: fewer than 30 games for " + ", ".join(f"{n} ({30 - m})" for n, m in missing.items()))
    note = assumed_note()
    if note:
        print("\n" + note)


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
    print(f"{'config':16s} {'strength':>8s} {'fit_old':>7s} {'score':>6s} {'alive':>5s} {'crown':>5s} |{head}")
    for i in order:
        s = summary(data[names[i]])
        row = ""
        for j in order:
            if i == j:
                row += f"{'-':>11s}"
            else:
                w, l, same, _ = paired(data[names[i]], data[names[j]])
                row += f"{f'{w}-{l}-{same}':>11s}"
        print(f"{names[i]:16s} {math.log(p[i]):8.3f} {s['fitness']:7.3f} {s['score']:6.3f} {s['alive']:5d} {s['crowns']:5d} |{row}")
    print("\nstrength = log Bradley–Terry score (0 = average); cells = wins-losses-identical of row vs column")
    print("P(row beats column) = 1 / (1 + exp(strength_col - strength_row))")
    cand = names[0]
    ci = 0
    for j in range(1, n):
        prob = 1 / (1 + math.exp(math.log(p[j]) - math.log(p[ci])))
        print(f"  P({cand} beats {names[j]}) = {prob:.2f}")
    print(f"\nlive games of {cand} vs each version:")
    for j in range(1, n):
        print(format_live(names[j], live_stats(data[cand], data[names[j]])))
    note = assumed_note()
    if note:
        print("\n" + note)


def verdict(d, names, thresh):
    """Staged A/B helper: 'clear' when |wins - losses| >= thresh vs the baseline. Exit code 0 iff all clear."""
    data = {n: load(d, n) for n in names}
    base = names[0]
    all_clear = True
    for n in names[1:]:
        w, l, same, _ = paired(data[n], data[base])
        clear = abs(w - l) >= thresh
        all_clear = all_clear and clear
        print(f"{n} {'clear' if clear else 'unclear'} wins={w} losses={l} identical={same} games={len(data[n])}")
    return 0 if all_clear else 1


def fitness_json(d, names, old):
    out = {}
    for n in names:
        games = load(d, n)
        s = summary(games)
        per = {f"{b}/{r}": round(score(g), 6) for (b, r), g in sorted(games.items())}
        per_old = {f"{b}/{r}": round(fitness(g), 6) for (b, r), g in sorted(games.items())}
        out[n] = {
            "fitness": s["fitness"] if old else s["score"],
            "score": s["score"], "fit_old": s["fitness"],
            "games": s["games"], "alive": s["alive"], "crowns": s["crowns"], "top3": s["top3"], "tiles": s["tiles"],
            "per_game": per_old if old else per, "per_game_score": per, "per_game_old": per_old,
        }
    print(json.dumps(out, indent=1))
    note = assumed_note()
    if note:
        print(note, file=sys.stderr)


# ---------------------------------------------------------------- self-test

SELFTEST_BASE = [
    "== africa | spawn 1,1 (bot picker rank 0) | Medium == FINAL rank=1 share=0.90 alive=true tiles=100000 troops=1k players=40",
    "== australia | spawn 1,1 (bot picker rank 0) | Medium == FINAL rank=20 share=0.30 alive=true tiles=10000 troops=1k players=39",
    "== east-asia | spawn 1,1 (bot picker rank 0) | Medium == DEAD at 300s FINAL alive=false tiles=0 troops=0k players=40",
]
SELFTEST_CAND = [
    # same outcome as base but a flag fired -> live tie
    "== africa | spawn 1,1 (bot picker rank 0) | Medium == FINAL rank=1 share=0.90 alive=true tiles=100000 troops=1k players=40 fired=trustWars:2,nationAware:1",
    # better -> live win (rank 2/39: rankScore 1-1/38)
    "== australia | spawn 1,1 (bot picker rank 0) | Medium == FINAL rank=2 share=0.50 alive=true tiles=20000 troops=1k players=39 fired=-",
    # identical, nothing fired -> not live
    "== east-asia | spawn 1,1 (bot picker rank 0) | Medium == DEAD at 300s FINAL alive=false tiles=0 troops=0k players=40",
]


def selftest():
    def games(lines):
        return {("med0", g["region"]): g for g in (parse_line(l) for l in lines) if g}

    base, cand = games(SELFTEST_BASE), games(SELFTEST_CAND)
    expect = {"africa": 2.25, "australia": 0.8 + 0.5, "east-asia": 0.4}
    ok = True

    def check(cond, msg):
        nonlocal ok
        print(("ok   " if cond else "FAIL ") + msg)
        ok = ok and cond

    for r, e in expect.items():
        s = score(base[("med0", r)])
        check(abs(s - e) < 1e-9, f"score base/{r} = {s:.4f} (expected {e})")
    check(abs(fitness(base[("med0", "africa")]) - 2.9) < 1e-9, "fit_old base/africa = 2.9")
    check(cand[("med0", "africa")]["fired"] == {"trustWars": 2, "nationAware": 1}, "fired= parsed")
    check(cand[("med0", "australia")]["fired"] == {}, "fired=- is empty")
    check(base[("med0", "australia")]["players"] == 39, "players= parsed")
    nop = parse_line(SELFTEST_BASE[1].replace(" players=39", ""))
    check(nop["players"] is None and abs(rank_score(nop) - (1 - 19 / 39)) < 1e-9, f"missing players -> assume {ASSUMED_PLAYERS}")
    st = live_stats(cand, base)
    check(st["n"] == 3 and st["n_live"] == 2, f"n_live = {st['n_live']} of {st['n']} (expected 2 of 3)")
    check((st["wins"], st["losses"], st["ties"]) == (1, 0, 1), f"W/L/T = {st['wins']}/{st['losses']}/{st['ties']} (expected 1/0/1)")
    d_aus = (math.log10(20000) / 5 + 1 - 1 / 38) - 1.3
    check(abs(st["mean_diff"] - d_aus / 2) < 1e-9, f"mean paired diff = {st['mean_diff']:+.4f}")
    check(abs(st["p"] - 1.0) < 1e-9, f"sign test p = {st['p']} for 1 win 0 losses")
    check(st["verdict"].startswith("undecided"), f"verdict: {st['verdict']}")
    check(abs(sign_test(12, 2) - 0.012939) < 1e-5, f"sign test 12-2 p = {sign_test(12, 2):.6f}")
    check(sign_test(0, 0) == 1.0, "sign test with no decisive games = 1.0")
    lo, hi = bootstrap_ci([0.1, 0.2, 0.3, 0.4])
    check(0.1 <= lo <= 0.25 <= hi <= 0.4, f"bootstrap CI [{lo:.3f}, {hi:.3f}] brackets the mean")
    w, l, same, _ = paired(cand, base)
    check((w, l, same) == (1, 0, 2), f"old paired W/L/identical = {w}/{l}/{same} (expected 1/0/2)")
    print("selftest " + ("passed" if ok else "FAILED"))
    return 0 if ok else 1


def main(argv):
    global AT
    mode = "table"
    thresh = 3
    old = False
    while argv and argv[0].startswith("--"):
        if argv[0] == "--at":
            AT = int(argv[1]); argv = argv[2:]
        elif argv[0] == "--verdict":
            mode = "verdict"; thresh = int(argv[1]); argv = argv[2:]
        elif argv[0] in ("--fitness", "--ladder"):
            mode = argv[0][2:]; argv = argv[1:]
        elif argv[0] == "--old-fitness":
            old = True; argv = argv[1:]
        elif argv[0] == "--selftest":
            return selftest()
        else:
            print(f"unknown option {argv[0]}"); return 2
    if not argv:
        print(__doc__)
        return 2
    d = argv[0]
    names = argv[1:] or discover(d)
    if not names and AT is not None:
        names = sorted({os.path.basename(f)[2:].rsplit("_", 2)[0] for f in glob.glob(os.path.join(d, "p_*_*_*.txt"))})
    if not names:
        print(f"no ab30_*.txt files in {d}")
        return 1
    if mode == "fitness":
        fitness_json(d, names, old)
    elif mode == "verdict":
        if len(names) < 2:
            print("--verdict needs a baseline and at least one candidate")
            return 2
        return verdict(d, names, thresh)
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

# PlaybookBot lab: running bot A/B sweeps on Hetzner (or locally)

Handoff notes for an agent who needs to measure a bot change. Companion to
`docs/PlaybookBotGUI.md` (watching the bot play). Everything here is offline
simulation; never point the bot at openfront.io.

Verified end-to-end 2026-08-29: a 4-config, 120-game, 20-minute sweep on one
`cpx51` finished in ~25 minutes for about €0.04.

## TL;DR

```bash
cd ~/Code/openfront                                     # branch playbook-bot
OUT=/some/dir; mkdir -p $OUT
CONFIGS='{"base":{},"early":{"botsAfterWild":false},"es25":{"botEarlyShare":0.25}}'
nohup env CONFIGS="$CONFIGS" MINUTES=20 SERVER_TYPE=cpx51 KEEP=1 DEST=$OUT \
  scripts/lab/remote.sh > $OUT/remote.log 2>&1 &
# ... ~25 min for 120 games; "results in ..." in remote.log marks success
python3 <summarizer> base early es25                     # see "Reading results"
hcloud server delete openfront-lab                       # when Josh says so
```

## What a sweep is

- One **game** = `tests/lab/playbook.lab.test.ts` run once. The bot plays a
  single-player World map against real nations and 400 tribes for `MIN`
  minutes of game time, headless, and writes a transcript ending in

  ```
  == africa | spawn 1215,420 (bot picker rank 0) | Hard == FINAL rank=4 share=0.89 alive=true tiles=6992 troops=193k cities=1 ports=0 ...
  ```

- One **config** = a JSON object of `PlaybookParams` overrides, run over the
  standard **30-game grid**: 6 spawn regions × 5 batches. **Since 2026-08-29
  the default grid is Medium-only** (`med0`–`med4` = Medium, spawn rank 0–4):
  Josh's rule is to develop on Medium until the bot is strong, then move to
  Hard. `hard0`–`hard9` still work via `BATCHES="hard0 hard1 ..."`. Same grid
  for every config, so games pair up one-to-one.
- A **sweep** = several configs on that grid. Always include the current
  default (`{}`) as the baseline in the same sweep — don't compare against an
  older run.

The sim is deterministic and single-threaded: throughput scales linearly with
cores. A 20-minute game takes 85–100 s of CPU on a shared vCPU; games where the
bot dies finish sooner.

## Lab test env vars

| Var | Meaning |
| --- | --- |
| `PARAMS` | JSON merged over `DEFAULT_PLAYBOOK`, e.g. `{"botsAfterWild":false}` |
| `MIN` | game length in minutes (default 20) |
| `DIFF` | `medium`; anything else is Hard |
| `SPAWN` | `north-russia north-america east-asia africa south-america australia` |
| `SPAWNRANK` | k-th best spawn in the region; each pick excludes a 120-tile circle around earlier ones |
| `TRIBES` | tribe count (default 400 = public default) |
| `LAB_OUT` | output directory (must exist) |
| `OUTFILE` | file name inside `LAB_OUT` |

Single game by hand (≈10 s at `MIN=1`):

```bash
mkdir -p /tmp/lab && PARAMS='{"fightAbove":0.6}' MIN=1 SPAWN=africa LAB_OUT=/tmp/lab OUTFILE=x.txt \
  npx vitest tests/lab/playbook.lab.test.ts --run
```

## Hetzner setup (exists; do not redo)

- `hcloud` CLI (`brew install hcloud`) with context `openfront` holding the API
  token. `hcloud context active` must print `openfront`. The human creates the
  context and pastes the token; agents never handle it.
- SSH key `josh-lab` in the project = `~/.ssh/id_ed25519.pub` (`remote.sh`
  uploads it if missing).
- **Account limit:** dedicated-vCPU (CCX) servers are refused —
  `dedicated core limit exceeded`. **Use `cpx51`** (16 shared vCPU, 32 GB,
  ≈€0.09/h). For more throughput run two boxes with different `NAME`s, or ask
  Hetzner support to raise the CCX limit.

## `scripts/lab/remote.sh` — what it does

1. Ensures the SSH key exists in Hetzner.
2. Creates `NAME` (`ubuntu-24.04`, `LOCATION`, cloud-init installs Node 24) and
   waits for `/root/.lab-ready`. With `REUSE=1` it skips this and uses the
   running server called `NAME`.
3. `rsync`s **26 MB** to `/root/openfront`: `src`, `tests`, package files,
   `resources/maps/world/manifest.json`, lang JSON. The `.bin` maps come from
   `tests/testdata`. Do not widen the includes — the full tree is 2.2 GB
   (`resources/maps` alone is 510 MB) and the first attempt sat idle for seven
   minutes uploading it.
4. `npm run inst` on the box if `node_modules` is missing (~1 min).
5. Launches `scripts/lab/sweep.sh` on the box with `nohup`, logging to
   `/root/lab-out/sweep.log`, and polls once a minute printing
   `HH:MM N done, M failed`. A dropped ssh or a killed local shell cannot stop
   the sweep; if the local script dies, just rsync `/root/lab-out/` yourself.
6. `rsync`s `/root/lab-out/` to `DEST`.
7. Deletes the server unless `KEEP=1`.

| Env | Default | Notes |
| --- | --- | --- |
| `CONFIGS` | required | JSON name → params. Use `{}` for the baseline. |
| `MINUTES` | 20 | game length |
| `SERVER_TYPE` | ccx53 | **pass `cpx51`** on this account |
| `LOCATION` | ash | Ashburn |
| `NAME` | openfront-lab | server name |
| `DEST` | ./lab-out | local results dir |
| `KEEP` | 0 | 1 = leave the server running |
| `REUSE` | 0 | 1 = use the existing server; rsync is incremental, so a rerun after a bot edit starts in seconds |

Run it under `nohup … &` from a tool call — it runs longer than any tool
timeout. Watch `remote.log`; `results in …` means success.

**Timing** (cpx51, 16 parallel): 120 × 20-min games ≈ 25 min; 90 games ≈ 18
min. Shared vCPUs slow down a little under full load (load avg ~18 on 16).

**Verify before you trust a sweep:**

```bash
ls $DEST | grep -c '^p_'                 # expect configs × 30
grep -L FINAL $DEST/p_*.txt              # should print nothing
grep -c '^FAILED' $DEST/sweep.log        # should be 0
```

A game that fails to run leaves no `p_*.txt` and prints `FAILED cfg batch
spawn` in `sweep.log`. To see why, run one game by hand on the box with the
same env and read vitest's output.

## `scripts/lab/sweep.sh` — the box-side runner

Builds a job list (config × batch × spawn), runs it with `xargs -0 -P JOBS`,
then aggregates each config/batch into `ab30_<config>_<batch>.txt` (one FINAL
line per spawn — the same format as the older local `ab30.sh`, so existing
summarizers work).

Env: `CONFIGS`, `MINUTES` (20), `JOBS` (`nproc`; **pass it explicitly on
macOS**), `OUT` (./lab-out), `BATCHES` (default `med0 … med4`; `hardN`/`medN`
for any rank N) and `SPAWNS` to run a subset.

Gotcha already fixed, worth knowing: plain `xargs` strips double quotes from
its input, which turned `{"botsAfterWild":false}` into `{botsAfterWild:false}`
and made every non-empty config fail to parse while the `{}` baseline ran
fine. The job list is NUL-delimited now. If you ever see one config succeed and
all others `FAILED`, suspect quoting.

Local use (fallback; keep it small, the Mac is also the GUI machine):

```bash
CONFIGS='{"smoke":{}}' MINUTES=1 JOBS=1 BATCHES=hard0 SPAWNS=africa OUT=/tmp/smoke scripts/lab/sweep.sh   # 10-s smoke test
CONFIGS='{"base":{}}' MINUTES=20 JOBS=10 OUT=/tmp/lab scripts/lab/sweep.sh                                # ~10 min
```

## Output layout

```
lab-out/
  sweep.log                          done/FAILED per game (box side)
  p_<config>_<batch>_<spawn>.txt     full transcript of one game
  ab30_<config>_<batch>.txt          6 FINAL lines, one per spawn
```

## Reading results

Minimal loader:

```python
import re, glob
def load(d, cfg):
    g = {}
    for f in glob.glob(f"{d}/ab30_{cfg}_*.txt"):
        batch = f.split("_")[-1][:-4]
        for line in open(f):
            m = re.search(r"== (\S+) .*\| (\w+) ==.*alive=(\w+) tiles=(\d+)", line)
            if m: g[(batch, m.group(1))] = dict(diff=m.group(2), alive=m.group(3) == "true", tiles=int(m.group(4)))
    return g
```

Then, for each config against the baseline:

- **Pair by (batch, region)** — same spawn, same opponents. Count wins,
  losses and **identical** pairs. Identical means the parameter never
  triggered; those games carry no information.
- **Print the biggest swings.** One outlier can make a total look decisive
  (+16 % land once came from a single +81k game; without it, +3 %).
- **Don't mix Hard and Medium in one total.** Medium land totals are dominated
  by a few snowball games swinging ±200k tiles; compare medians and pair
  counts, not sums.
- Ten-minute games only test the opening. Use ≥20 min for anything touching
  cities, ports, rail or wars (`fightNotBeforeTick` = 3000 ticks = 5 min).
- Write the verdict and sample size next to the parameter in
  `DEFAULT_PLAYBOOK`, as the existing comments do, and note which sweep
  (date, box, minutes) produced it.

## Clean up

```bash
hcloud server list                 # must be empty when you are done
hcloud server delete openfront-lab
```

Josh wants to be told before a delete. A forgotten cpx51 costs ~€2/day.

## Spawn picker: what the data says (2026-08-30)

`tests/lab/spawnfeat.lab.test.ts` dumps the picker's features for a list of
coordinates (`SPAWNS="x,y;x,y" LAB_OUT=dir OUTFILE=f.json`); joined with 288
Medium 20-min games over 67 spawns (`lab-out/outcomes.json`):

- No feature correlates linearly with land (all |ρ| ≤ 0.17); the picker's own
  score scored ρ = +0.04. A soft basin slope (`pk1`) changed 3/30 picks and
  nothing else.
- Thresholds do separate: land-connected basin within 120 tiles < 3k → median
  15k tiles vs 64k (vetoed); < 6k → 33k (−6). Nations within 300 ≥ 12 → 33k vs
  59k (−4), ≥ 16 (−8), ≥ 20 → 2k (vetoed). Tribes within 150 ≥ 15 → 71k vs 48k
  (existing +3/tribe term). Sandwich term: no effect.
- Spawn identity explains most variance (between-spawn sd 0.92 of 1.21), but
  through which nations are adjacent and how they behave, not geometry — so
  don't expect a static scorer to rank the top 20 correctly on Medium.
- Use the global ladder (`BATCHES="g0 g1 g2 g3 g4"`) to test a picker change:
  it walks the picker's own ranks 0–29. **Beware confounds**: a ladder run
  after any other bot commit is not comparable to one run before it (pk0 vs
  pk2 was confounded this way).

## History of the tribe-timing question (for context)

`botsAfterWild` = don't eat tribes while wilderness borders you unless the
click is ≤ `botEarlyShare` of spendable troops. A 6-game 10-min test favoured
*off* (117k vs 97k land); a 30-game 10-min A/B favoured *on* (+16 % land but
9 wins / 7 losses / 14 identical, one outlier). The 20-min Hetzner sweep of
2026-08-29 (`jbase`, `jearly`, `jes25`, `jes35`) is the current evidence — its
results and verdict live next to the parameter in `PlaybookBotExecution.ts`.

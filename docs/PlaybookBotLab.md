# PlaybookBot lab: running bot A/B sweeps (local and on Hetzner)

Handoff notes for an agent who needs to measure a bot change. Companion to
`docs/PlaybookBotGUI.md` (watching the bot play). Everything here is offline
simulation; never point the bot at openfront.io.

## What a "sweep" is

One **game** = `tests/lab/playbook.lab.test.ts` run once with env vars: the bot
plays a single-player World map against real nations and 400 tribes for `MIN`
minutes of game time, headless, then writes a transcript to
`$LAB_OUT/$OUTFILE` whose last line looks like

```
== africa | spawn 1215,420 (bot picker rank 0) | Hard == FINAL rank=4 share=0.89 alive=true tiles=6992 troops=193k cities=1 ports=0 ...
```

One **config** = one set of `PlaybookParams` overrides (JSON), run over the
standard **30-game grid**: 6 spawn regions × 5 batches
(`hard0/hard1/hard2` = Hard, spawn rank 0/1/2; `med0/med1` = Medium, rank 0/1).
Same grid for every config, so results pair up game-for-game.

A **sweep** = several configs on that grid, e.g. a baseline and three
variations. Compare pairwise, not just totals — see "Reading results".

The sim is deterministic and single-threaded, so throughput scales linearly
with cores. A 20-minute game simulates in ~90 s on one shared vCPU.

## Env vars the lab test understands

| Var | Meaning |
| --- | --- |
| `PARAMS` | JSON object merged over `DEFAULT_PLAYBOOK` (e.g. `{"botsAfterWild":false}`) |
| `MIN` | game length in minutes (default 20) |
| `DIFF` | `medium`, otherwise Hard |
| `SPAWN` | region: `north-russia north-america east-asia africa south-america australia` |
| `SPAWNRANK` | k-th best spawn in the region (0, 1, 2 …), each pick excludes a 120-tile circle around earlier ones |
| `TRIBES` | tribe count (default 400, the public default) |
| `LAB_OUT` | output directory (default: the original lab session's scratchpad) |
| `OUTFILE` | file name inside `LAB_OUT` |
| `EXPAND`, `EVERY`, `ALLIN`, `KEEP` | shortcuts for a few opening params (see the test) |

Single game, by hand:

```bash
PARAMS='{"fightAbove":0.6}' MIN=10 SPAWN=africa LAB_OUT=/tmp/lab OUTFILE=x.txt \
  npx vitest tests/lab/playbook.lab.test.ts --run
```

## Remote sweep on Hetzner (preferred)

Scripts live in `scripts/lab/` on the `playbook-bot` branch.

### One-time setup (already done on Josh's Mac)

- `brew install hcloud`; a context named `openfront` holds the API token
  (`hcloud context create openfront` — the human pastes the token; agents never
  handle it). `hcloud context active` should print `openfront`.
- SSH key `josh-lab` in the Hetzner project = `~/.ssh/id_ed25519.pub`
  (`remote.sh` uploads it if missing).
- **Account limit:** this account cannot create dedicated-vCPU (CCX) servers —
  `ccx53` fails with `dedicated core limit exceeded`. Use the shared line:
  `cpx51` = 16 vCPU / 32 GB ≈ €0.09/h works. Ask Hetzner support for a limit
  raise if you want CCX; or run several cpx51s with different `NAME`s.

### Run

```bash
cd ~/Code/openfront          # branch playbook-bot
CONFIGS='{"base":{},"early":{"botsAfterWild":false},"es25":{"botEarlyShare":0.25}}' \
MINUTES=20 SERVER_TYPE=cpx51 KEEP=1 DEST=/path/for/results scripts/lab/remote.sh
```

`remote.sh` does, in order: ensure SSH key → create server (`ubuntu-24.04`,
cloud-init installs Node 24) → wait for `/root/.lab-ready` → rsync the tree
(**26 MB**: `src`, `tests`, package files, `resources/maps/world/manifest.json`,
lang JSON — the `.bin` maps come from `tests/testdata`; do not widen the
excludes, the full tree is 2 GB and stalls the box for minutes) → `npm run
inst` → `scripts/lab/sweep.sh` on the box → rsync `/root/lab-out` to `DEST` →
delete the server unless `KEEP=1`.

Env: `CONFIGS` (required), `MINUTES` (20), `SERVER_TYPE` (ccx53; use cpx51),
`LOCATION` (ash), `NAME` (openfront-lab), `DEST` (./lab-out), `KEEP=1` keep the
box, `REUSE=1` use the running box named `NAME` (skips create + cloud-init;
rsync is incremental, so re-running after a bot edit costs seconds).

Timing on a cpx51: 120 games × 20 min ≈ **12 minutes** wall clock (8 waves of
16 games at ~95 s each). Cost ≈ €0.02.

Run it detached — it outlives a tool-call timeout:

```bash
nohup env CONFIGS=... MINUTES=20 SERVER_TYPE=cpx51 KEEP=1 REUSE=1 DEST=$OUT \
  scripts/lab/remote.sh > $OUT/remote.log 2>&1 &
```

and poll `remote.log` (`results in …` marks success) or
`ssh root@<ip> 'ls /root/lab-out | grep -c ^p_'` for games done.

### Always clean up

```bash
hcloud server list            # nothing should be left running when you finish
hcloud server delete openfront-lab
```

Josh wants a heads-up before a delete; a forgotten cpx51 costs ~€2/day.

## Local sweep (fallback)

`scripts/lab/sweep.sh` is the same runner and works on macOS too — pass `JOBS`
explicitly (there is no `nproc`):

```bash
CONFIGS='{"base":{}}' MINUTES=20 JOBS=10 OUT=/tmp/lab scripts/lab/sweep.sh
```

Smoke test (one 1-minute game, ~10 s):

```bash
CONFIGS='{"smoke":{}}' MINUTES=1 JOBS=1 BATCHES=hard0 SPAWNS=africa OUT=/tmp/smoke scripts/lab/sweep.sh
```

Don't run two big sweeps on the Mac at once; two sessions doing that is what
sent the work to Hetzner in the first place.

## Output layout

```
lab-out/
  p_<config>_<batch>_<spawn>.txt     full transcript, one game
  ab30_<config>_<batch>.txt          6 lines, one FINAL line per spawn
```

The `ab30_*` format is identical to the older local `ab30.sh` runner, so the
existing summarizers (`ab30sum.py`, `tribesum.py` in session scratchpads) read
both. A minimal summarizer:

```python
import re, glob
def load(d, cfg):
    g = {}
    for f in glob.glob(f"{d}/ab30_{cfg}_*.txt"):
        batch = f.split("_")[-1][:-4]
        for line in open(f):
            m = re.search(r"== (\S+) .*alive=(\w+) tiles=(\d+)", line)
            if m: g[(batch, m.group(1))] = (m.group(2) == "true", int(m.group(3)))
    return g
```

## Reading results (how not to fool yourself)

- **Pair games**, don't compare totals. Same (batch, region) key = same spawn
  and same opponents; count wins / losses / identical pairs. Identical pairs
  mean the parameter never triggered — they are wasted samples, not evidence.
- **Look at the biggest swings.** A +16 % land total once came from a single
  Medium game (+81k tiles); without it the effect was +3 %.
- **Split Hard vs Medium.** Survival on Hard and land on Medium measure
  different things.
- **Game length matters.** 10-minute games only test the opening; use 20–30 min
  for anything about cities, ports, rail, or wars (`fightNotBeforeTick` is 3000
  = 5 min).
- Record the verdict next to the parameter in `DEFAULT_PLAYBOOK` with the
  sample size, as the existing comments do.

## Known history of the tribe-timing question

`botsAfterWild` (don't eat tribes while wilderness borders you, unless the
click is ≤ `botEarlyShare` of spendable troops): a 6-game 10-min test said
*off* is better (117k vs 97k land); a 30-game 10-min A/B said *on* (+16 %, but
9 wins / 7 losses / 14 identical and one outlier game). The 20-min 4-config
sweep on Hetzner (2026-08-29: `jbase`, `jearly`, `jes25`, `jes35`) is the
current evidence — see the session scratchpad `lab-out/` and `tribesum.py`.

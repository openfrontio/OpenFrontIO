#!/usr/bin/env bash
# Ladder: run one candidate PlaybookParams set against the last three stored
# versions on the standard 30-game Medium grid and print a Bradley–Terry table.
#
#   scripts/lab/ladder.sh '{"fightAbove":0.6}'                 # candidate as a JSON string ...
#   scripts/lab/ladder.sh lab-out/cma/best.json                # ... or a file ({...} or {"params":{...}})
#   RUNNER=local JOBS=8 MINUTES=1 scripts/lab/ladder.sh '{}'   # local smoke run
#
# Versions live in scripts/lab/versions/: v-current.json (always included; the
# empty override = the code's DEFAULT_PLAYBOOK) plus vN.json for every set that
# graduated earlier. The two highest N join v-current to make three opponents.
# Each file is {"note": "...", "params": {...}}.
#
# Env: RUNNER (remote = scripts/lab/remote.sh on Hetzner, default; local =
# scripts/lab/sweep.sh), MINUTES (30 — graduation length; 20-minute games
# truncate the endgame), SHIFT (150 — moves every spawn region by that many
# tiles, tests/lab/playbook.lab.ts reads it, so a candidate is confirmed on a
# grid it was not tuned on; SHIFT=0 for the tuning grid), DEST (results dir,
# default lab-out/ladder-<timestamp>), NAME_CAND (config name, default
# "cand"), plus everything remote.sh / sweep.sh accept (SERVER_TYPE, KEEP,
# REUSE, JOBS, BATCHES ...). SERVER_TYPE defaults to cpx51 here.
#
# SHIFT reaches the games through the environment: sweep.sh's game processes
# inherit it, so RUNNER=local honours it. remote.sh (as of 2026-08-30) builds
# the box's env list by hand (CONFIGS MINUTES SHARD BATCHES SPAWNS JOBS) and
# does NOT forward SHIFT — a remote ladder runs on the unshifted grid until
# remote.sh passes it through (see docs/PlaybookBotPlan.md "Scoring").
#
# Prints summarize.py's table (old fitness `fit_old` and the new score side
# by side, live-game paired stats with a verdict) and the Bradley–Terry ladder.
set -euo pipefail
cd "$(dirname "$0")/../.."
cand=${1:?usage: ladder.sh '<json>' | file.json}
RUNNER=${RUNNER:-remote}
MINUTES=${MINUTES:-30}
SHIFT=${SHIFT:-150}
export SHIFT
DEST=${DEST:-$PWD/lab-out/ladder-$(date +%Y%m%d-%H%M)}
NAME_CAND=${NAME_CAND:-cand}
VDIR=scripts/lab/versions

if [ -f "$cand" ]; then cand_json=$(cat "$cand"); else cand_json=$cand; fi

# version files: v-current + the two highest vN
versions="$VDIR/v-current.json"
for f in $(ls "$VDIR"/v[0-9]*.json 2>/dev/null | sort -V | tail -2); do versions="$versions $f"; done

CONFIGS=$(node -e '
  const fs = require("fs");
  const unwrap = (o) => (o && typeof o === "object" && "params" in o ? o.params : o);
  const out = {}; out[process.argv[2]] = unwrap(JSON.parse(process.argv[3]));
  for (const f of process.argv.slice(4)) {
    const name = f.split("/").pop().replace(/\.json$/, "");
    out[name] = unwrap(JSON.parse(fs.readFileSync(f, "utf8")));
  }
  console.log(JSON.stringify(out));
' _ "$NAME_CAND" "$cand_json" $versions)
names=$(node -e 'console.log(Object.keys(JSON.parse(process.argv[1])).join(" "))' "$CONFIGS")

echo "ladder: $names  ($MINUTES min, $RUNNER, SHIFT=$SHIFT) -> $DEST"
if [ "$RUNNER" != local ] && [ "$SHIFT" != 0 ]; then echo "note: remote.sh does not forward SHIFT to the box; this ladder runs on the unshifted grid"; fi
echo "CONFIGS=$CONFIGS"
mkdir -p "$DEST"
if [ "$RUNNER" = local ]; then
  CONFIGS="$CONFIGS" MINUTES="$MINUTES" SHIFT="$SHIFT" OUT="$DEST" bash scripts/lab/sweep.sh
else
  CONFIGS="$CONFIGS" MINUTES="$MINUTES" SHIFT="$SHIFT" DEST="$DEST" SERVER_TYPE="${SERVER_TYPE:-cpx51}" bash scripts/lab/remote.sh
fi
echo
echo "== per-config table: fit_old = alive+share+top3, score = land+rank+crown; live-game paired stats vs $NAME_CAND =="
python3 scripts/lab/summarize.py "$DEST" $names
echo
echo "== Bradley-Terry ladder (pairs by alive, tiles) =="
python3 scripts/lab/summarize.py --ladder "$DEST" $names

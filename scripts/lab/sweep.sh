#!/usr/bin/env bash
# Box-side lab sweep. Runs every (config × batch × spawn) game in parallel with the bare-node runner
# (tests/lab/playbook.lab.ts), retries a failed game once, and aggregates each config/batch into
# ab30_<config>_<batch>.txt via aggregate.sh (the format summarize.py reads).
#
#   CONFIGS='{"base":{},"early":{"botsAfterWild":false}}' MINUTES=20 JOBS=16 scripts/lab/sweep.sh
#
# Env: CONFIGS (JSON name -> PlaybookParams overrides), MINUTES (game length, default 20), JOBS (parallel
# games, default nproc — pass it explicitly on macOS), OUT (result dir, default ./lab-out), BATCHES /
# SPAWNS (subset of the grid), SHARD=i/N (run only every N-th game, i in 0..N-1 — remote.sh gives each
# worker box one shard of the same job list; the results directories are merged and aggregated locally),
# RUNNER=node|vitest (default node; vitest = the old `npx vitest` path, ~2 s slower a game),
# AGGREGATE=0 to skip aggregation (remote.sh aggregates after merging shards).
set -euo pipefail
cd "$(dirname "$0")/../.."
MINUTES=${MINUTES:-20}
JOBS=${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}
OUT=${OUT:-$PWD/lab-out}
RUNNER=${RUNNER:-node}
SHARD=${SHARD:-0/1}
mkdir -p "$OUT"
: "${CONFIGS:?set CONFIGS to a JSON object of name -> params}"

SPAWNS=${SPAWNS:-"north-russia north-america east-asia africa south-america australia"}
# Medium-only until the bot is strong (Josh, 2026-08-29): 6 regions x spawn ranks 0-4.
# Hard batches (hard0..hard4) still work when asked for via BATCHES.
BATCHES=${BATCHES:-"med0 med1 med2 med3 med4"}
names=$(node -e "for (const k of Object.keys(JSON.parse(process.argv[1]))) console.log(k)" "$CONFIGS")

# Job list in a fixed order (config, batch, spawn) so every shard of the same CONFIGS agrees on numbering.
jobs_file=$(mktemp)
i=0; shard_i=${SHARD%/*}; shard_n=${SHARD#*/}
for name in $names; do
  params=$(node -e "console.log(JSON.stringify(JSON.parse(process.argv[1])[process.argv[2]]))" "$CONFIGS" "$name")
  for batch in $BATCHES; do
    for sp in $SPAWNS; do
      [ $((i % shard_n)) -eq "$shard_i" ] && echo "$name|$batch|$sp|$params" >> "$jobs_file"
      i=$((i + 1))
    done
  done
done
echo "sweep: $(wc -l < "$jobs_file") games (shard $SHARD of $i), $JOBS parallel, $MINUTES min each, runner $RUNNER -> $OUT"

export MINUTES OUT RUNNER
# NUL-delimited: plain xargs strips the quotes out of the JSON params
tr '\n' '\0' < "$jobs_file" | xargs -0 -P "$JOBS" -I{} bash -c '
  IFS="|" read -r name batch sp params <<< "$1"
  case $batch in
    hard[0-9]) benv="SPAWNRANK=${batch#hard}";;
    med[0-9]) benv="DIFF=medium SPAWNRANK=${batch#med}";;
    g[0-9]) benv="GLOBAL=1 DIFF=medium SPAWNRANK=${batch#g}";;      # global picker ranks 6k..6k+5 (Medium)
    gh[0-9]) benv="GLOBAL=1 SPAWNRANK=${batch#gh}";;                # same on Hard
    *) echo "unknown batch $batch"; exit 1;;
  esac
  run() {
    if [ "$RUNNER" = vitest ]; then
      # --dir tests: a bare path filter also matches copies under .claude/worktrees/ (one game per copy)
      env $benv PARAMS="$params" MIN="$MINUTES" SPAWN="$sp" LAB_OUT="$OUT" OUTFILE="p_${name}_${batch}_${sp}.txt" TAG="${name}_${batch}" \
        npx vitest --dir tests tests/lab/playbook.lab.test.ts --run > "$OUT/.err_${name}_${batch}_${sp}" 2>&1
    else
      env $benv PARAMS="$params" MIN="$MINUTES" SPAWN="$sp" LAB_OUT="$OUT" OUTFILE="p_${name}_${batch}_${sp}.txt" TAG="${name}_${batch}" \
        node --import tsx tests/lab/playbook.lab.ts > "$OUT/.err_${name}_${batch}_${sp}" 2>&1
    fi
  }
  if run || { echo "retry $name $batch $sp"; run; }; then rm -f "$OUT/.err_${name}_${batch}_${sp}"; echo "done $name $batch $sp"
  else echo "FAILED $name $batch $sp (see $OUT/.err_${name}_${batch}_${sp})"; fi' _ {}

rm -f "$jobs_file" "$OUT/lab_baseline.txt"
if [ "${AGGREGATE:-1}" = 1 ]; then bash scripts/lab/aggregate.sh "$OUT"; fi
echo "sweep complete"

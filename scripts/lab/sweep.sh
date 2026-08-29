#!/usr/bin/env bash
# Box-side lab sweep. Runs every (config × batch × spawn) game in parallel and
# aggregates each config/batch into ab30_<config>_<batch>.txt (same format the
# local ab30.sh produces, so the summarizers work unchanged).
#
#   CONFIGS='{"base":{},"early":{"botsAfterWild":false}}' MINUTES=20 JOBS=30 scripts/lab/sweep.sh
#
# Env: CONFIGS (JSON name -> PlaybookParams overrides), MINUTES (game length,
# default 20), JOBS (parallel games, default nproc), OUT (result dir, default ./lab-out).
set -euo pipefail
cd "$(dirname "$0")/../.."
MINUTES=${MINUTES:-20}
JOBS=${JOBS:-$(nproc)}
OUT=${OUT:-$PWD/lab-out}
mkdir -p "$OUT"
: "${CONFIGS:?set CONFIGS to a JSON object of name -> params}"

SPAWNS=${SPAWNS:-"north-russia north-america east-asia africa south-america australia"}
BATCHES=${BATCHES:-"hard0 hard1 hard2 med0 med1"}
names=$(node -e "for (const k of Object.keys(JSON.parse(process.argv[1]))) console.log(k)" "$CONFIGS")

jobs_file=$(mktemp)
for name in $names; do
  params=$(node -e "console.log(JSON.stringify(JSON.parse(process.argv[1])[process.argv[2]]))" "$CONFIGS" "$name")
  for batch in $BATCHES; do
    for sp in $SPAWNS; do echo "$name|$batch|$sp|$params" >> "$jobs_file"; done
  done
done
echo "sweep: $(wc -l < "$jobs_file") games, $JOBS parallel, $MINUTES min each -> $OUT"

# one game per line; batch -> env uses the same scheme as ab30.sh
export MINUTES OUT
xargs -P "$JOBS" -I{} bash -c '
  IFS="|" read -r name batch sp params <<< "$1"
  case $batch in
    hard0) benv="SPAWNRANK=0";; hard1) benv="SPAWNRANK=1";; hard2) benv="SPAWNRANK=2";;
    med0) benv="DIFF=medium SPAWNRANK=0";; med1) benv="DIFF=medium SPAWNRANK=1";;
    *) echo "unknown batch $batch"; exit 1;;
  esac
  if env $benv PARAMS="$params" MIN="$MINUTES" SPAWN="$sp" LAB_OUT="$OUT"        OUTFILE="p_${name}_${batch}_${sp}.txt" TAG="${name}_${batch}"        npx vitest tests/lab/playbook.lab.test.ts --run > /dev/null 2>&1
  then echo "done $name $batch $sp"; else echo "FAILED $name $batch $sp"; fi' _ {} < "$jobs_file"

# aggregate: one line per game, ab30 format
for name in $names; do
  for batch in $BATCHES; do
    agg="$OUT/ab30_${name}_${batch}.txt"; : > "$agg"
    for sp in $SPAWNS; do
      f="$OUT/p_${name}_${batch}_${sp}.txt"
      [ -f "$f" ] && grep -E "^==|DEAD|FINAL" "$f" | tr '\n' ' ' | sed -E 's/  +/ /g' >> "$agg" && echo >> "$agg"
    done
  done
done
rm -f "$jobs_file"
echo "sweep complete"

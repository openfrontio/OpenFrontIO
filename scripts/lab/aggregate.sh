#!/usr/bin/env bash
# Aggregate one sweep's p_<config>_<batch>_<spawn>.txt transcripts into ab30_<config>_<batch>.txt
# (one "== ... == FINAL ..." line per spawn — the format summarize.py reads). Idempotent; run it
# again after more shards land in the same directory.
#
#   scripts/lab/aggregate.sh lab-out            # infers configs/batches/spawns from the file names
set -euo pipefail
OUT=${1:?usage: aggregate.sh <results dir>}
cd "$OUT"
shopt -s nullglob
files=(p_*_*_*.txt)
[ ${#files[@]} -gt 0 ] || { echo "no p_*.txt in $OUT"; exit 1; }
rm -f ab30_*_*.txt
for f in "${files[@]}"; do
  rest=${f#p_}; rest=${rest%.txt}
  rest=${rest%_*}                       # drop spawn
  batch=${rest##*_}; name=${rest%_*}
  grep -E "^==|DEAD|FINAL" "$f" | tr '\n' ' ' | sed -E 's/  +/ /g' >> "ab30_${name}_${batch}.txt"
  echo >> "ab30_${name}_${batch}.txt"
done
echo "aggregated ${#files[@]} games into $(ls ab30_*_*.txt | wc -l | tr -d ' ') config/batch files in $OUT"

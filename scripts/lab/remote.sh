#!/usr/bin/env bash
# Run a lab sweep on throwaway Hetzner Cloud servers — one box or a pool of WORKERS boxes that each take
# one shard of the same job list (scripts/lab/sweep.sh SHARD=i/N). Results are merged locally.
#
#   CONFIGS='{"base":{},"early":{"botsAfterWild":false}}' MINUTES=20 WORKERS=4 scripts/lab/remote.sh
#
# Env: CONFIGS, MINUTES (20), WORKERS (1), SERVER_TYPE (cpx51 — dedicated CCX types are refused on this
# account), LOCATION (ash), NAME (openfront-lab; workers are NAME-1..N when WORKERS>1), IMAGE (snapshot
# id/name from scripts/lab/snapshot.sh; "auto" = newest snapshot labelled lab-image=1, "none" = plain
# ubuntu-24.04 + cloud-init; default auto), DEST (local results dir, default ./lab-out), KEEP=1 to leave
# the boxes running, REUSE=1 to use running boxes with those names, BATCHES / SPAWNS / JOBS pass through
# to sweep.sh; STAGED=1 runs the first STAGE1 (3) batches, then the rest only for an unclear verdict
# (summarize.py --verdict VERDICT, default 3). Needs: hcloud CLI with a context selected, ~/.ssh/id_ed25519(.pub), rsync.
#
# Every box carries the labels lab=1,pool=NAME:  hcloud server list -l lab=1  shows strays;
#   hcloud server delete $(hcloud server list -l lab=1 -o noheader -o columns=name)  removes them all.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${CONFIGS:?set CONFIGS}"
MINUTES=${MINUTES:-20}
WORKERS=${WORKERS:-1}
SERVER_TYPE=${SERVER_TYPE:-cpx51}
LOCATION=${LOCATION:-ash}
NAME=${NAME:-openfront-lab}
IMAGE=${IMAGE:-auto}
DEST=${DEST:-$PWD/lab-out}
KEY_NAME=${KEY_NAME:-$(whoami)-lab}
# Throwaway boxes get recycled IPs, so host keys are neither pinned nor remembered.
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes"
SSH="ssh $SSH_OPTS -o ConnectTimeout=10 root"
TIMEOUT=$(command -v timeout >/dev/null && echo "timeout 60" || true)   # coreutils; brew install coreutils on macOS
RSYNC_SSH="ssh $SSH_OPTS"

if [ "$WORKERS" -eq 1 ]; then names=("$NAME"); else names=(); for i in $(seq 1 "$WORKERS"); do names+=("$NAME-$i"); done; fi

if ! hcloud ssh-key describe "$KEY_NAME" >/dev/null 2>&1; then
  hcloud ssh-key create --name "$KEY_NAME" --public-key-from-file ~/.ssh/id_ed25519.pub >/dev/null
fi

ARCH=$(hcloud server-type describe "$SERVER_TYPE" -o "format={{.Architecture}}")
if [ "$IMAGE" = auto ]; then
  IMAGE=$(hcloud image list --type snapshot -l lab-image=1 -a "$ARCH" -o noheader -o columns=id,created | sort -k2 | tail -1 | awk '{print $1}')
  [ -n "$IMAGE" ] || IMAGE=none
fi

declare -a ips
if [ "${REUSE:-0}" = 1 ]; then
  for n in "${names[@]}"; do ips+=("$(hcloud server ip "$n")"); done
  echo "reusing ${names[*]} (${ips[*]})"
else
  cat > /tmp/lab-cloud-init.yml <<'CI'
#cloud-config
package_update: true
packages: [rsync, git, build-essential]
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  - apt-get install -y nodejs
  - touch /root/.lab-ready
CI
  if [ "$IMAGE" = none ]; then
    echo "creating $WORKERS x $SERVER_TYPE in $LOCATION from ubuntu-24.04 (cloud-init installs Node; ~3 min) ..."
    for n in "${names[@]}"; do
      hcloud server create --name "$n" --type "$SERVER_TYPE" --image ubuntu-24.04 --location "$LOCATION" \
        --ssh-key "$KEY_NAME" --label lab=1 --label "pool=$NAME" --user-data-from-file /tmp/lab-cloud-init.yml >/dev/null &
    done
  else
    echo "creating $WORKERS x $SERVER_TYPE in $LOCATION from snapshot $IMAGE (~1 min) ..."
    for n in "${names[@]}"; do
      hcloud server create --name "$n" --type "$SERVER_TYPE" --image "$IMAGE" --location "$LOCATION" \
        --ssh-key "$KEY_NAME" --label lab=1 --label "pool=$NAME" >/dev/null &
    done
  fi
  wait
  for n in "${names[@]}"; do
    hcloud server describe "$n" >/dev/null 2>&1 || { echo "server $n was not created (see errors above; cpx51 exists only in ash/hil, cpx62/cx53 in the EU) — deleting the rest"; for m in "${names[@]}"; do hcloud server delete "$m" >/dev/null 2>&1 || true; done; exit 1; }
    ips+=("$(hcloud server ip "$n")")
  done
  echo "servers: ${names[*]} at ${ips[*]}; waiting for ssh/cloud-init ..."
  for ip in "${ips[@]}"; do until $SSH@"$ip" test -f /root/.lab-ready 2>/dev/null; do sleep 5; done; done
fi

echo "syncing tree to ${#ips[@]} box(es) ..."
sync_one() {
  # Only what the lab needs: sources, tests, package files, and the World map manifest (the .bin maps come
  # from tests/testdata). Everything else is 2 GB. .claude holds other agents' worktrees — full copies of the
  # tree that vitest's path filter would also run.
  rsync -az --delete -e "$RSYNC_SSH" \
    --include 'resources/' --include 'resources/maps/' --include 'resources/maps/world/' \
    --include 'resources/maps/world/manifest.json' --include 'resources/lang/' --include 'resources/lang/**' \
    --include 'resources/*.json' --exclude 'resources/**' \
    --exclude node_modules --exclude .git --exclude .claude --exclude static --exclude lab-out --exclude dist \
    --exclude map-generator --exclude proprietary --exclude docs --exclude '*.log' \
    ./ root@"$1":/root/openfront/
  # npm run inst when node_modules is missing or the lock file changed since the last install on this box
  $SSH@"$1" 'cd /root/openfront && { [ -d node_modules ] && cmp -s package-lock.json node_modules/.lab-lock; } || { npm run inst >/tmp/inst.log 2>&1 && cp package-lock.json node_modules/.lab-lock; }'
}
for ip in "${ips[@]}"; do sync_one "$ip" & done; wait

# Launch one shard per box, detached, so a dropped ssh session (or a killed local shell) cannot take the
# sweep down with it. /root/lab-out is cleared first: with REUSE a stale game from an earlier sweep with the
# same config name would otherwise be merged into this one.
# run_pool BATCHES: one sweep of the given batches over every box (one shard each), pulled into DEST.
run_pool() {
  local batches=$1 slug; slug=$(echo "$batches" | tr ' ' '-')
  echo "running sweep on ${#ips[@]} box(es) ..."
  # The launch runs in a subshell as a setsid/nohup'd background job, so sshd has nothing left to wait for
  # and ssh returns at once. (A bare `nohup … &` made ssh block until the whole sweep finished, which
  # serialised the shards.) `timeout` is belt and braces: a hung ssh cannot stall the other launches.
  i=0
  for ip in "${ips[@]}"; do
    $TIMEOUT $SSH@"$ip" "cd /root/openfront && rm -rf /root/lab-out && mkdir -p /root/lab-out && (setsid nohup env CONFIGS='$CONFIGS' MINUTES=$MINUTES SHARD=$i/${#ips[@]} AGGREGATE=0 BATCHES='$batches' ${SPAWNS:+SPAWNS='$SPAWNS'} ${JOBS:+JOBS=$JOBS} ${SHIFT:+SHIFT=$SHIFT} OUT=/root/lab-out bash scripts/lab/sweep.sh > /root/lab-out/sweep.log 2>&1 < /dev/null &); sleep 1; head -1 /root/lab-out/sweep.log" \
      || echo "WARNING: launch on $ip did not confirm; check /root/lab-out/sweep.log there"
    i=$((i + 1))
  done
  sleep 15
  running() { for ip in "${ips[@]}"; do $SSH@"$ip" 'pgrep -f "[s]cripts/lab/sweep.sh" >/dev/null' 2>/dev/null && return 0; done; return 1; }
  count() {
    local d=0 f=0 x
    for ip in "${ips[@]}"; do
      x=$($SSH@"$ip" 'grep -c "^done" /root/lab-out/sweep.log; true' 2>/dev/null); d=$((d + ${x:-0}))
      x=$($SSH@"$ip" 'grep -c "^FAILED" /root/lab-out/sweep.log; true' 2>/dev/null); f=$((f + ${x:-0}))
    done
    echo "$d done, $f failed"
  }
  while running; do echo "  $(date +%H:%M) $(count)"; sleep 60; done
  echo "  $(date +%H:%M) $(count) — finished"
  
  mkdir -p "$DEST"
  i=0
  for ip in "${ips[@]}"; do
    rsync -az -e "$RSYNC_SSH" --exclude sweep.log root@"$ip":/root/lab-out/ "$DEST"/
    rsync -az -e "$RSYNC_SSH" root@"$ip":/root/lab-out/sweep.log "$DEST"/sweep.$slug.$i.log
    i=$((i + 1))
  done
  cat "$DEST"/sweep.*.log > "$DEST"/sweep.log
  bash scripts/lab/aggregate.sh "$DEST"
}

BATCHES=${BATCHES:-"med0 med1 med2 med3 med4"}
if [ "${STAGED:-0}" = 1 ]; then
  # Staged A/B: run the first STAGE1 batches, and only run the rest when some config is still "unclear"
  # (|wins - losses| < VERDICT vs the first config). Clear winners and losers cost ~40 % fewer games.
  set -- $BATCHES; n=${STAGE1:-3}
  first=$(echo "$@" | cut -d' ' -f1-$n); rest=$(echo "$@" | cut -d' ' -f$((n + 1))-)
  run_pool "$first"
  cfgs=$(node -e 'console.log(Object.keys(JSON.parse(process.argv[1])).join(" "))' "$CONFIGS")
  if python3 scripts/lab/summarize.py --verdict "${VERDICT:-3}" "$DEST" $cfgs; then
    echo "stage 1 verdict clear for every config after $n batches; skipping: $rest"
  else
    echo "stage 2: $rest"
    run_pool "$rest"
    python3 scripts/lab/summarize.py --verdict "${VERDICT:-3}" "$DEST" $cfgs || true
  fi
else
  run_pool "$BATCHES"
fi
echo "results in $DEST"

if [ "${KEEP:-0}" != 1 ]; then
  for n in "${names[@]}"; do hcloud server delete "$n" >/dev/null && echo "server $n deleted"; done
else
  echo "servers kept: ${names[*]} (${ips[*]}); delete with: hcloud server delete ${names[*]}"
fi

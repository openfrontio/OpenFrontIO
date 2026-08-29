#!/usr/bin/env bash
# Run a lab sweep on a throwaway Hetzner Cloud server.
#
#   CONFIGS='{"base":{},"early":{"botsAfterWild":false}}' MINUTES=20 scripts/lab/remote.sh
#
# Env: CONFIGS, MINUTES (default 20), SERVER_TYPE (default ccx53 = 32 dedicated
# vCPU), LOCATION (default ash), NAME (default openfront-lab), DEST (local dir
# for results, default ./lab-out), KEEP=1 to leave the server running,
# REUSE=1 to use an existing server with $NAME instead of creating one.
# Needs: hcloud CLI with a context selected, ~/.ssh/id_ed25519(.pub), rsync.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${CONFIGS:?set CONFIGS}"
MINUTES=${MINUTES:-20}
SERVER_TYPE=${SERVER_TYPE:-ccx53}
LOCATION=${LOCATION:-ash}
NAME=${NAME:-openfront-lab}
DEST=${DEST:-$PWD/lab-out}
KEY_NAME=${KEY_NAME:-$(whoami)-lab}
SSH="ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 root"

if ! hcloud ssh-key describe "$KEY_NAME" >/dev/null 2>&1; then
  hcloud ssh-key create --name "$KEY_NAME" --public-key-from-file ~/.ssh/id_ed25519.pub >/dev/null
fi

if [ "${REUSE:-0}" = 1 ]; then
  IP=$(hcloud server ip "$NAME")
else
  cat > /tmp/lab-cloud-init.yml <<'EOF'
#cloud-config
package_update: true
packages: [rsync, git, build-essential]
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  - apt-get install -y nodejs
  - touch /root/.lab-ready
EOF
  echo "creating $SERVER_TYPE in $LOCATION ..."
  hcloud server create --name "$NAME" --type "$SERVER_TYPE" --image ubuntu-24.04 \
    --location "$LOCATION" --ssh-key "$KEY_NAME" --user-data-from-file /tmp/lab-cloud-init.yml >/dev/null
  IP=$(hcloud server ip "$NAME")
  echo "server $NAME at $IP; waiting for cloud-init ..."
  until $SSH@"$IP" test -f /root/.lab-ready 2>/dev/null; do sleep 5; done
fi

echo "syncing tree ..."
# Only what the lab needs: sources, tests, package files, and the World map
# manifest (the .bin maps come from tests/testdata). Everything else is 2 GB.
rsync -az --delete -e "ssh -o StrictHostKeyChecking=accept-new" \
  --include 'resources/' --include 'resources/maps/' --include 'resources/maps/world/' \
  --include 'resources/maps/world/manifest.json' --include 'resources/lang/' --include 'resources/lang/**' \
  --include 'resources/*.json' --exclude 'resources/**' \
  --exclude node_modules --exclude .git --exclude static --exclude lab-out --exclude dist \
  --exclude map-generator --exclude proprietary --exclude docs --exclude '*.log' \
  ./ root@"$IP":/root/openfront/
$SSH@"$IP" 'cd /root/openfront && [ -d node_modules ] || npm run inst >/tmp/inst.log 2>&1'

# Launch detached on the box and poll, so a dropped ssh session (or a killed
# local shell) cannot take the sweep down with it.
echo "running sweep ..."
$SSH@"$IP" "cd /root/openfront && mkdir -p /root/lab-out && nohup env CONFIGS='$CONFIGS' MINUTES=$MINUTES OUT=/root/lab-out bash scripts/lab/sweep.sh > /root/lab-out/sweep.log 2>&1 < /dev/null & echo launched"
sleep 15
until ! $SSH@"$IP" 'pgrep -f scripts/lab/sweep.sh >/dev/null' 2>/dev/null; do
  echo "  $(date +%H:%M) $($SSH@"$IP" 'grep -c "^done" /root/lab-out/sweep.log' 2>/dev/null) done, $($SSH@"$IP" 'grep -c "^FAILED" /root/lab-out/sweep.log' 2>/dev/null) failed"
  sleep 60
done
$SSH@"$IP" 'tail -1 /root/lab-out/sweep.log'

mkdir -p "$DEST"
rsync -az root@"$IP":/root/lab-out/ "$DEST"/
echo "results in $DEST"

if [ "${KEEP:-0}" != 1 ]; then
  hcloud server delete "$NAME" >/dev/null && echo "server $NAME deleted"
else
  echo "server $NAME kept at $IP (delete with: hcloud server delete $NAME)"
fi

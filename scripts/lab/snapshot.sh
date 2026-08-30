#!/usr/bin/env bash
# Bake a Hetzner snapshot with Node 24 + node_modules so lab workers boot in ~1 min instead of ~4
# (cloud-init + npm run inst). remote.sh picks the newest snapshot labelled lab-image=1 automatically.
# Re-run after a package-lock.json change (remote.sh also re-installs on its own when the lock differs,
# so a stale snapshot only costs a minute per box). Snapshots cost ~€0.01/GB/month; delete old ones with
#   hcloud image delete <id>      (hcloud image list --type snapshot -l lab-image=1)
#
#   scripts/lab/snapshot.sh            # env: SERVER_TYPE (cpx11 is enough), LOCATION (ash), KEY_NAME
set -euo pipefail
cd "$(dirname "$0")/../.."
SERVER_TYPE=${SERVER_TYPE:-cpx11}
LOCATION=${LOCATION:-ash}
NAME=openfront-lab-snapshot
KEY_NAME=${KEY_NAME:-$(whoami)-lab}
# Throwaway boxes get recycled IPs, so host keys are neither pinned nor remembered.
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes"
SSH="ssh $SSH_OPTS -o ConnectTimeout=10 root"

hcloud ssh-key describe "$KEY_NAME" >/dev/null 2>&1 || hcloud ssh-key create --name "$KEY_NAME" --public-key-from-file ~/.ssh/id_ed25519.pub >/dev/null
cat > /tmp/lab-cloud-init.yml <<'CI'
#cloud-config
package_update: true
packages: [rsync, git, build-essential]
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  - apt-get install -y nodejs
  - touch /root/.lab-ready
CI
echo "creating $NAME ($SERVER_TYPE, $LOCATION) ..."
hcloud server create --name "$NAME" --type "$SERVER_TYPE" --image ubuntu-24.04 --location "$LOCATION" \
  --ssh-key "$KEY_NAME" --label lab=1 --user-data-from-file /tmp/lab-cloud-init.yml >/dev/null
IP=$(hcloud server ip "$NAME")
until $SSH@"$IP" test -f /root/.lab-ready 2>/dev/null; do sleep 5; done
echo "installing dependencies ..."
rsync -az -e "ssh $SSH_OPTS" package.json package-lock.json root@"$IP":/root/openfront/
$SSH@"$IP" 'cd /root/openfront && npm run inst > /tmp/inst.log 2>&1 && cp package-lock.json node_modules/.lab-lock && rm -f /root/.ssh/known_hosts && sync'
# /root/.lab-ready stays on the image, so remote.sh's readiness probe works for snapshot boxes too.
hcloud server shutdown "$NAME" >/dev/null
until [ "$(hcloud server describe "$NAME" -o format='{{.Status}}')" = off ]; do sleep 3; done
echo "creating snapshot ..."
IMG=$(hcloud server create-image --type snapshot --description "openfront-lab $(date +%Y-%m-%d) $(git rev-parse --short HEAD)" --label lab-image=1 "$NAME" | grep -o '[0-9]*$')
hcloud server delete "$NAME" >/dev/null
echo "snapshot $IMG ready; remote.sh uses it automatically (IMAGE=auto)"

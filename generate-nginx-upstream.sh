#!/bin/sh
# generate-nginx-upstream.sh
#
# Generates the per-worker nginx config from CLUSTER_JSON at container start
# (the cluster map arrives via the runtime env file and is not known when the
# image is built, so it can't be baked into nginx.conf). The worker count is
# this deployment's own cluster entry, found by host — SUBDOMAIN.DOMAIN, bare
# DOMAIN when SUBDOMAIN is empty — the same self-match ServerEnv performs.
# Emits two things, both in the http context, into a single conf.d file:
#
#   1. upstream openfront_workers  - random-balanced across the live workers, so
#      nginx can spread requests (e.g. POST /api/create_game) without the caller
#      knowing the worker count.
#   2. map $worker $worker_port    - worker index -> port (3001 + index), so the
#      /wN/ locations route without a hand-maintained if-ladder.
#
# Usage: generate-nginx-upstream.sh [output_path]
set -eu

OUT="${1:-/etc/nginx/conf.d/00-workers.conf}"

if [ -n "${CLUSTER_JSON:-}" ]; then
    # Fail loudly on a malformed map or a host with no entry: the node server
    # will refuse to boot on the same config, so a silent nginx fallback would
    # only mask the real fault.
    n=$(node -e '
        const map = JSON.parse(process.env.CLUSTER_JSON);
        const self = process.argv[1];
        const entry = Object.values(map).find((e) => e.host === self);
        if (!entry) {
            console.error(`host ${self} has no entry in CLUSTER_JSON`);
            process.exit(1);
        }
        console.log(entry.numWorkers);
    ' "${SUBDOMAIN:+${SUBDOMAIN}.}${DOMAIN:-}")
else
    # No map at all (dev, manual runs): single worker, like the old
    # NUM_WORKERS default.
    n=1
fi

{
    echo 'upstream openfront_workers {'
    echo '    random;'
    i=0
    while [ "$i" -lt "$n" ]; do
        echo "    server 127.0.0.1:$((3001 + i));"
        i=$((i + 1))
    done
    echo '}'
    echo ''
    echo 'map $worker $worker_port {'
    echo '    default 3001;'
    i=0
    while [ "$i" -lt "$n" ]; do
        echo "    $i $((3001 + i));"
        i=$((i + 1))
    done
    echo '}'
} > "$OUT"

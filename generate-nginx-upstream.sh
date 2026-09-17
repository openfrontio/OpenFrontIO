#!/bin/sh
# generate-nginx-upstream.sh
#
# Generates the per-worker nginx config from NUM_WORKERS at container start
# (the worker count arrives via the runtime env file, from the deploy target,
# and is not known when the image is built, so it can't be baked into
# nginx.conf). The same value ServerEnv.numWorkers reads; a disagreement here
# is not a fallback: too few upstreams and the workers nginx never lists get
# no traffic, too many and it proxies to ports nothing listens on.
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

n="${NUM_WORKERS:-1}"
# Fail loudly on a malformed count: the node server refuses to boot on the
# same value, so a silent nginx fallback would only mask the real fault.
case "$n" in
    "" | *[!0-9]* | 0*)
        echo "NUM_WORKERS must be a positive integer, got '${n}'" >&2
        exit 1
        ;;
esac

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

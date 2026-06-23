#!/bin/sh
# generate-nginx-upstream.sh
#
# Generates a random-balanced nginx upstream of the live workers (ports 3001+)
# from NUM_WORKERS, so nginx can spread requests across them without the caller
# knowing the worker count. Currently used by POST /api/create_game (the worker
# mints a self-owned game id and returns it); reusable by any future endpoint
# that wants the same balancing.
#
# Run by the container entrypoint at start time, before nginx starts:
# NUM_WORKERS arrives via the runtime env file and is not known when the image
# is built (so it can't be baked into nginx.conf).
#
# Usage: generate-nginx-upstream.sh [output_path]
set -eu

OUT="${1:-/etc/nginx/conf.d/00-workers-upstream.conf}"
n="${NUM_WORKERS:-1}"

{
    echo "upstream openfront_workers {"
    echo "    random;"
    i=0
    while [ "$i" -lt "$n" ]; do
        echo "    server 127.0.0.1:$((3001 + i));"
        i=$((i + 1))
    done
    echo "}"
} > "$OUT"

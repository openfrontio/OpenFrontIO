#!/bin/sh
# generate-nginx-upstream.sh
#
# Generates the create-game nginx upstream from NUM_WORKERS. nginx randomly
# distributes POST /api/create_game across exactly the live workers (ports
# 3001+), each of which mints a self-owned game id and returns it.
#
# Run by the container entrypoint at start time, before nginx starts:
# NUM_WORKERS arrives via the runtime env file and is not known when the image
# is built (so it can't be baked into nginx.conf).
#
# Usage: generate-nginx-upstream.sh [output_path]
set -eu

OUT="${1:-/etc/nginx/conf.d/00-create-upstream.conf}"
n="${NUM_WORKERS:-1}"

{
    echo "upstream openfront_create_workers {"
    echo "    random;"
    i=0
    while [ "$i" -lt "$n" ]; do
        echo "    server 127.0.0.1:$((3001 + i));"
        i=$((i + 1))
    done
    echo "}"
} > "$OUT"

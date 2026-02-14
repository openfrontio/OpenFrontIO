#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUST_DIR="${ROOT_DIR}/rust"

PORT="${CONTROL_PLANE_PORT:-3199}"
HOST="${CONTROL_PLANE_HOST:-127.0.0.1}"

HEALTH_N="${BENCH_HEALTH_N:-30000}"
HEALTH_C="${BENCH_HEALTH_C:-200}"
READY_N="${BENCH_READY_N:-30000}"
READY_C="${BENCH_READY_C:-200}"
CONFIG_N="${BENCH_CONFIG_N:-10000}"
CONFIG_C="${BENCH_CONFIG_C:-100}"
ENV_N="${BENCH_ENV_N:-10000}"
ENV_C="${BENCH_ENV_C:-100}"
PORTS_N="${BENCH_PORTS_N:-10000}"
PORTS_C="${BENCH_PORTS_C:-100}"

AB_OUTPUT_DIR="${AB_OUTPUT_DIR:-/tmp/openfront-control-plane-bench}"
mkdir -p "${AB_OUTPUT_DIR}"

run_ab() {
  local name="$1"
  local requests="$2"
  local concurrency="$3"
  local url="$4"
  local output="${AB_OUTPUT_DIR}/${name}.txt"

  ab -q -n "${requests}" -c "${concurrency}" "${url}" >"${output}"

  local rps
  local tpr
  local failed
  rps="$(awk '/Requests per second/ {print $4}' "${output}")"
  tpr="$(awk '/Time per request:/ {print $4; exit}' "${output}")"
  failed="$(awk '/Failed requests/ {print $3}' "${output}")"

  printf "| %s | %s | %s | %s | %s | %s |\n" \
    "${name}" "${requests}" "${concurrency}" "${failed}" "${rps}" "${tpr}"
}

cd "${RUST_DIR}"
cargo build -p openfront-control-plane --release >/dev/null

CONTROL_PLANE_PORT="${PORT}" \
CONTROL_PLANE_BIND_ADDR="${HOST}" \
  target/release/openfront-control-plane >"${AB_OUTPUT_DIR}/server.log" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sleep 1

echo "Control-plane benchmark target: http://${HOST}:${PORT}"
echo "Raw ApacheBench outputs: ${AB_OUTPUT_DIR}"
echo
echo "| Endpoint | Requests | Concurrency | Failed | Req/sec | Time per req (ms) |"
echo "|---|---:|---:|---:|---:|---:|"
run_ab "healthz" "${HEALTH_N}" "${HEALTH_C}" "http://${HOST}:${PORT}/healthz"
run_ab "readyz" "${READY_N}" "${READY_C}" "http://${HOST}:${PORT}/readyz"
run_ab "configz" "${CONFIG_N}" "${CONFIG_C}" "http://${HOST}:${PORT}/configz"
run_ab "env" "${ENV_N}" "${ENV_C}" "http://${HOST}:${PORT}/api/env"
run_ab "ports" "${PORTS_N}" "${PORTS_C}" "http://${HOST}:${PORT}/v1/metadata/ports"

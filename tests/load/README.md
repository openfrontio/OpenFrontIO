# Server WebSocket load test

Measures the game server's hot path — WebSocket intent ingestion and the
100ms turn broadcast — against the **real** server (master + cluster
workers), with a selectable server runtime.

```bash
npm run perf:server                        # Node (tsx) server, default profile
npm run perf:server -- --runtime bun       # same profile, Bun server
npm run perf:server -- --games 10 --clients 40 --duration 60 --intent-rate 2
npm run perf:server -- --attach --workers 1   # drive an already-running server
```

The load generator always runs under plain Node so the measuring instrument
stays constant across server runtimes. Results are printed and written to
`tests/load/results/<label>.json` (gitignored).

## How it works

1. Spawns the dev server (`GAME_ENV=dev`, 2 workers by default) and waits
   for `/api/health`.
2. Creates `--games` private games via `POST /api/create_game` (round-robin
   across workers), connects `--clients` WebSocket clients to each, and has
   the creator start the game.
3. Each client sends schema-valid `attack` intents at `--intent-rate`/s
   (server limit: 10/s burst, 2.5/s sustained) with `Date.now()` embedded in
   the `troops` field. The server relays intents verbatim inside turn
   broadcasts, so every receiving client computes true intent→broadcast RTT
   with zero server instrumentation. Clients ping every ~5s (the server
   drops silent connections after 60s).
4. Samples the spawned server's whole process tree (`/proc`) once per
   second for CPU and RSS.

Reported: intent→turn RTT percentiles (floor is ~50ms mean — an intent
waits for the next 100ms tick), turn-interval jitter (target 100ms), join
latency (dominated by the 1s `lobby_info` broadcast interval), client/server
throughput, server CPU (% of one core, whole tree) and peak RSS.

## Recorded results (2026-08-11, Linux x64, 20 cores, Node 26.5 / Bun 1.3.14)

Medium = 8 games × 25 clients, 1 intent/s/client, 60s.
Heavy = 10 games × 40 clients, 2 intents/s/client, 60s (~4,400 msgs/s out).

| Metric               | Node medium | Bun medium | Node heavy | Bun heavy |
| -------------------- | ----------- | ---------- | ---------- | --------- |
| RTT p50 (ms)         | 50          | 51         | 50         | 54        |
| RTT p99 (ms)         | 100         | 102        | 100        | 103       |
| Turn jitter p99 (ms) | 101         | 105        | 104        | 106       |
| Server avg CPU       | 6.3%        | 62.3%      | 11.6%      | 70.1%     |
| Server peak RSS      | 641 MB      | 373 MB     | 661 MB     | 384 MB    |

Single standalone worker (no cluster), 100 clients, 2 intents/s, 30s:
Node 8.0% CPU vs Bun 33.6% CPU at identical latency.

Interpretation: latency is tick-dominated and equivalent on both runtimes,
but Bun spends ~4–6× the CPU for the same relay workload. Transport
microbenchmarks (minimal broadcast server, 100 clients, 5,000 sends/s)
rule out the obvious suspects:

| Transport (same workload)         | CPU  |
| --------------------------------- | ---- |
| Node + `ws`                       | 2.2% |
| Bun + `ws` (Bun's builtin shim)   | 3.8% |
| Bun + native `Bun.serve()` ws     | 4.1% |
| Node + `ws`, tick-driven fan-out  | 4.0% |
| Bun + `ws`, tick-driven fan-out   | 7.0% |

So a `Bun.serve()`-native transport rewrite would buy nothing — the shim is
already native-backed and no slower. The per-op JS work (JSON.parse + Zod +
stringify) is _faster_ on Bun in isolation. The real server's gap is
diffuse runtime overhead that only shows up in situ: sends from timer
context, event-emitter dispatch, GC pressure (JSC HeapHelper threads), and
a ~5%/process idle floor from Bun's timers/fetch bookkeeping (Node:
~0.3%). CPU profiling (`bun --cpu-prof`) shows ~38% of worker CPU inside
the native websocket `send` called from `endTurn`'s broadcast loop at
~1,000 sends/s — ~10× the per-send cost the same shim achieves in the
minimal benchmark.

Node's memory advantage reverses at the process level: Bun uses ~40% less
RSS.

# Multi-Server Architecture — Implementation Plan

Status: planned. Design summary and decisions below; the meat of this document
is the PR list.

One machine handles current load; this design is the contingency for a viral
Steam launch. Most of its pieces fix live bugs on one machine today, so they
land early as production no-ops: on the current single box every PR below runs
with a two-entry cluster map (blue + green on falk2) and changes no observable
behavior except the bugs it fixes.

## Design summary

- **No coordinator.** Servers are independent. Each keeps its own master, its
  own lobby roster, and schedules its own public lobbies. Public lobbies are
  split per server deliberately (partitions the join rate); private lobbies
  work across servers via the game-ID link.
- **One global pool, no regions.** Demand is diurnally correlated; latency is
  fine for a lockstep RTS behind Argo.
- **Topology is config.** `cluster.json` maps an instance letter to
  `{ host, color, numWorkers }`. Adding a machine = DNS + pool origins + one
  config entry + fleet redeploy.
- **Game IDs route themselves.** Char 0 of a game ID is the minting server's
  instance letter; the rest is random. Any client can resolve any game ID to a
  host + worker path from the cluster map alone — zero extra requests.
- **The full-page redirect is the universal fallback.** The target's own page
  always serves its own build and its own config, so any misroute
  self-corrects.
- **Cloudflare:** two LB pools, blue and green, each containing every server
  as an origin (color Host header, e.g. `falk2-blue.openfront.io`; Traefik
  routes by Host). Promotion = reorder pools + purge, regardless of fleet
  size. Color subdomains are plain proxied DNS records; the LB only matters
  for fresh page loads — after that the page is pinned via `serverHost`.
- **Not doing:** coordinator DO / shared roster, geo steering, L7 game proxy,
  relay-in-DO, autoscaling.

## Decisions (settled 2026-09-08)

| Question                                                    | Decision                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationship to open PR #5164                               | **Absorb it.** Fold `t3code/preserve-websocket-old-deployment` (ActiveDeployment, serverHost pinning, drain, version-mismatch join gate) into this work as PR 2 and supersede that PR.                                                                                                                                |
| New game ID size                                            | **10 chars total** — instance letter + 9 random from the existing 58-symbol alphabet. `GAME_ID_REGEX` widens to a `{8,10}` length range so archived 8-char IDs stay valid. (~0.8 expected archive-key collisions at 200M lifetime games; today's 8-char IDs are already near their first expected collision at ~20M.) |
| Deployment color source                                     | **Explicit `color` field in cluster.json** — read by boot validation, `/api/health`, and the drain check. Subdomain naming is not load-bearing.                                                                                                                                                                       |
| Matchmaking DO re-key (`mode` instead of `instanceId:mode`) | **API-side only.** This repo keeps sending `instance_id` (client join param, worker checkin body); the API just stops keying on it. Zero-coordination rollout.                                                                                                                                                        |

## cluster.json

```json
{
  "a": { "host": "blue.openfront.io", "color": "blue", "numWorkers": 16 },
  "b": { "host": "green.openfront.io", "color": "green", "numWorkers": 16 }
}
```

- Stored in a GitHub Actions var per environment (`CLUSTER_JSON`, replacing
  `NUM_WORKERS`), injected as env at deploy. The build stays
  environment-agnostic.
- Zod-validated at boot: unique letters, unique hosts, color ∈
  {blue, green}. Malformed config refuses to start.
- A server finds its own entry by matching `SUBDOMAIN.DOMAIN` (when
  `SUBDOMAIN` is empty — dev — the self host is just `DOMAIN`, i.e.
  `localhost`). That yields its letter (minting), color (drain), and worker
  count (forking). Refuse boot if absent. No second knob to drift.
- Delivered to web clients via the RenderHtml bootstrap injection, and served
  at `GET /cluster.json` for the desktop app — which is also the desktop
  build's server discovery (kills the baked `numWorkers: 1` → `/w0` bug).

## Routing rule (uniform — own deployment is not a special case)

```
sub, N = cluster[id[0]]
open ws to sub, path /w{hash(id) % N}
  accepted          → play                      (common case, zero extra requests)
  version_mismatch  → full page redirect to sub (their shell = their build = lockstep-safe)
  unknown letter    → redirect to apex          (freshest map re-resolves)
```

The `version_mismatch` payload carries the server's commit so the client can
tell "I'm stale, reload" from "that game is on another build, redirect".

### Why the deployment is a letter but the worker is a hash

Hash-routing is only sound where the modulus is frozen for the lifetime of
everything minted under it. A letter's worker count has exactly that
lifecycle: its color drains on every promotion, so the rule "change a
letter's `numWorkers` only on a deploy after its color has fully drained"
comes free with the blue/green cadence. Routing only matters while a game is
alive (archived IDs resolve via the API, not workers), so a drained color's
count is safe to change.

The fleet has no such freeze. A fleet redeploy synchronizes the _servers_
onto a new map, but not the two things that actually hold routing state:
live games straddle the flip on the draining color for hours, and open
tabs / desktop apps keep their map for their own lifetime — there is always
a mixed-map population. Under `hash(id) % numDeployments`, adding a machine
re-routes existing live games' IDs (shared lobby links and rejoins break at
every fleet change), and removal is worse: shrink N and everything
reshuffles, or keep N and 1/(old N) of the keyspace — including new mints —
points at a dead server forever, compounding with every retirement. Both
failures are silent: every ID hashes to _somewhere_, and a misroute answers
"game not found" on a healthy server.

The letter is the minimum stable token that lets an ID survive map changes:
resolution is append-only (a letter never re-resolves; a removed one goes
_unknown_, which is loud and falls back to the apex), mixed maps are safe in
both directions, retirement is just drain-then-delete, and any ID names its
server on sight. It costs one character; any scheme that patches the hash's
instability (epoch markers, bucket maps) ends up re-inventing it.

---

## PR list

Dependency graph (PRs 1–3 are independent of each other):

```
PR 1 (ID widening, soak) ─────────────┐
PR 2 (absorb #5164) ──┬── PR 4 (cluster.json) ──┬── PR 5 (client routing)
PR 3 (loud close)     └────────────── PR 6 (color drain)
                                       API-side: matchmaking re-key (after PR 5 is broadly deployed)
```

### PR 1 — Widen game-ID validation to `{8,10}` (land early, soak)

The regex change must be on effectively every client before anything mints a
10-char ID, so this ships first and soaks. Minting stays at 8 chars until
PR 4.

- `src/core/Schemas.ts`: `GAME_ID_REGEX` → `/^[A-Za-z0-9]{8,10}$/`. `ID` and
  the zbin `MappedID` follow the constant automatically; zbin strings are
  varint-length + UTF-8, so the wire layout is unchanged — the soak is purely
  about old bundles' Zod validation rejecting longer IDs.
- Audit the regex's consumers for anything length-sensitive beyond the
  constant: `JoinLobbyModal` (paste/normalize flow), `Main.ts` URL parsing,
  `GamePreviewRoute`.
- Client IDs validate against the same regex (`CLIENT_ID_MAPPING`) but stay
  8 chars generated; the range covers them.
- Tests (required — `src/core` change): regex accepts 8- and 10-char IDs,
  rejects 7 and 11; zbin round-trip of a 10-char mapped and inline ID.

No-op in production: nothing emits a >8-char ID yet.

**Deploy gate for later PRs:** PR 4's minting flips on only after this has
soaked — web clients are forced current by PR 2's version gate at next
deploy, but Steam/desktop builds must ship an update containing it first.

### PR 2 — Absorb #5164: pin tabs to their deployment, drain, version gate

Rebase the content of `t3code/preserve-websocket-old-deployment` onto main as
one PR and close #5164 as superseded. Fixes live bugs on one box today:
mid-game reconnects crossing a blue/green flip, drained deployments being
farmed for empty public lobbies, and stale tabs desyncing games they join.

- `src/server/ActiveDeployment.ts` (new): poll apex `/api/health` for the
  live deployment's identity; null-tolerant (a Cloudflare hiccup must never
  drain the live deployment).
- `src/server/Master.ts` + `MasterLobbyService.ts`: report `instanceId` from
  `/api/health`; stop scheduling public lobbies when inactive (queued lobbies
  still start; games keep running).
- `src/server/RenderHtml.ts` + `deploy.sh` + `release.yml`: inject
  `serverHost` (`SUBDOMAIN.DOMAIN`) into the web shell so the page talks to
  its own deployment directly, reconnects included.
- `src/core/Schemas.ts` + `src/server/Worker.ts`: `gitCommit` on
  join/rejoin; server rejects mismatched joins with a typed
  `version_mismatch` error and closes 1000. `PublicLobbyFullSchema.gitCommit`
  lets the homepage prompt a refresh after a deploy.
- **Addition over the original branch (checklist item 4, server half):** the
  `version_mismatch` error payload carries the server's commit. The client
  keeps its current reload behavior in this PR; PR 5 teaches it to
  distinguish reload from redirect. Adding the field here avoids touching
  this wire message twice.
- Tests: carried over from the branch (`ActiveDeployment`,
  `MasterLobbyServiceActive`, `RenderHtml`, `ServerEnv`,
  `ClientVersionSchemas`, `GameApiCors`) plus the commit-in-payload case.

### PR 3 — Loud close on worker-ID mismatch (live bug, independent)

Today `src/server/Worker.ts` (`expectedWorkerId !== workerId`) logs and bare-
returns, leaving the socket open — the client hangs silently.

- Close the socket with a typed error/close code (vocabulary already in
  `src/core/CloseCodes.ts`, e.g. a `WrongWorker` rejection in the 4xxx app
  range) instead of returning.
- Client-side handling stays generic in this PR (terminal close → error
  surface); PR 5 routes it into the redirect fallback.
- Tests: join aimed at the wrong worker gets a close, not a hang.

### PR 4 — cluster.json: config plumbing, delete NUM_WORKERS, letter minting

The core of the design. On today's two-entry map this is a production no-op
except for the new ID format.

- `CLUSTER_JSON` env → `ServerEnv`: Zod schema (unique letters/hosts, color
  enum), self-entry lookup by `SUBDOMAIN.DOMAIN` (bare `DOMAIN` when
  `SUBDOMAIN` is empty), refuse boot when malformed or absent.
- Delete `NUM_WORKERS` everywhere it lives:
  - `src/server/ServerEnv.ts` (`numWorkers()` reads own cluster entry),
    `src/server/Master.ts` fork loop, `MasterLobbyService` readiness.
  - `src/server/RenderHtml.ts`: inject the full cluster map + own letter into
    `BOOTSTRAP_CONFIG` (replaces `numWorkers`); `src/client/ClientEnv.ts`
    re-hydrates both.
  - `generate-nginx-upstream.sh` + `Dockerfile` `start.sh`: derive the
    in-container worker count from `CLUSTER_JSON` + `SUBDOMAIN.DOMAIN` (the
    nginx `/wN` port map is generated at container start).
  - `.github/workflows/deploy.yml` (`vars.NUM_WORKERS` → `vars.CLUSTER_JSON`),
    `deploy.sh` env file, `package.json` dev script (single-entry localhost
    map), `tests/GenerateNginxUpstream.test.ts`, `tests/server/*` env setup,
    `tests/matchmaking/e2e.mjs`.
- `GET /cluster.json` on the master (desktop server discovery).
- Minting: `generateID()` grows a variant for game IDs — own instance letter
  - 9 random chars; `generateGameIdForWorker` keeps hash-to-self rejection
    sampling over the full 10-char ID. Client IDs stay 8-char.
- Tests: config validation (dup letters/hosts, bad color, missing self),
  self-entry resolution incl. dev, minted IDs match `^<letter>[alphabet]{9}$`
  and hash to the requested worker, RenderHtml injection shape.

**Deploy gate:** prod deploy waits for PR 1 soak on desktop/Steam.

### PR 5 — Per-game routing in the client (the seam PR 2 built)

- `src/client/ClientEnv.ts` `resolveServerOrigin()` becomes per-game: letter
  → cluster entry → `{ host, numWorkers }` → `wss://host/w{hash % N}`. Both
  the WS and HTTP bases follow, so `checkActiveLobby`, game preview, and the
  join socket all route cross-server with zero extra requests. Own-server
  paths (lobby list, create_game) keep using own entry via `serverHost` —
  uniform rule, no special case.
- `version_mismatch` handling forks on the commit in the payload (PR 2):
  server commit == own → stale, reload (current behavior); different → full
  page redirect to the game's host so their shell serves their build.
- Unknown letter → redirect to apex (freshest map re-resolves); if already on
  the apex shell, fall through to not-found.
- Worker-mismatch close (PR 3) → same redirect fallback.
- Desktop: resolve the cluster map from `GET /cluster.json` on its configured
  `serverHost` at boot (replaces the baked `numWorkers: 1`); the Electron
  shell repo consumes this separately.
- Tests: origin resolution per letter, fallback paths, mismatch fork.

### PR 6 — Color-compare drain check

Fixes the false-drain PR 2's mechanism would develop with multiple active
origins behind the apex: an active server polling the apex often gets a
_sibling's_ `instanceId` and wrongly concludes it is inactive. Color is
deployment-wide; instanceId is per-machine.

- `/api/health` reports the deployment `color` (from the server's own
  cluster entry) alongside `instanceId`.
- `src/server/ActiveDeployment.ts`: compare colors, not instanceIds — "is
  the live color mine?". Null-tolerance semantics unchanged.
- Draining colors keep their games, stop scheduling public lobbies, and stay
  addressable forever via the ID letter — which is what fixes shared lobby
  links and mid-match rejoins across a cutover, on one machine or ten.
- Tests: sibling-same-color answer does not drain; other-color answer
  drains; null answers never drain.

Depends on PR 2 (ActiveDeployment exists) and PR 4 (color comes from the
cluster entry).

### API-side (closed source, not a PR here) — matchmaking DO key

Key the ranked matchmaking DO per `mode`, not `instanceId:mode` (which splits
queues across servers and abandons one queue per deploy). This repo keeps
sending `instance_id` in the client join URL and `instanceId` in the worker
checkin body; the API ignores them as a key.

**Sequencing:** only flip this after PR 5 is live on effectively all clients
— with a mode-only queue, any server's worker can claim a match, so the
assigned game ID may carry another server's letter, and pre-PR-5 clients
cannot route it.

## Rollout order

1. PR 1, PR 2, PR 3 — independent; land in any order. PR 1 as early as
   possible (soak clock starts at the first desktop/Steam release containing
   it).
2. PR 4 — after PR 2 (serverHost injection). Prod deploy gated on PR 1 soak.
3. PR 5 — after PR 4.
4. PR 6 — after PR 2 and PR 4.
5. API matchmaking re-key — after PR 5 is broadly deployed.

Adding the second machine later is not a code change: DNS records, add the
machine's blue/green origins to both CF pools, two new cluster.json entries,
fleet redeploy.

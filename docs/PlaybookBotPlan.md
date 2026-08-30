# PlaybookBot rebuild plan

Implementation plan for the architecture review (artifact
`PlaybookBot Architecture Review`, 2026-08-29). Written for the agents who
execute the work packages below. Companion docs: `PlaybookBotLab.md` (how to
measure), `PlaybookBotGUI.md` (how to watch).

Baseline: branch `playbook-bot` at `e69862fbe`.
Bot: `src/core/execution/playbook/PlaybookBotExecution.ts` (1,457 lines).

## Handoff (state at bb03d7cd8, 2026-08-29)

Read this first if you are picking the rebuild up.

**Where things are**
- Branch `playbook-bot`, HEAD `bb03d7cd8`, nothing pushed. All code packages
  A1–C2 are merged; only C3 (the lab campaign) remains.
- Bot: `src/core/execution/playbook/` — `PlaybookBotExecution.ts` (loop,
  `send()`, rule table), `Situation.ts` (+ phase, `Rivals.ts`), `Military.ts`
  (+ `Estimate.ts`), `Economy.ts` (+ `Spend.ts`), `Diplomacy.ts`, `Params.ts`.
- Tests: `npx vitest --dir tests tests/playbook --run` (golden included; the
  `--dir tests` matters — a bare path also matches copies under
  `.claude/worktrees/`). `npx tsc --noEmit` and `npm run lint` are clean.
- Lab: `docs/PlaybookBotLab.md`. Single game:
  `PARAMS='{...}' MIN=8 SPAWN=africa DIFF=medium LAB_OUT=/tmp/x OUTFILE=a.txt node --import tsx tests/lab/playbook.lab.ts`.
  Sweeps: `scripts/lab/remote.sh` (Hetzner, WORKERS=N) or `sweep.sh`; results
  via `scripts/lab/summarize.py`; tuning via `cmaes.py` / `ladder.sh`.

**Seven flags, all default off, all waiting for a 30-game Medium A/B**
`simWars`, `realRetreats`, `scoredSpend`, `bsrReserve`, `trustWars`,
`nationAware`, `phaseGates`. `{}` is the exact pre-rebuild baseline (every
flag-off transcript was proven byte-identical at merge time).

**What to do next (C3)**
1. One sweep, MINUTES=20, all in the same CONFIGS so games pair:
   `{"base":{},"ret":{"realRetreats":true},"spend":{"scoredSpend":true},"c1":{"bsrReserve":true,"trustWars":true,"nationAware":true,"phaseGates":true},"sim":{"simWars":true}}`
   Keep `simWars` on its own: single-game smokes (africa, 8 min) gave baseline
   rank 2 / 43.5k tiles, `sim` rank 10 / 23k, `spend` rank 4 / 40k, `c1`
   rank 3 / 44k, all seven together rank 20 / 13.5k. Expect `simWars` to need
   retuning (wave margin 20 %, free-land gates 20/60/150 troops per tile in
   `Military.fight`) before it graduates.
2. Graduate winners: set the default to `true`, then (a later commit) fold
   the flag as C2 did. Drop losers. Update the golden hash only when a
   default changes, and say so in the commit.
3. Confirm flags were live in the transcripts: `sim:` annotations on ATTACK
   lines, `spend:` lines, `retreat from`/`coming home` lines, `phase` lines.
4. Then CMA-ES over the 11 continuous params (`cmaes.py` built-in spec),
   population 10, ~12 generations; ladder the result against `v-current`.
5. Repeat on Hard.

**Rules that still apply**
- New behaviour goes behind a default-off `PlaybookParams` flag; refactors
  keep the golden hash; every change ships a `tests/playbook/` test.
- One package = one worktree = one branch; `git checkout -b <branch> <sha>`
  first — agent worktrees have been created at `main`, not `playbook-bot`.
- Before merging into `playbook-bot`, check `git status`: another session
  (`openfront-00`) works in the main checkout; never stash or overwrite its
  edits — message it and merge after it commits.
- Hetzner: cpx51 only, `KEEP=1`, never `hcloud server delete` without
  telling Josh. A box `openfront-lab-c3` may still exist from an aborted run.

**Known loose ends**
- `realRetreats` off keeps the old no-op retreat on purpose (baseline
  fidelity); once it graduates, delete the `orderRetreat` path.
- `Spend.ts` value constants (`CAP_GOLD_PER_TROOP` = 20, port/rail curves)
  are first estimates from the labs, not swept.
- `bsr` approximates "their border facing us" by our border facing them.
- Worker branches `bot/a1-tests … bot/c1-c2` are merged and can be deleted.

## Ground rules

1. **One package = one worktree = one PR onto `playbook-bot`.** Own only the
   files listed in your card; if you must touch another file, say so in the PR.
2. **No behaviour change without a flag.** New logic goes behind a
   `PlaybookParams` boolean that defaults to **off**, so `{}` stays the
   baseline for every sweep. Flags graduate (default on, old branch deleted)
   only after a 30-game Medium A/B on Hetzner (`PlaybookBotLab.md`).
3. **Refactors are proven by the golden test**, not by argument. The sim is
   deterministic: same seed → identical bot log. A pure refactor must leave
   `tests/playbook/golden.test.ts` green; a behaviour change updates the
   golden hash in the same PR and says why.
4. **Every package ships tests** (`src/core` rule, CLAUDE.md). Rule-level
   tests live in `tests/playbook/`, on the `setup()` harness, not mocks.
5. `src/core` stays dependency-free, integer-deterministic, no floating
   point in game state (floats inside a bot *estimate* are fine; they never
   touch state).

## Sequence

```
Day 1        A1 tests + golden ─┐   A2 module split ─┐   B4 tuning infra ──┐
                                │ (A2 merges first)  │                      │
Day 2–3      B1 attack estimator │ B2 situation model │ B3 spending scorer  │
             (Military.ts)       │ (Situation/Rivals) │ (Economy/Spend.ts)  │
                                 └────────┬───────────┘                     │
Day 4        C1 wire consumers to phase / threat / nation rules             │
             C2 fold graduated flags, delete losers                         │
Day 5+       C3 lab campaign: A/B each flag → CMA-ES on winners → Hard ◄────┘
```

A1, A2 and B4 start together. B1–B3 branch **from A2's merge** so the three
of them edit different files. C1/C2 are integration and belong to one agent.

## Interface contracts (agreed up front so packages don't collide)

### Module context (A2)

```ts
// src/core/execution/playbook/Context.ts
export interface BotContext {
  mg: Game; me: Player; p: PlaybookParams; sit: Situation;
  random: PseudoRandom;
  send(targetID: string | null, n: number, why: string, min?: number, capFloor?: number): number;
  boat(tile: TileRef, n: number, why: string): number;
  log(line: string): void;          // enforces the 2000 cap
}
```

Modules are plain classes taking `ctx` in the constructor and exposing the
rule methods they own. `PlaybookBotExecution` keeps `init/tick/isActive`,
`readSituation`, `send`, `boat`, `events`, and the rule table.

### Situation (A2 defines, B2 extends)

```ts
export interface Situation {
  tick: number; troops: number; cap: number; capShare: number; reserve: number; spendable: number;
  gold: bigint; bots: Player[]; rivals: Player[]; friends: Player[]; wilderness: boolean;
  incoming: Attack[]; incomingBots: number; outgoing: Attack[]; tribeAttacks: number; boats: number;
  collapsed: Player[]; expiring: Player[]; hold: Player | null;
  // B2 adds:
  phase: "opening" | "consolidate" | "war" | "endgame";
  rival: Map<Player, RivalView>;    // trend, trust, border threat, nation predictions
}
export interface RivalView {
  troopsDelta: number;      // per 100 ticks, from a ring buffer sampled every 50 ticks
  tilesDelta: number;
  trust: number;            // 0–1; starts 0.5; − on broken alliance / attacked ally / refused request, + on renewal
  borderTiles: number;      // our border tiles adjacent to them
  bsr: number;              // their troops on our shared border / our troops (Risk border-security ratio)
  nationCanAttack: boolean; // from AiAttackBehavior rules; false for humans
  nationWouldSend: number;  // troops their troopSendCap allows right now
}
```

### Attack estimator (B1)

```ts
// src/core/execution/playbook/Estimate.ts — pure, no state
export interface AttackEstimate {
  tilesTaken: number; attackerLoss: number; defenderLoss: number; ticks: number;
  troopsLeft: number; wins: boolean;      // wins = target's troops exhausted before ours hit `stopBelow`
}
export function estimateAttack(mg: Game, attacker: Player, defender: Player, troops: number,
  opts?: { horizonTicks?: number; stopBelow?: number; reinforce?: boolean }): AttackEstimate;
```

Replays `Config.attackLogic` over the defender's border tiles nearest to the
attacker (posts, terrain, fallout, size debuffs all come for free), adds the
defender's regen over the horizon when `reinforce` is on, stops at the
horizon, at `stopBelow`, or when the defender has no troops.

### Spending (B3)

```ts
// src/core/execution/playbook/Spend.ts
export interface Candidate { kind: "build" | "upgrade"; type: UnitType; tile?: TileRef; unit?: Unit;
  cost: bigint; value: number; why: string }          // value = expected return over horizon / cost
export interface Escrow { purpose: string; amount: bigint; until: number }
```

`Economy.build()` becomes: hard overrides (post where an attack lands, SAM
when a MIRV threat appears) → enumerate candidates → subtract escrow → buy
the top candidate if `value >= 1` → log the top three with values so the
lab can see why.

## Work packages

Each card is a self-contained brief. Definition of done includes tests,
`npm run lint`, and — for anything that can change behaviour — a lab result.

### A1 — Rule-level tests and the golden test

- **Owner files:** `tests/playbook/**`, `tests/util/PlaybookSetup.ts` (new).
- **Do not touch:** the bot.
- **Build:** `playbookSetup({ map, bot: PlaybookParams, rivals: [...], tribes })`
  on `tests/util/Setup.ts`: small map (`plains` / `half_land_half_ocean`),
  spawns the bot and N nation/bot opponents at given tiles, ends the spawn
  phase, exposes `step(n)`, the bot instance, and its log.
- **Tests (one file per rule):** counter fires at ≈1.05× an incoming non-bot
  attack above 15 % of our troops and not below; `expand` never sends below
  `homeFloor`; `send()` returns 0 while `sit.hold` is set (alliance with a
  stronger nation expiring in < 45 s); retreat triggers when the wave is
  < 20 % of what was sent and the target has > 70 % of its troops; the
  tribe click cap splits a large tribe into follow-ups 100 ticks apart;
  `build()` places a defence post facing the attacker when an attack lands.
- **Golden:** `golden.test.ts` runs the bot on `plains` vs two nations for
  600 ticks with a fixed seed and asserts a hash of `bot.log` + tiles +
  troops + gold at ticks 100/300/600 against a stored constant. Document in
  the file how to regenerate it (`GOLDEN=1 npx vitest …` prints the hash).
- **Done when:** all green on `e69862fbe`; `npx vitest tests/playbook --run`
  under 20 s.

### A2 — Mechanical module split (zero behaviour change)

- **Owner files:** `src/core/execution/playbook/**`.
- **Split:** `Context.ts`, `Situation.ts` (readSituation, neighbours, cap,
  density, landmass, acrossWater), `Military.ts` (expand, harvestBots,
  counterAttack, fight, manageRetreats, collapsed, boats: earlyBoat /
  sendBoat / huntBotsByBoat / seaInvasion / seaExpansion, maybeBomb,
  maybeMIRV, watchSplit), `Economy.ts` (build, buildRail, rail helpers,
  tile pickers, tryBuild), `Diplomacy.ts` (acceptAlliances, isPrey,
  requestAlliances, manageExpiries, manageEmbargoes, onAllianceEnded).
  `PlaybookBotExecution.ts` keeps the loop, `send/boat`, `events`, the rule
  table, and re-exports `PlaybookParams`/`DEFAULT_PLAYBOOK` so the lab, `GameRunner.ts`,
  `WorkerMessages.ts`, `ClientGameRunner.ts` and `tests/PlaybookBotHook.test.ts`
  don't change.
- **Rule:** move code, don't improve it. Private state that two modules
  share (`currentTarget`, `counters`, `lastWarTick`, `postFailed`) moves to
  the module that writes it with a getter; note each in the PR.
- **Done when:** A1's golden hash is unchanged, lab `MIN=1` transcript for
  one spawn is byte-identical before/after, lint clean.

### B1 — Attack estimator and simulated wars

- **Owner files:** `Estimate.ts` (new), `Military.ts`, `tests/playbook/estimate.test.ts`.
- **Flag:** `simWars: boolean` (default false).
- **Estimator:** as in the contract. Verify on the harness: launch a real
  `AttackExecution` with the same numbers and assert the estimate's
  `attackerLoss` / `tilesTaken` are within 15 % of the real outcome for three
  scenarios (no posts, posts on the border, defender twice our size).
- **With `simWars` on:** `fight()` picks the target and size by
  `estimateAttack` — send the smallest `troops` that `wins` with
  `troopsLeft >= reserve`, capped by `fightMaxShare`; skip targets where
  `tilesTaken / attackerLoss` is worse than free land (≈ 1 tile per 16–24
  troops). `manageRetreats()` re-estimates a running war every 100 ticks with
  the attack's current troops and retreats when `wins` flips false.
  `fightRatio` stays as the fallback when the flag is off.
- **Done when:** tests green; a 30-game Medium A/B `{"simWars":true}` vs `{}`
  on Hetzner is in the PR description (win/loss/tie, alive, crowns, land).

### B2 — Situation model: phase, rival trend/trust, border threat, nation rules

- **Owner files:** `Situation.ts`, `Rivals.ts` (new), `tests/playbook/situation.test.ts`.
- **Do not** change any consumer yet (that is C1); this package only *exposes*.
- **Phase:** `opening` while free land is reachable; `consolidate` when it
  is gone and troops < `fightAbove`·cap; `war` when a war is affordable or
  troops ≥ 0.95·cap; `endgame` when rank ≤ 3 and an unfriendly silo exists,
  or tick ≥ 15000 as a floor. Log every transition.
- **RivalView:** ring buffer per rival (8 samples, every 50 ticks) → deltas;
  trust updated from `events()` hooks (A2 exposes them); `borderTiles` and
  `bsr` from `me.borderTiles()` neighbours; `nationCanAttack` /
  `nationWouldSend` re-implement the checks in
  `src/core/execution/utils/AiAttackBehavior.ts` (`isAttackTooWeak`,
  `troopSendCap`, `hasTriggerRatioTroops`, `shouldAttack` by difficulty) —
  read that file, don't guess; include the difficulty constants.
- **Tests:** phase transitions on a scripted game; `nationCanAttack` matches
  what a real `NationExecution` does over 200 ticks in two set-ups (we are
  above / below its send cap).
- **Done when:** golden unchanged (exposure only), tests green.

### B3 — Scored spending with one escrow model

- **Owner files:** `Spend.ts` (new), `Economy.ts`, `tests/playbook/spend.test.ts`.
- **Flag:** `scoredSpend: boolean` (default false).
- **Values:** encode the lab numbers that live in the guide. City: cap and
  gold return per level; port: marginal trade income vs map-wide ship
  saturation (`seaFullShips`) and own level count; port level vs new port
  (`portLevelBeforeSecond` becomes a curve); factory + rail: only with
  stations within 110 tiles; silo/SAM: value from threat (enemy silos,
  rank) not tick; warship: per 6 ports after 15:00. Horizon = time left in
  the phase (endgame horizon is short, which retires "nothing after 25:00
  pays back" as a rule).
- **Escrow:** `mirvFund`, `siloReserve`, bomb reserve become entries in one
  list; `available = gold − Σ escrow`.
- **Tests:** with fixed inputs the top candidate is the one the lab found
  (three cases from the ports and rail labs); escrow is subtracted once.
- **Done when:** tests green; 30-game A/B in the PR.

### B4 — Tuning infrastructure

- **Owner files:** `scripts/lab/**`, `docs/PlaybookBotLab.md`.
- **Move** the scratchpad summariser (`ab30sum.py`) and `ab30.sh` pattern
  into `scripts/lab/` so results are reproducible from the repo.
- **`scripts/lab/cmaes.py`:** CMA-ES (pure numpy or a 60-line
  implementation, no new project deps) over a named list of continuous
  `PlaybookParams`; each generation = one `remote.sh` sweep with
  `CONFIGS` = the population; fitness = mean over the 30-game grid of
  `alive + share + (top3 ? 1 : 0)`; same grid every generation (paired
  seeds); writes `gen_N.json` with the population and scores; resumable.
- **`scripts/lab/ladder.sh`:** stores each graduated default set as
  `scripts/lab/versions/vN.json`; runs a candidate against the last three
  versions on the grid and prints a Bradley–Terry-style table.
- **Done when:** a 2-generation dry run with population 4 at `MINUTES=5`
  completes on Hetzner and the doc explains both scripts.

### C1 — Wire consumers (after B1–B3 merge) — done

Four new default-off `PlaybookParams` flags, one per consumer, so each can
be A/B'd on its own (`PARAMS='{"<flag>":true}'`):

- `bsrReserve`: `sit.reserve = troops × reserveShare × clamp(0.5 + 0.5·maxBsr, 0.5, 2.0)`
  over the unfriendly neighbours' `bsr` (`SituationQueries.reserveFactor`);
  reserveShare is the value at bsr 1. The phase is computed after the
  reserve (it reads spendable), so `enrich` is split into `enrichRivals` +
  `enrichPhase`.
- `trustWars`: `Military.fight()` drops a candidate whose living ally on
  our border has `nationCanAttack` with `nationWouldSend ≥ 0.5 × spendable`
  (`allyThatCanPileIn`, logged once per 600 ticks) and adds
  `2 × (1 − trust)` to the score (both scorers).
- `nationAware`: the expiry hold and the renewal gift ask
  `Rivals.couldAttackAtExpiry` (the RivalView rules with us counted as the
  unfriendly neighbour we become) instead of the 0.85× / 0.9× heuristics.
- `phaseGates`: `SituationQueries.phaseOr(literal, "endgame" | "pastOpening")`
  replaces the phase-proxy tick literals (25:00/20:00/15:00/12:00 → endgame;
  5:00/3:00/2:30 wars, silos, rail → past opening) in Military, Economy
  (both build passes) and Diplomacy; `Spend.horizonForPhase` gives the
  scored-spend horizon (opening/consolidate 6000, war 4000, endgame
  max(1000, 15000 − tick)). Genuine timers stay: `bombEvery`,
  `botFollowUpTicks`, `allianceEvery`, `siloAtTick`, `fightNotBeforeTick`,
  `boatAtTick`, `portWithoutPartnerTick`, the 0:30 / 1:00 boat-rule gates,
  the 1:30 threat-post gate, and the pure `Spend.siloReturn` /
  `samReturn` tick inputs.

Tests: `tests/playbook/{bsrReserve,trustWars,nationAware,phaseGates}.test.ts`.
With all four off the lab transcript is byte-identical to before (golden
unchanged). C3 runs the four A/Bs.

### C2 — Flag consolidation — done

- Folded into the code (the param and its dead branch removed): `wholeWars`,
  `stickyWar`, `splitWatch`, `econWar`, `postsBeforeCity2`,
  `retreatOnAllianceEnd`, `spawnBasin`. Deleted: `openingAllIn` /
  `openingKeep` (lost their A/B) and `homeFloor` (A1 found it declared and
  defaulted but read nowhere — the expansion floor is `reserveShare`, the
  cap floor is `send()`'s `capFloor` argument). `endgameV2` stays until the
  finish rule is settled. Behaviour-neutral for default params: golden
  unchanged, lab transcript byte-identical. Lab `PARAMS` JSON must not name
  the removed keys; `ALLIN` / `KEEP` env overrides are gone from
  `tests/lab/playbook.lab.test.ts`.

### C3 — Lab campaign

**Round 1 (2026-08-29, dc3d1d6c3; 150 games, Medium 20 min, 3× cpx62):**

| config | alive | crowns | top-3 | total tiles | median | paired vs base |
|---|---|---|---|---|---|---|
| base `{}` | 30 | 2 | 14 | 2.08M | 84k | — |
| realRetreats | 30 | 5 | 17 | 3.53M | 101k | 18W 11L |
| c1 (bsrReserve+trustWars+nationAware+phaseGates) | 30 | 6 | 12 | 3.20M | 63k | 18W 12L |
| scoredSpend | 29 | 3 | 9 | 1.99M | 59k | 12W 17L |
| simWars | 30 | 0 | 0 | 0.68M | 25k | 7W 23L |

realRetreats graduated (default true). scoredSpend dropped as is (buys fewer
ports than the ladder; `Spend.ts` constants unswept). simWars dropped as
tuned — never a crown or top-3; retune wave margin / free-land gates before
another A/B. Round 2 unbundles c1 on top of realRetreats.

**Round 2 (216f4ddaf; 180 games; base = realRetreats on):**

| config | alive | crowns | top-3 | total tiles | median | paired vs base |
|---|---|---|---|---|---|---|
| base (realRetreats) | 30 | 5 | 17 | 3.53M | 101k | — |
| + c1 bundle | 30 | 4 | 14 | 2.99M | 66k | 17W 13L |
| + bsrReserve | 30 | 7 | 13 | 3.21M | 63k | 14W 16L |
| + trustWars | 30 | 7 | 19 | 3.91M | 108k | 6W 4L, 20 identical |
| + nationAware | 30 | 4 | 18 | 3.34M | 98k | 9W 6L, 15 identical |
| + phaseGates | 30 | 7 | 13 | 3.13M | 78k | 11W 18L |

The c1 bundle's round-1 gain was realRetreats' gain in disguise. bsrReserve
and phaseGates dropped (phaseGates delays silos/SAMs to the endgame phase and
costs land). trustWars and nationAware are mild positives that rarely trigger.

**Round 3 (60 games; base = realRetreats on):** trustWars + nationAware
together: 30 alive, 8 crowns (base 5), 21 top-3 (17), 4.19M tiles (3.53M),
median 111k (101k), paired 11W 8L with 11 identical. Both graduated (default
true, bc9108bd1). Remaining default-off flags: simWars, scoredSpend,
bsrReserve, phaseGates — each needs a rework before another A/B.

**Round 4:** CMA-ES over the 11 continuous params, population 10 + base,
12 generations, 20-minute games, 3× cpx62 (`lab-out/cma`, NAME=openfront-cma).

1. Each B-flag: 30-game Medium A/B, graduate or drop.
2. CMA-ES over: `expandContested expandFree botRatio botClickCap
   fightAbove fightMaxShare reserveShare retreatBelowRatio capFullShare
   bombReserve railSpacing` (11 params; `homeFloor` was removed in C2), population 10, 12 generations
   ≈ 3.6k games ≈ €1.5 on cpx51.
3. Ladder run of the result vs v-current; if it wins, it becomes the next
   version and the guide's "Pressure-tested" table is updated.
4. Repeat 1–3 on Hard.

## Scoring (2026-08-30)

Why the old objective was not enough (seen in the day's sweeps): on Medium
`alive` is 30/30 for every config (zero information), `top3` is a step,
`share` swings ±0.3 on a single war, crowns were not scored, and paired A/Bs
counted games where the flag never fired (trustWars: 20/30 identical) as 30
games. Fixed in `scripts/lab/summarize.py`, `cmaes.py`, `ladder.sh`.

**Per-game score** (summarize.py; the old fitness stays as `fit_old`):

```
score     = landScore + rankScore + crown                 # [0.4, 2.25]
landScore = log10(max(tiles, 100)) / 5                    # 100k tiles = 1.0, 10k = 0.8, dead = 0.4
rankScore = alive ? 1 - (rank - 1) / (players - 1) : 0    # 1st = 1.0, last = 0.0
crown     = rank == 1 ? 0.25 : 0
```

`players` = the new `players=N` FINAL field; if absent, N of the last
`rank=x/N` transcript row (`p_<config>_<batch>_<region>.txt`), else N=40
with a printed note. The real N at 20 min on Medium is ~21–26, so the 40
fallback is lenient — keep transcripts (or the new field) for real scoring.
The optional FINAL field `fired=flag:count,…` (`-` = none) marks which
flagged branches ran.

**Paired report** (per config vs the first config named): the old table,
then over *live* games only (config's `fired` non-empty, or (alive, tiles)
differ from the baseline): `n_live`, W/L/T by score, mean paired score
difference with a bootstrap 95% CI (1000 resamples, seed 0), a two-sided
exact sign test on W vs L, and a verdict — `decisive win` / `decisive loss`
when p < 0.05, else `undecided (n_live=…)`. `--fitness` emits the new score
(`--old-fitness` for the old one) plus `per_game` matrices; `--ladder`,
`--at`, `--verdict` are unchanged; `--selftest` checks the formulas on an
inline 3-game fixture.

**cmaes.py noise handling:** every generation also runs the distribution
mean as config `mean` (`--reeval-mean`, default on); the value handed to
CMA-ES for a member is the mean over the grid of (member score − `mean`
score on the same game), a common-random-numbers paired difference
(`--raw-fitness` = old behaviour). `--games-growth` adds `--extra-batches`
(`med5 … med9`, SPAWNRANK 5–9) once sigma < `--grow-below` (0.12), so late
generations run 60 games per config. `gen_N.json` stores `batches`,
`per_game` / `per_game_old` matrices, `objective`, `objective_kind`;
`--rescore OUT` recomputes those from the stored ab30 files without running
anything (CMA states are left alone — populations were sampled from them).
Verified with `--dry-run --pop 4 --gens 3 --grow-below 1.0 --games-growth`
(forces the 60-game grid from gen 0), a resume and a `--rescore`.

**ladder.sh:** `MINUTES` defaults to 30 (graduation length — 20-minute games
truncate the endgame) and `SHIFT` (default 150) moves every spawn region by
that many tiles (`tests/lab/playbook.lab.ts` reads `process.env.SHIFT`), so a
candidate is confirmed on a grid it was not tuned on. `sweep.sh` passes it
through implicitly (the game processes inherit the environment), so
`RUNNER=local` honours it; **`remote.sh` builds the box's env list by hand
(`CONFIGS MINUTES SHARD BATCHES SPAWNS JOBS`) and does not forward `SHIFT`**
— a remote ladder runs on the unshifted grid until `remote.sh` adds
`${SHIFT:+SHIFT=$SHIFT}` to that list (not edited here; ladder.sh prints a
note). Both tables (`fit_old` and `score`) and the Bradley–Terry ladder are
printed.

**C3 rounds re-scored** (no `players=` field yet; N from the transcripts).
Live stats vs base, `dScore` = mean paired score difference [bootstrap 95% CI],
p = sign test:

Round 1 (`lab-out/c3`, base = `{}`):

| config | fit_old | score | n_live | W-L-T | dScore | p | verdict | recorded in C3 |
|---|---|---|---|---|---|---|---|---|
| base | 1.846 | 1.672 | — | — | — | — | — | — |
| realRetreats | 2.091 | 1.793 | 29/30 | 17-12-0 | +0.126 [−0.036, +0.293] | 0.458 | undecided | **graduated** (18W 11L) |
| c1 bundle | 1.907 | 1.802 | 30/30 | 18-12-0 | +0.131 [−0.062, +0.318] | 0.362 | undecided | 18W 12L, unbundled |
| scoredSpend | 1.652 | 1.604 | 29/30 | 14-15-0 | −0.070 [−0.240, +0.086] | 1.000 | undecided | dropped (12W 17L) |
| simWars | 1.126 | 1.394 | 30/30 | 8-22-0 | −0.277 [−0.430, −0.102] | 0.016 | **decisive loss** | dropped (7W 23L) |

Round 2 (`lab-out/c3b`, base = realRetreats):

| config | fit_old | score | n_live | W-L-T | dScore | p | verdict | recorded in C3 |
|---|---|---|---|---|---|---|---|---|
| base | 2.091 | 1.793 | — | — | — | — | — | — |
| + c1 bundle | 1.936 | 1.736 | 30/30 | 18-12-0 | −0.058 [−0.294, +0.172] | 0.362 | undecided | 17W 13L, "gain was realRetreats" |
| + bsrReserve | 1.893 | 1.819 | 30/30 | 14-16-0 | +0.025 [−0.162, +0.212] | 0.856 | undecided | dropped (14W 16L) |
| + trustWars | 2.200 | 1.845 | 10/30 | 6-4-0 | +0.155 [−0.199, +0.501] | 0.754 | undecided | mild positive, 20 identical |
| + nationAware | 2.148 | 1.853 | 15/30 | 9-6-0 | +0.119 [−0.047, +0.283] | 0.607 | undecided | mild positive, 15 identical |
| + phaseGates | 1.919 | 1.768 | 29/30 | 11-18-0 | −0.027 [−0.216, +0.156] | 0.265 | undecided | dropped (11W 18L) |

Round 3 (`lab-out/c3c`, base = realRetreats):

| config | fit_old | score | n_live | W-L-T | dScore | p | verdict | recorded in C3 |
|---|---|---|---|---|---|---|---|---|
| base | 2.091 | 1.793 | — | — | — | — | — | — |
| + trustWars + nationAware | 2.336 | 1.917 | 19/30 | 10-9-0 | +0.194 [+0.018, +0.363] | 1.000 | undecided | **graduated** (11W 8L, 11 identical) |

Where the verdicts differ from the C3 record: **realRetreats** and
**trustWars+nationAware** were graduated on raw W/L counts; under the new
scoring both are `undecided` — realRetreats' CI straddles zero (p = 0.46),
and trustWars+nationAware has only 19 live games at 10-9 (p = 1.0) although
its mean gain is positive with a CI that just excludes zero (+0.018 … +0.363;
the gain is in magnitude — 3 more crowns — not in the count of games won).
Neither is contradicted, but neither was decisive at 30 games; a 60-game
shifted-grid confirmation (`ladder.sh`, SHIFT=150, 30 min) is the right
next step for both. The c1 bundle on top of realRetreats flips from a mild
paired win (17W 13L on tiles) to a slight negative mean score (−0.058),
consistent with the C3 note that its round-1 gain was realRetreats'. Of the
drops only **simWars** is a decisive loss (p = 0.016); scoredSpend,
bsrReserve and phaseGates are undecided — dropped on direction, not
evidence. Nothing on Hetzner was run for this section.

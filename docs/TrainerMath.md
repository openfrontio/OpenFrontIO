# Trainer Math — the numbers behind OpenFront skill

This document derives, from `src/core` source, the formulas that decide who wins
an OpenFront game, and explains how the **trainer client** turns each of them
into a feedback signal you can build muscle memory against.

Everything here is read straight from the deterministic simulation
(`src/core/configuration/Config.ts`, `src/core/execution/AttackExecution.ts`,
`src/core/execution/PlayerExecution.ts`). The trainer changes **nothing** about
these mechanics — it only computes and displays them.

Conventions: one tick = 100 ms (`msPerTick()`), so 10 ticks per second.
`T` = your troops, `M` = your max troops, `A` = troops committed to an attack,
`D` = defender's total troops, `tiles_D` = defender's tile count.

---

## 1. Population growth — why the indicator turns orange

Applied every tick in `PlayerExecution.tick()`:

```
maxTroops  M = 2 · (tiles^0.6 · 1000 + 50 000) + Σ(finished city levels) · 250 000
growth  g(T) = (10 + T^0.73 / 4) · (1 − T / M)      troops per tick
```

Two forces fight each other: the base term `10 + T^0.73/4` **rises** with
troops (more people, more reproduction), while the crowding term `1 − T/M`
**falls** toward zero as you approach cap.

### The 42% rule

Setting `dg/dT = 0` (and ignoring the tiny `+10`):

```
0.73 · T^-0.27 · (1 − T/M) = T^0.73 / M
⇒ 0.73 · (1 − f) = f          where f = T/M
⇒ f* = 0.73 / 1.73 ≈ 0.422
```

**Absolute growth peaks when your troops sit at ≈ 42% of max.** The trainer
solves the exact optimum numerically each tick (the `+10` shifts it slightly
for tiny players).

How brutal the falloff is — growth as a fraction of peak growth:

| T / M | growth vs peak |
| ----- | -------------- |
| 20%   | 76%            |
| 42%   | **100%**       |
| 60%   | 91%            |
| 80%   | 55%            |
| 90%   | 30%            |
| 95%   | 16%            |
| 100%  | 0%             |

The vanilla UI hints at this with a subtle orange tint. The trainer instead
shows **growth efficiency** `g(T) / g(T*)` as a huge meter, plus a running
**wasted-growth counter**: every tick you idle above the optimum, the troops
you *didn't* grow are added to a shame total. That number is the cost of
hoarding.

### What this teaches

- Territory converts to max troops sublinearly (`tiles^0.6`) — doubling land
  does **not** double cap. Early tiles are worth far more than late ones.
- A finished city adds a flat **250 000** max troops per level — read: each
  city level moves your 42% sweet spot up by ~105 000 troops.
- Sitting at 95% cap grows at 16% speed. **Full is broke.** Attack or build.

## 2. Combat — the 1.66× commit rule

From `Config.attackLogic()`, evaluated **per tile conquered**:

```
terrain magnitude  mag = 80 (plains) | 100 (highland) | 120 (mountain)
terrain speed    speed = 16.5        | 20             | 25
```

Modifiers on `mag` (and mostly `speed`):

- Defender tile within 30 of their **defense post**: `mag × 5`, `speed × 3`.
- Human/Nation attacking a **bot**: `mag × 0.7`.
- Defender is a **traitor**: `mag × 0.5`, `speed × 0.8`.
- **Fallout** on the tile: ×(5 − 2·falloutRatio) — nuked ground bites back.
- Very large attackers/defenders (≈100k+ tiles) get sigmoid debuffs
  (midpoint 150 000 tiles) that soften snowballing.

### Attacker losses per tile (vs a player)

```
L_att = 0.6 · clamp(D/A, 0.6, 2) · mag · 0.8 · (debuffs…)
      + 0.4 · 1.3 · (D / tiles_D) · mag/100
```

The first term is the one you control. `clamp(D/A, 0.6, 2)`:

- **A ≥ 1.667 · D** → clamp bottoms out at 0.6. Committing more than 1.66×
  the defender's entire army buys **nothing further** — pure growth waste.
- **A ≤ 0.5 · D** → clamp caps at 2. You pay **3.3× more per tile** than a
  properly-sized attack. This is the classic beginner bleed-out.

The second term is the defender's **density** `D / tiles_D`: fat defenders on
small land are expensive to chew; overextended defenders are nearly free.

### Defender losses per tile

```
L_def = D / tiles_D        (their current density, recomputed each tile)
```

The defender loses exactly one "tile's worth" of army per tile lost — they
never lose troops faster than their density. Two consequences the trainer
surfaces:

- **Your density is your armor.** Expanding thin doesn't just look weak, it
  arithmetically cheapens every tile of you.
- Attacking never "kills" a hoarding turtle efficiently — you grind their land,
  their density rises as tiles vanish, and each next tile costs more.

### Attack speed

Per tick, an attack gets a budget of tile-points
(`attackTilesPerTick`), then each conquered tile spends from it
(`tilesPerTickUsed`):

```
budget  = clamp(10·A / D, 0.01, 0.5) · borderSize · 3
cost    = clamp(D / (5·A), 0.2, 1.5) · speed · (post/traitor/size modifiers)
```

- Budget maxes once `A ≥ D/20`; per-tile cost bottoms out once **A ≥ D**.
- **Border size is a direct multiplier.** Doubling the shared border doubles
  conquest speed — the math behind "widen your front before you push".

### Expanding into wildlands (terra nullius)

```
loss per tile = mag / 5      (16 / 20 / 24 troops — flat, trivial)
cost per tile = clamp(2000 · max(10, speed) / A, 5, 100)
budget        = borderTiles · 2
```

Losses are negligible; **speed** is everything, and it scales with committed
troops until `A ≥ 400·speed` (≈ 6 600 troops on plains) where it saturates.
That's the number behind the community's "wait until ~5k troops before your
first big land grab" — and why re-expanding with a dribble of troops crawls.

### Attack bookkeeping worth knowing

(`AttackExecution.init` / `retreat`)

- Opposing attacks **cancel out** troop-for-troop on contact.
- New land attacks against the same target **merge** into one.
- Retreating from a player attack costs **25%** of the attacking force.
- Default commit if no ratio chosen: `troops / 5`; boats always carry
  `troops / 5`.

## 3. Economy

- Base income: flat **100 gold/tick** (1 000/s) for humans — `goldAdditionRate`.
- **Trade ships**: sigmoid on route distance,
  `75 000 / (1 + e^(−0.03·(dist − 300))) + 50·dist` — short routes are heavily
  punished, long routes approach linear. Ports + long coastlines print money.
- **Trains**: 10 000 (self) / 25 000 (other/team) / 35 000 (ally) per delivery,
  −5 000 per city visited beyond ten, floor 5 000.
- **Cities/Ports/Factories** cost `125 000 · 2^n` (cap 1 000 000);
  defense posts `50 000 · (n+1)` (cap 250 000); warships `250 000 · (n+1)`
  (cap 1M); missile silo 1M; SAM `1.5M · (n+1)` (cap 3M);
  atom bomb 750k; hydrogen bomb 5M; MIRV 25M + 15M per MIRV ever launched.
- A captured player's gold: bots/nations drop **100%**, humans drop **50%**.

City ROI in trainer terms: a city's real yield here is **max-troop headroom**
(+250k cap ⇒ +105k on your optimal standing army and a faster growth curve),
not direct gold.

## 4. Timing constants that reward internal clocks

| Event                                  | Duration                 |
| -------------------------------------- | ------------------------ |
| Spawn phase (singleplayer)             | 100 turns                |
| Spawn immunity                         | 5 s (50 ticks)           |
| Alliance duration (default)            | 5 min                    |
| Alliance request cooldown              | 30 s                     |
| Traitor mark                           | 30 s                     |
| Temporary embargo                      | 5 min                    |
| City/Factory build                     | 2 s                      |
| Port / defense post build              | 5 s                      |
| Missile silo build                     | 10 s                     |
| SAM build                              | 30 s                     |
| Win threshold                          | 80% of land (95% teams)  |

## 5. What the trainer does with all this

Research on how players actually improve at OpenFront (wiki attack guides,
strategy docs, community lore) shows the skills are mostly **quantitative
habits** taught today by dying repeatedly: keep troops near the growth sweet
spot, size every attack against the 1.66× rule, read density before picking a
fight, widen borders before pushing, respect defense-post zones. None of that
feedback exists in the vanilla HUD — you find out an attack was oversized only
by feeling slow for the next three minutes.

The trainer client is the aim-trainer / chess-eval-bar version of the same
game — deliberately ugly, numbers-first. It ships as `<trainer-overlay>`
(`src/client/hud/layers/TrainerOverlay.ts`), active in **singleplayer games
only**, backed by the pure-math mirrors in `src/client/trainer/TrainerMath.ts`
(parity with `Config` enforced by `tests/TrainerMath.test.ts`):

1. **Growth efficiency meter** — `g(T)/g(T*)` as a big color-ramped percent
   with a BUILD / PEAK / HOARDING state badge, the exact optimal troop count
   marked on a troop-position bar, and the cumulative **wasted-growth
   counter**: troops you didn't grow while idling above the optimum. The
   vanilla orange tint, taken to the n-th degree.
2. **Attack planner** — hover any enemy: their troops, density (theirs vs
   yours), the **min-loss commit** `1.667·D` translated into the attack-ratio
   slider % that reaches it, your currently planned commit, a verdict badge
   (UNDERCOMMIT / EFFICIENT / OVERKILL), and a tile-by-tile forecast — kills
   or stalls, predicted losses vs the theoretical minimum.
3. **Post-attack report cards** — when an attack ends, actual losses vs the
   theoretical minimum for the tiles actually taken, graded S–F. The baseline
   assumes plains with no defense posts, so a bad grade on a mountain push is
   the lesson, not a bug.
4. **Wildland speed meter** — how close your current commit is to expansion
   speed saturation, and the troop count that reaches it.
5. **Spawn hint** — spawn-phase guidance (singleplayer ends spawn the moment
   you click).

All of it reads game state through the existing view layer (`GameView` /
`PlayerView`); none of it touches `src/core` mechanics, and it renders nothing
in multiplayer or replays.

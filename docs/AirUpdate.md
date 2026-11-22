# AIR — Aerial Warfare & Advanced Defence

The AIR update adds helicopters, fixed-wing aircraft, radar and a layered air
defence to the game. It is built on the existing systems rather than beside
them: aircraft are ordinary units with ordinary executions, are built through
`build_unit`, are commanded through `move_warship`, travel in the same
`UnitUpdate` stream, and are saved by the same snapshot system.

## Units

| Unit                 | Kind      | Altitude | Role                                                                              |
| -------------------- | --------- | -------- | --------------------------------------------------------------------------------- |
| Airbase              | Structure | —        | Launches, refuels, repairs and rearms aircraft. Short approach radar (50).        |
| Radar Station        | Structure | —        | Tracks aircraft for SAMs and fighters. Range 100 at level 1, approaching 200.     |
| AA Gun               | Structure | —        | Short-range flak (32 tiles) against any aircraft; one barrel per level (max 4)    |
| Attack Helicopter    | Aircraft  | Low      | Hovers on station; rockets transport boats, warships and helicopters.             |
| Transport Helicopter | Aircraft  | Low      | Air assault: lands 1/10 of the owner's troops as an attack, or reinforces.        |
| Fighter              | Aircraft  | High     | Orbits its station; guided missiles against aircraft. Uses friendly radar.        |
| Bomber               | Aircraft  | High     | Strikes a hostile tile: nearby structures lose a level; the owner loses 3% troops |

The existing **SAM Launcher** becomes the medium/long-range layer: after nukes
(which keep absolute priority) it fires at radar-tracked _high-altitude_
aircraft in range. Every missile spent on an aircraft is one fewer ready for
a nuke, so no single structure covers everything.

| Threat            | AA Gun | SAM                   | Fighter                   |
| ----------------- | ------ | --------------------- | ------------------------- |
| Helicopters (low) | yes    | no (below envelope)   | yes (own sensor or radar) |
| Jets (high)       | yes    | yes, if radar-tracked | yes (own sensor or radar) |
| Nukes             | no     | yes (first priority)  | no                        |

## Mechanics

**Sortie cycle.** An aircraft spawns docked at the owner's airbase nearest
to the ordered tile, then cycles _docked → patrolling → retreating → docked_.
This is the existing `WarshipState` (`retreatPort` is the airbase it returns
to), so the wire format, snapshots and the client's "retreating" rendering
are shared with warships.

**Fuel, ammunition, flares** (`AircraftState` on the unit). Fuel burns one
unit per airborne tick. An aircraft flies home when fuel would not last the
trip back (plus a margin) or its magazine is empty. Docked, it refuels and
repairs at a rate that scales with the airbase level, then rearms. With no
airbase left it loiters until its tank runs dry and crashes. This limits
range and endurance without touching the economy.

**Orders.** A move order sets the patrol tile: a fighter's or helicopter's
station, a bomber's aim point, a transport helicopter's landing zone. An
order onto one of your own airbases stands the aircraft down there. Fixed
wing aircraft orbit their station; helicopters hover.

**Radar and detection** (`engine-lib/game/AirRules.ts`). A side tracks an
aircraft when one of its own or its allies' radar stations or airbases has it
in range. Helicopters fly low and are seen at half range (terrain masking).
Structures under construction see nothing. SAMs need a radar track; fighters
use their own 60-tile sensor and extend it with radar up to their commit
range; AA guns and attack helicopters use only their own fire control. The
rule is shared code so the client could render exactly the same coverage the
engine uses. There is no fog of war in this game, so radar decides who can
_engage_ an aircraft, not who can _see_ it.

**Countermeasures.** Guided missiles (SAM interceptors and fighters'
air-to-air missiles) are homing `SAMMissile` units. On reaching an aircraft
that still has flares, one flare is expended and decoys the missile with a
50% chance; otherwise the missile hits with its profile's hit chance (SAM
90%, air-to-air 80%). Rolls use a seeded PRNG stored in the snapshot. Flak
and rockets reuse `ShellExecution` and cannot be decoyed.

## AI

`NationAirBehavior` runs after the structure behaviour on each nation's
attack tick and does at most one thing per call, in priority order:

1. AA guns at structures that hostile aircraft are approaching.
2. An airbase next to its first city once it has three cities.
3. A radar station (by a SAM) once hostile aircraft exist.
4. Fighters to contest the hostile aircraft it faces (capped by difficulty).
5. Attack helicopters against boats and warships near its structures.
6. Bombers against the least-defended valuable structure of the player it
   is attacking; bombers whose target is destroyed are retasked.

**Balancing against the existing priorities.** Planned purchases need twice
their cost in the treasury and must fit an _air budget_ of 200k of air assets
per city level (the same ratio-to-cities idea the structure behaviour uses);
nations also buy at most one aircraft per two city levels over the whole game,
so losses are not endlessly replaced. Only reactive AA guns (cheap, and only
while hostile aircraft are near its structures) sit outside the budget. Two
rejected alternatives, measured with a 40-minute all-nation world game:

- spending whenever gold was 2–3× the cost crowded out 10–25% of cities,
  ports and factories;
- spending only gold above the nuke savings target meant nations never flew
  anything at all.

With the budget, nations field airbases, radars, AA guns, fighters,
helicopters and the odd bomber, and `NationGoldPerMinute` moves by about 5%
fewer cities mid-game with trade and train gold within normal variation.

It is stateless — every decision is a pure function of the game state — so
it adds nothing to the nation snapshot and draws nothing from the nations'
shared PRNG. Easy nations and the tutorial do not use aircraft. Nations do
not use transport helicopters.

## Client

- **Build menu**: a new AIR row (airbase, radar, AA gun, fighter, bomber,
  attack and transport helicopter); the hotbar shows them too. Aircraft are
  greyed out without an airbase. Hosts can disable each unit in the lobby.
- **Sprites**: four top-down aircraft sprites appended to the unit atlas,
  drawn in the air layer above structures; three structure icons and shapes
  (diamond, heptagon, inverted triangle) appended to the icon atlas.
  Aircraft reuse the warship flags: red while engaging, blinking while
  returning to base.
- **Radar coverage**: the SAM range ring pass is parameterized by structure
  type; a second instance draws radar coverage (green own, yellow allied,
  red enemy) while placing radars, SAMs, AA guns, airbases or aircraft.
  Placing a radar, AA gun or airbase also shows its own range.
- **Selection and orders**: click (or shift-drag) your aircraft to select
  them, then click anywhere — land or sea — to set their station, strike
  target or landing zone. While aircraft are selected the click is not a
  ground attack.
- **Hover info**: aircraft show owner, type, altitude, mission (airborne,
  returning, at airbase), fuel %, ammunition and flares.
- **Feedback**: events for lost aircraft, bomber strikes on you and decoyed
  missiles; existing sound cues and explosion effects are reused.

## Architecture decisions

- **New `UnitType` values are appended** to the enum and to
  `PACKED_UNIT_TYPES` (slots 17–23 of the 5-bit field), so existing wire
  indices and zod enum indices do not shift.
- **One packed float** (`OFFSET_AIRCRAFT`, stride 21 → 22) carries fuel, ammo
  and flares to the client.
- **Unit snapshot v2** adds `aircraftState`; the v1 migration fills `null`.
  New executions (`Aircraft`, `GuidedMissile`, `AAGun`, `AirStructure`) are
  registered in `ExecutionRegistry`.
- **SAM snapshot unchanged.** The SAM's aircraft engagement is stateless (an
  aircraft that already has one of this side's missiles inbound is skipped),
  and it returns before any query when no jet exists, so games without
  aircraft behave exactly as before.
- **`stepToward`** (8-directional, integer, O(1), no path cache) moves
  aircraft, so retargeting a moving contact every tick is cheap and
  needs no pathfinder state in snapshots.
- **Defences skip all work when nothing flies** (`noAircraftInFlight`, the
  SAM's jet count check), mirroring the SAM's existing no-nukes fast path.
- **Stats are untouched.** `StatsSchemas` feeds game records consumed by the
  closed-source API, so air units are not added to its unit keys.

## Known limitations

- No fog of war exists, so radar does not hide units on screen; it gates
  engagement.
- Sprites are top-down and, like every unit sprite, not rotated to heading.
- There are no mobile ground vehicles in this game (ground combat is
  territorial), so mobile air-defence vehicles are not implemented; the AA
  gun covers short-range point defence and the SAM's level-scaled range is
  the long-range layer.
- Aircraft are not counted in end-of-game stats (see above).
- Nations do not fly transport-helicopter air assaults.
- No new sound assets: existing cues are reused.
- Aircraft orders reuse the `move_warship` intent name for wire
  compatibility; a dedicated name would need a protocol change.

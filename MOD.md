# OpenFront mod: Tanks, Airports, Fighter Jets and Zombie Raid

This fork adds land and air units and a new game mode on top of OpenFront. It
keeps the original single-colour unicode/pixel look: every new sprite is a flat,
tintable shape like the existing ones. Icons come from Font Awesome Free
(CC BY 4.0, see `CREDITS.md`).

Everything is deterministic and lives inside the normal engine layers (seeded
PRNG, snapshot/restore, no `Math.random`), so replays and desync checks keep
working. Tunable numbers are in
`packages/engine-lib/src/game/ModRules.ts`; costs are in
`packages/engine/src/configuration/EngineConfig.ts`.

## New units

| Unit            | Build                        | What it does                                                                                                                                            |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tank**        | Build menu, needs a Factory  | A warship for land. Hunts enemy tanks, shoots the troops of attacks against you, steals enemy trains (engine plus nearby cars), heals on your own land. |
| **Airport**     | Build menu (upgradable)      | Launches cargo planes to other players' airports. Both owners are paid on arrival, like ports. Also speeds up cure research in Zombie Raid.             |
| **Fighter Jet** | Build menu, needs an Airport | Steals enemy cargo planes, attacks enemy jets and tanks, flies home to repair when damaged.                                                             |
| Cargo Plane     | Spawned by airports          | Flies a route between airports. If a jet steals it, the thief is paid on arrival.                                                                       |

Select tanks and jets like warships: click on one, shift-drag a box, or use
select-all, then click a destination (tanks need land, ships need water, jets
fly anywhere). Tanks and jets can be disabled in the lobby like any other unit.

## Zombie Raid

Enable it in the lobby ("Zombie Raid") and pick the outbreak time (1 to 60 min
after the spawn phase).

- **Outbreak.** Every player gets infection sites on their land. Infected land
  turns into a zombie faction (green) that fights like a tribe.
- **Reanimation.** After the outbreak, any tank, fighter jet or warship that is
  destroyed comes back as a zombie unit. Units of a player who has finished the
  cure stay dead.
- **Cure.** Each player researches a cure. Cities, airports and a small base
  rate add points; when it completes, your border slowly heals zombie land.
- **Survivors.** Survivor camps appear in zombie territory. Capture the land to
  rescue them for a permanent, stackable buff (5% per rescue): Medic (troops),
  Scavenger (gold), Researcher (cure speed), Gunner (tank and jet damage).
- The sidebar panel shows the countdown, your cure progress, survivors rescued
  and your buff stacks.

## Rebuilding the sprite atlases

`python3 scripts/mod/build_mod_atlases.py` appends the new columns to
`resources/atlases/icon-atlas.png` and `unit-atlas.png` (idempotent). Needs
Pillow and `rsvg-convert`.

## Tests

`tests/ModTankAirJet.test.ts`, `tests/ZombieRaid.test.ts` and
`tests/ModSnapshots.test.ts` cover the new simulation behaviour.

## Known limits

- Combat is direct damage; there are no shell or bullet visuals yet.
- Balance numbers are first guesses and have not been playtested.
- Replays do not carry the Zombie Raid HUD feed.
- Licensed AGPL-3.0 like upstream: if you host a modified version, publish its
  source.

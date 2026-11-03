# Onboarding Tutorial

Status: proposal. Nothing here is built yet.

## Problem

Poki playtest recordings show new players quitting within about 30 seconds. They struggle with the two things every game starts with: spawning, and attacking. Most never reach a building, a boat or a nation.

The in-game tutorial we have (`src/client/hud/Tutorial.ts`, `src/client/hud/layers/TutorialPanel.ts`) is a **guide**: a side panel with about 20 steps over a normal solo game on the World map, with the default nations and tribes and the clock running. It works for a player who already knows how to spawn and expand and wants to learn cities, ports and nukes. It doesn't help someone who doesn't know where they are yet. The map is huge, the player can click anything at any time, nations attack within the first minute, and the only instructions are text in a corner.

## Proposal

Split onboarding in two:

1. **Tutorial** (new): a short, scripted, guarded scenario that teaches only the basics. It takes about 2 minutes and always ends in a win.
2. **Guide** (existing): the step-by-step panel, unchanged, which keeps teaching the rest of the mechanics during the player's first real solo games.

The **Tutorial** buttons (the play page card and the help modal) start the new tutorial. The guide keeps showing in normal games until it's completed or dismissed, as it does today.

## The tutorial

### Steps

It opens with a welcome card that describes OpenFront in one sentence, with a **Start** button.

1. **Spawn.** A glowing zone marks the spawn area. Only a click inside it counts.
2. **Expand.** Click the empty land next to your territory.
3. **Troops.** A few seconds into expanding, before the player reaches the kingdom, the arrow points at the troop bar: troops grow fastest when it's about half full, so don't let it get too high or too low. **Got it** moves on.
4. **Attack the kingdom.** Reaching the Iron Kingdom, the player gets nuked from its silo. The arrow points at the silo; taking it, and most of the kingdom, makes the kingdom fall.
5. **Nuke the port.** The captured silo arms the atom bomb button. Only a bomb that would hit the Red Empire's port, and the warship moving around it, counts.
6. **Conquer the empire.** Send a boat to its coast, then attack its land until it falls.

The game ends with a victory screen that offers **Play a solo game**, which starts a normal solo game with the guide on.

### Guard rails

What makes it different from the guide:

- **Target.** A target marker and an animated arrow show where to click. The rest of the screen stays as it is. When the target is empty land, the marker covers only empty land.
- **Input gating.** Clicks and taps outside the current target are ignored, so the player can't wander off the script. Camera pan and zoom stay free, but the map fits on one screen, so they shouldn't be needed.
- **One sentence per step**, large and in the middle of the screen, not in a corner panel. Touch devices get their own wording, as the guide already does (`tutorial.step_touch.*`).
- **Low-troops rule.** New players click again and again and send their whole army away. The first time it happens, at any step:
  - the attack ratio starts low;
  - a big centered warning appears when troops drop below 10% of max ("Your troops are low — wait for them to regrow");
  - while it shows, attack clicks that would leave troops under that line are ignored. Once it goes away it never shows again, and attacks are never held back.

  The player learns to wait for troops by running into the rule, not by reading about it.

- **Passive nations.** The nations never send troops at the player; they only grow into free land and defend. The kingdom's nukes are the one attack, and they're shrunk so they hurt without wiping a new player out.

### Map

The tutorial uses a new, tiny map made for it (roughly 300×300) so the whole scenario fits on one screen:

- the player's island, with the spawn zone on its coast;
- the Iron Kingdom on the player's island, next to the spawn zone;
- a narrow strait;
- the Red Empire on the far side.

The map is generated through the usual map-generator pipeline (`docs/Maps.md`) and kept out of the solo and lobby map pickers.

### Engine changes

As little as possible. The client does the scripting, gating and warnings, which is safe because the tutorial is always singleplayer. The engine only needs to set up the scenario, behind one optional game-config field (e.g. `tutorial: true`):

- **Fixed tribe placement.** Tribes normally spawn at random (`TribeSpawner`). In the tutorial, the one tribe spawns at a fixed point from the map manifest.
- **Passive nation.** `NationExecution` skips its attack and expansion behaviours toward humans.
- **Win check.** The player wins once the nation is eliminated, whatever share of the land they hold.

Like every engine change, these need tests (`tests/util/Setup.ts` with the tutorial map in `tests/testdata/maps/`).

### Text

All step text, warnings and the victory screen go through `translateText()`, with new keys under a separate `onboarding` section in `resources/lang/en.json`, apart from the guide's `tutorial.*` keys.

## Entry points

- **First visit (not on a portal).** A modal: "New to OpenFront? Play the 2-minute tutorial" with **Start tutorial** and **Skip**. It shows while the player has played no games and hasn't finished or skipped the tutorial (a new `UserSettings` flag).
- **First visit on Poki or CrazyGames.** Skip the homepage and the modal and drop straight into the tutorial once the game has loaded, unless the portal sent the player to a lobby (an invite, or instant multiplayer). Portal players expect to be playing within seconds, and every extra click loses some of them. Joining the tutorial counts as a game played, so it happens once.
- **Tutorial card and help modal.** Start the tutorial at any time. The card keeps its current rule: it shows until the player has played 5 games (`TUTORIAL_CARD_MAX_GAMES`).

## Measuring it

Log when each step starts and finishes (spawn, expand, tribe, boat, nation, win, quit), so we can see where players drop off and compare against the Poki playtests. The rate we want to move is how many players get through spawning and their first attack.

## Out of scope

- Buildings, alliances, warships, nukes and other advanced mechanics. The guide covers those.
- Changing the guide's steps. Players who finished the tutorial will complete its first steps almost immediately, and skipping those for them can come later.
- Multiplayer onboarding.

## Build order

1. Tutorial map and the engine scenario (fixed tribe, passive nation, win check), with tests.
2. Overlay: target marker, pointer, input gating, on desktop and touch.
3. Step script, low-troops rule and victory screen.
4. First-visit modal and the portal auto-start.
5. Step logging.

# Running the PlaybookBot in the local OpenFront GUI

Handoff notes for an agent (or human) who needs to watch `PlaybookBotExecution`
play a single-player game in the real client. Everything here is local-only:
never point the bot at openfront.io (ToS §5 / §6.5 prohibit bots on the hosted
service; the AGPL local build is fine).

## Layout

| Path                   | Branch         | Purpose                                                                                                |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `~/Code/openfront`     | `playbook-bot` | Main checkout. Bot source, lab tests, active development.                                              |
| `~/Code/openfront-bot` | `bot-gui`      | Git worktree used **only** to run the GUI. `node_modules` is a symlink to `../openfront/node_modules`. |

Why two checkouts: Vite force-reloads the page whenever a file in the Web
Worker's module graph changes (`PlaybookBotExecution.ts`, `GameRunner.ts`, …).
A reloaded single-player game is lost, so editing the bot while watching it
kills the game within seconds. The worktree has its own module graph and only
changes when you deliberately sync it.

## How the hook works

- `src/client/ClientGameRunner.ts` — `playbookBotEnabled()`: true when the page
  was opened with `?bot=1` (captured at page load; the URL is rewritten to
  `/w0/game/<id>` when the game starts), or `localStorage.playbookBot === "1"`,
  or the build had `VITE_PLAYBOOK_BOT=1`. Only in dev builds otherwise.
- Flag travels `WorkerClient` → `InitMessage.playbookBot` → `createGameRunner()`
  → `GameRunner` (`src/core/GameRunner.ts`), single-player only.
- `GameRunner.executeNextTick()`: at tick 2 the bot picks its own spawn
  (`PlaybookBotExecution.pickSpawn`), and on the first tick after the spawn
  phase it adds `new PlaybookBotExecution(player)` for the local client.
- Test: `tests/PlaybookBotHook.test.ts` (`npx vitest tests/PlaybookBotHook.test.ts --run`).

## Run it

```bash
cd ~/Code/openfront-bot
npm run dev # Vite + game server. Read the "Local:" line — Vite moves
# to :9001 (or higher) if :9000 is already taken.
```

Then in Chrome open `http://localhost:<port>/?bot=1`:

1. Click **SOLO!**.
2. Settings: keep the default 400 tribes (what public games use; the lab uses
   400 too). Set Hard from the console with the modal open:
   ```js
   const m = document.querySelector("single-player-modal");
   m.handleConfigDifficultySelected(
     new CustomEvent("difficulty-selected", { detail: { difficulty: "Hard" } }),
   );
   ```
3. Click **Start Game**. The bot spawns itself ~2 ticks in and plays from there.
   Your own clicks still work alongside it.

Keep the tab focused: a background tab is throttled to ~1 tick/s (normal is 10).

Ground-truth state from the console (no repo changes needed):

```js
const g = document.querySelector("build-menu").game; // GameView
const me = g.myPlayer();
({
  tick: g.ticks(),
  tiles: me.numTilesOwned(),
  troops: me.troops(),
  attacks: me.outgoingAttacks().length,
});
```

If the page bounces back to the lobby mid-game, check the dev log for
`[vite] (client) page reload <file>` — something wrote to a watched file.

## Sync bot changes into the GUI

```bash
# 1. main checkout: commit the bot work on playbook-bot
cd ~/Code/openfront
git add src/core/execution/playbook tests src/core/GameRunner.ts # whatever changed
git commit -m "bot: ..."

# 2. worktree, between games (this triggers exactly one page reload)
cd ~/Code/openfront-bot
npm run bot:sync # = git merge --ff-only playbook-bot
```

## Pull upstream OpenFront

```bash
cd ~/Code/openfront
git fetch origin
git rebase origin/main playbook-bot
npm run inst                                             # only if package-lock.json changed (never npm install)
npx vitest tests/PlaybookBotHook.test.ts --run           # hook still wired?
cd ~/Code/openfront-bot && git reset --hard playbook-bot # ff-only merge won't work after a rebase
```

The hook touches ~25 upstream lines (`GameRunner.ts`, `src/core/worker/*`,
`ClientGameRunner.ts`), so conflicts are rare; if `Executor`/`GameRunner`
internals move, the hook test catches it.

## Headless alternative (no GUI)

`tests/lab/playbook.lab.test.ts` runs the same bot on the World map against real
nations + 30 tribes and writes a transcript to the session scratchpad:

```bash
cd ~/Code/openfront && npx vitest tests/lab/playbook.lab.test.ts --run
```

Differences from the GUI: `TestConfig` sets spawn immunity to 0 and the port
proximity bonus to 0; everything else is the production `Config`.

## Known dead end

A static production build (`VITE_PLAYBOOK_BOT=1 vite build`, served by
`npm run start:server-dev` on :3000) hangs at "Game is Starting…": the worker
script and map load, but the worker never posts `initialized`. Not debugged.

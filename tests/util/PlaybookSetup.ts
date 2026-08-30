// Harness for rule-level PlaybookBot tests (docs/PlaybookBotPlan.md, package A1).
//
// Builds a small real game on `setup()`, spawns the bot and a list of scripted
// opponents at fixed tiles, ends the spawn phase, attaches PlaybookBotExecution
// and exposes `step(n)`, the bot instance and its log. Nothing is mocked: the
// opponents are ordinary players whose armies the test drives with
// AttackExecution / AllianceRequestExecution, or real NationExecutions when
// `ai: true` is set (the golden test uses those).
import { Config } from "../../src/core/configuration/Config";
import { AttackExecution } from "../../src/core/execution/AttackExecution";
import { NationExecution } from "../../src/core/execution/NationExecution";
import {
  DEFAULT_PLAYBOOK,
  PlaybookBotExecution,
  PlaybookParams,
} from "../../src/core/execution/playbook/PlaybookBotExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import {
  Cell,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  TerraNullius,
} from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";
import { GameConfig } from "../../src/core/Schemas";
import { setup } from "./Setup";
import { TestConfig } from "./TestConfig";

/** TestConfig with the real attack maths, as in tests/lab/playbook.lab.test.ts: the bot's retreat,
 *  counter and tribe rules only make sense against the production loss curves. */
export class PlaybookTestConfig extends TestConfig {
  attackLogic(
    gm: Game,
    a: number,
    at: Player,
    d: Player | TerraNullius,
    t: TileRef,
  ) {
    return Config.prototype.attackLogic.call(this, gm, a, at, d, t);
  }
  attackTilesPerTick(
    a: number,
    at: Player,
    d: Player | TerraNullius,
    n: number,
  ) {
    return Config.prototype.attackTilesPerTick.call(this, a, at, d, n);
  }
}

/** Inclusive rectangle [x0, y0, x1, y1] of tiles handed to a player after it spawns. A spawn circle is 52
 *  tiles and falls to a real attack in a few ticks; rule tests need territories the size of a real border. */
export type Rect = [number, number, number, number];

export interface RivalSpec {
  name: string;
  type: PlayerType;
  at: [number, number];
  troops?: number;
  tiles?: Rect;
  /** Run the real NationExecution for this player (Nation type only). */
  ai?: boolean;
}

export interface PlaybookSetupOptions {
  map?: string;
  bot?: Partial<PlaybookParams>;
  /** Bot spawn centre; the spawn circle has radius 4. */
  spawn?: [number, number];
  troops?: number;
  tiles?: Rect;
  rivals?: RivalSpec[];
  config?: Partial<GameConfig>;
  gameID?: string;
}

export interface PlaybookHarness {
  game: Game;
  me: Player;
  bot: PlaybookBotExecution;
  log: string[];
  rivals: Player[];
  rival(name: string): Player;
  /** Run n ticks. */
  step(n: number): void;
  /** Run until `pred` holds or `max` ticks passed; returns true if it held. */
  until(pred: () => boolean, max: number): boolean;
  /** A land attack from `from` on `target` (a Player or terra nullius). */
  attack(from: Player, target: Player | TerraNullius, troops: number): void;
  /** Number of `step`s after which a rule with period `every` has just run (the rule table uses
   *  `ticks % every === 0`, evaluated with the tick number before it is incremented). */
  nextRuleTick(every: number): number;
}

export const PLAYBOOK_GAME_ID = "playbook_test";

export async function playbookSetup(
  opts: PlaybookSetupOptions = {},
): Promise<PlaybookHarness> {
  const gameID = opts.gameID ?? PLAYBOOK_GAME_ID;
  const game = await setup(
    opts.map ?? "plains",
    { ...opts.config },
    [],
    undefined,
    PlaybookTestConfig,
    false,
  );
  const [sx, sy] = opts.spawn ?? [50, 50];

  // opponents first so their spawn circles are settled before the bot's
  const rivalInfos: { spec: RivalSpec; info: PlayerInfo }[] = [];
  for (const spec of opts.rivals ?? []) {
    const info = new PlayerInfo(
      spec.name,
      spec.type,
      null,
      `rival_${spec.name}`,
    );
    rivalInfos.push({ spec, info });
    if (spec.ai) {
      if (spec.type !== PlayerType.Nation)
        throw new Error("ai rivals must be nations");
      game.addExecution(
        new NationExecution(
          gameID,
          new Nation(new Cell(spec.at[0], spec.at[1]), info),
        ),
      );
    } else {
      game.addPlayer(info);
      game.addExecution(
        new SpawnExecution(gameID, info, game.ref(spec.at[0], spec.at[1])),
      );
    }
  }
  for (let i = 0; i < 3; i++) game.executeNextTick();

  const info = new PlayerInfo(
    "PlaybookBot",
    PlayerType.Human,
    null,
    "playbook",
  );
  game.addPlayer(info);
  game.addExecution(new SpawnExecution(gameID, info, game.ref(sx, sy)));
  for (let i = 0; i < 2; i++) game.executeNextTick();
  if (game.inSpawnPhase()) game.endSpawnPhase();

  const me = game.player(info.id);
  if (opts.tiles) conquerRect(game, me, opts.tiles);
  if (opts.troops !== undefined) me.setTroops(opts.troops);
  const rivals: Player[] = [];
  for (const { spec, info: ri } of rivalInfos) {
    const p = game.player(ri.id);
    if (spec.tiles) conquerRect(game, p, spec.tiles);
    if (spec.troops !== undefined) p.setTroops(spec.troops);
    rivals.push(p);
  }

  const bot = new PlaybookBotExecution(me, {
    ...DEFAULT_PLAYBOOK,
    ...opts.bot,
  });
  game.addExecution(bot);

  const step = (n: number) => {
    for (let i = 0; i < n; i++) game.executeNextTick();
  };
  return {
    game,
    me,
    bot,
    log: bot.log,
    rivals,
    rival: (name) => {
      const r = rivals.find((p) => p.name() === name);
      if (!r) throw new Error(`no rival ${name}`);
      return r;
    },
    step,
    until: (pred, max) => {
      for (let i = 0; i < max; i++) {
        if (pred()) return true;
        game.executeNextTick();
      }
      return pred();
    },
    attack: (from, target, troops) => {
      game.addExecution(new AttackExecution(troops, from, target.id()));
    },
    nextRuleTick: (every) => {
      // executions run with the pre-increment tick: the rule for tick T runs inside the
      // executeNextTick() call that moves game.ticks() from T to T+1
      const t = game.ticks();
      return t % every === 0 ? 1 : every - (t % every) + 1;
    },
  };
}

export function conquerRect(
  game: Game,
  p: Player,
  [x0, y0, x1, y1]: Rect,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = game.ref(x, y);
      if (game.isLand(t) && game.owner(t) !== p) p.conquer(t);
    }
  }
}

/** Smallest manhattan distance from `tile` to any tile owned by `p`. */
export function distToPlayer(game: Game, tile: TileRef, p: Player): number {
  let best = Infinity;
  for (const t of p.tiles()) {
    const d = game.manhattanDist(t, tile);
    if (d < best) best = d;
  }
  return best;
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MessageType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  AttackUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
// Side-effect import: the @customElement decorator registers <attacks-display>.
import "../../src/client/hud/layers/AttacksDisplay";
import type { AttacksDisplay } from "../../src/client/hud/layers/AttacksDisplay";
import { GoToUnitEvent } from "../../src/client/TransformHandler";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  SendAttackIntentEvent,
} from "../../src/client/Transport";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";

const ME = 1;
const ENEMY = 2;
const BOT = 3;
const RAIDER = 4;

function player(smallID: number, type = PlayerType.Human) {
  return {
    smallID: () => smallID,
    id: () => `p${smallID}`,
    type: () => type,
    displayName: () => `Player${smallID}`,
  };
}

const players = new Map([
  [ENEMY, player(ENEMY)],
  [BOT, player(BOT, PlayerType.Bot)],
  [RAIDER, player(RAIDER)],
]);

function attack(
  attackerID: number,
  targetID: number,
  id: string,
  troops = 1000,
  retreating = false,
): AttackUpdate {
  return { attackerID, targetID, troops, id, retreating };
}

function boat(
  id: number,
  owner: ReturnType<typeof player>,
  { retreating = false, target = 50 } = {},
) {
  return {
    id: () => id,
    type: () => UnitType.TransportShip,
    isActive: () => true,
    troops: () => 500,
    owner: () => owner,
    targetTile: () => target,
    transportShipState: () => ({ isRetreating: retreating }),
  };
}

interface World {
  incoming?: AttackUpdate[];
  outgoing?: AttackUpdate[];
  myBoats?: ReturnType<typeof boat>[];
  boatsAtMe?: ReturnType<typeof boat>[];
  alive?: boolean;
  spawnPhase?: boolean;
}

describe("attacks-display", () => {
  let display: AttacksDisplay;
  let eventBus: EventBus;
  let events: unknown[];

  function setUp(world: World) {
    const me = {
      ...player(ME),
      isAlive: () => world.alive ?? true,
      troops: () => 10_000,
      incomingAttacks: () => world.incoming ?? [],
      outgoingAttacks: () => world.outgoing ?? [],
      units: () => world.myBoats ?? [],
    };
    const units = new Map(
      [...(world.myBoats ?? []), ...(world.boatsAtMe ?? [])].map((u) => [
        u.id(),
        u,
      ]),
    );
    display.game = {
      inSpawnPhase: () => world.spawnPhase ?? false,
      ticks: () => 100,
      myPlayer: () => me,
      playerBySmallID: (id: number) => (id === ME ? me : players.get(id)),
      unit: (id: number) => units.get(id),
      // Tile 50 is wilderness, any other tile belongs to the enemy.
      ownerID: (tile: number) => (tile === 50 ? 0 : ENEMY),
      // Boat 7 lands 50 ticks from now: 5s at 100ms a tick.
      motionPlans: () =>
        new Map([
          [7, { path: new Array(10), ticksPerStep: 10, startTick: 50 }],
        ]),
      config: () => ({ msPerTick: () => 100 }),
      updatesSinceLastTick: () => ({
        [GameUpdateType.UnitIncoming]: (world.boatsAtMe ?? []).map((u) => ({
          unitID: u.id(),
          playerID: ME,
          messageType: MessageType.NAVAL_INVASION_INBOUND,
        })),
      }),
    } as unknown as GameView;
    display.tick();
    return display.updateComplete;
  }

  const rows = () => [...display.querySelectorAll("[data-attack-row]")];
  const row = (dir: string, kind: string) =>
    display.querySelector(
      `[data-attack-row][data-attack-dir="${dir}"][data-attack-kind="${kind}"]`,
    ) as HTMLElement;
  const action = (r: Element, name: string) =>
    r.querySelector(`[data-attack-action="${name}"]`) as HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    display = document.createElement("attacks-display") as AttacksDisplay;
    eventBus = new EventBus();
    events = [];
    const record = (e: unknown) => events.push(e);
    eventBus.on(SendAttackIntentEvent, record);
    eventBus.on(CancelAttackIntentEvent, record);
    eventBus.on(CancelBoatIntentEvent, record);
    eventBus.on(GoToUnitEvent, record);
    display.eventBus = eventBus;
    display.uiState = { attackRatio: 0.2 } as UIState;
    document.body.appendChild(display);
  });

  afterEach(() => {
    display.remove();
  });

  it("shows one row per attack and boat, marked with its direction and kind", async () => {
    await setUp({
      incoming: [attack(ENEMY, ME, "in-1")],
      outgoing: [attack(ME, ENEMY, "out-1"), attack(ME, 0, "land-1")],
      myBoats: [boat(7, player(ME))],
      boatsAtMe: [boat(8, player(RAIDER))],
    });

    expect(rows()).toHaveLength(5);
    expect(row("in", "attack").textContent).toContain("Player2");
    expect(row("in", "boat").textContent).toContain("Player4");
    expect(row("out", "attack").textContent).toContain("Player2");
    expect(row("out", "land")).not.toBeNull();
    expect(row("out", "boat")).not.toBeNull();
  });

  it("leaves out attacks by bots", async () => {
    await setUp({
      incoming: [attack(BOT, ME, "bot-1"), attack(ENEMY, ME, "in-1")],
    });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Player2");
  });

  it("renders nothing during the spawn phase, for a dead player, or with no attack", async () => {
    const outgoing = [attack(ME, ENEMY, "out-1")];

    await setUp({ outgoing, spawnPhase: true });
    expect(rows()).toHaveLength(0);

    await setUp({ outgoing, alive: false });
    expect(rows()).toHaveLength(0);

    await setUp({});
    expect(rows()).toHaveLength(0);
  });

  it("lists attacks on me first, then boats coming at me, then mine", async () => {
    await setUp({
      incoming: [attack(ENEMY, ME, "in-1")],
      outgoing: [attack(ME, ENEMY, "out-1"), attack(ME, 0, "land-1")],
      myBoats: [boat(7, player(ME))],
      boatsAtMe: [boat(8, player(RAIDER))],
    });

    expect(
      rows().map(
        (r) =>
          `${r.getAttribute("data-attack-dir")} ${r.getAttribute("data-attack-kind")}`,
      ),
    ).toEqual(["in attack", "in boat", "out attack", "out land", "out boat"]);
  });

  it("retaliates with the smaller of their troops and my share of mine", async () => {
    await setUp({
      incoming: [
        attack(ENEMY, ME, "small", 1500),
        attack(RAIDER, ME, "big", 50_000),
      ],
    });

    const [small, big] = rows();
    action(small, "retaliate").click();
    action(big, "retaliate").click();

    expect(events).toHaveLength(2);
    const [first, second] = events as SendAttackIntentEvent[];
    expect(first).toBeInstanceOf(SendAttackIntentEvent);
    expect([first.targetID, first.troops]).toEqual(["p2", 1500]);
    // 20% of my 10,000 troops.
    expect([second.targetID, second.troops]).toEqual(["p4", 2000]);
  });

  it("offers no retaliation on a retreating attack", async () => {
    await setUp({ incoming: [attack(ENEMY, ME, "in-1", 1000, true)] });

    expect(action(row("in", "attack"), "retaliate")).toBeNull();
  });

  it("cancels an attack by its id and a boat by its unit id", async () => {
    await setUp({
      outgoing: [attack(ME, ENEMY, "out-1"), attack(ME, 0, "land-1")],
      myBoats: [boat(7, player(ME))],
    });

    action(row("out", "attack"), "cancel").click();
    action(row("out", "land"), "cancel").click();
    action(row("out", "boat"), "cancel").click();

    expect(events).toHaveLength(3);
    const [a, land, b] = events;
    expect(a).toBeInstanceOf(CancelAttackIntentEvent);
    expect((a as CancelAttackIntentEvent).attackID).toBe("out-1");
    expect((land as CancelAttackIntentEvent).attackID).toBe("land-1");
    expect(b).toBeInstanceOf(CancelBoatIntentEvent);
    expect((b as CancelBoatIntentEvent).unitID).toBe(7);
  });

  it("offers no cancel while an attack, land attack or boat retreats", async () => {
    await setUp({
      outgoing: [
        attack(ME, ENEMY, "out-1", 1000, true),
        attack(ME, 0, "land-1", 1000, true),
      ],
      myBoats: [boat(7, player(ME), { retreating: true })],
    });

    expect(rows()).toHaveLength(3);
    for (const r of rows()) {
      expect(action(r, "cancel")).toBeNull();
    }
  });

  it("names a land attack after the wilderness and has nowhere to go to", async () => {
    await setUp({ outgoing: [attack(ME, 0, "land-1")] });

    const land = row("out", "land");
    expect(land.textContent).toContain("help_modal.ui_wilderness");
    expect(action(land, "goto").disabled).toBe(true);
  });

  it("shows a boat's ETA and goes to the boat", async () => {
    const mine = boat(7, player(ME), { target: 60 });
    await setUp({ myBoats: [mine] });

    const r = row("out", "boat");
    expect(r.textContent).toContain("5s");
    expect(r.textContent).toContain("Player2");
    action(r, "goto").click();

    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(GoToUnitEvent);
    expect((events[0] as GoToUnitEvent).unit).toBe(mine);
  });

  it("offers nothing to do about a boat coming at me but going to it", async () => {
    await setUp({ boatsAtMe: [boat(8, player(RAIDER))] });

    const r = row("in", "boat");
    expect(action(r, "retaliate")).toBeNull();
    expect(action(r, "cancel")).toBeNull();
    expect(action(r, "goto").disabled).toBe(false);
  });

  it("names retaliate and cancel through translations", async () => {
    await setUp({
      incoming: [attack(ENEMY, ME, "in-1")],
      outgoing: [attack(ME, ENEMY, "out-1")],
    });

    const retaliate = action(row("in", "attack"), "retaliate");
    const cancel = action(row("out", "attack"), "cancel");
    expect(retaliate.getAttribute("aria-label")).toBe(
      "user_setting.retaliate_attack",
    );
    expect(retaliate.title).toBe("user_setting.retaliate_attack");
    expect(cancel.getAttribute("aria-label")).toBe("common.cancel");
    expect(cancel.title).toBe("common.cancel");
  });

  it("marks a retreating row and says so", async () => {
    await setUp({
      incoming: [attack(ENEMY, ME, "in-1", 1000, true)],
      outgoing: [attack(ME, ENEMY, "out-1")],
    });

    const retreating = row("in", "attack");
    expect(retreating.hasAttribute("data-retreating")).toBe(true);
    expect(retreating.textContent).toContain("events_display.retreating");
    expect(row("out", "attack").hasAttribute("data-retreating")).toBe(false);
  });

  it("keeps the rows from the browser's translator", async () => {
    await setUp({
      incoming: [attack(ENEMY, ME, "in-1")],
      outgoing: [attack(ME, ENEMY, "out-1")],
    });

    for (const r of rows()) {
      expect(r.getAttribute("translate")).toBe("no");
    }
  });
});

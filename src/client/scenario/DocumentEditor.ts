/**
 * Edits a scenario document and its editor engine together, with undo
 * (docs/ScenarioEditor.md, "Undo"). Each edit changes the document, sends
 * the engine the matching commands and records its inverse. The document
 * makes the same side effects the engine does (a tile that stops being land
 * loses its owner and structure, one that stops being water its warship, a
 * port that loses its shore goes), so the two stay alike.
 */

import {
  MAX_TERRAIN_BATCH,
  SetNationCommandSchema,
} from "@openfront/engine-api/EditorCommands";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  addAlliance,
  addStructure,
  addWarship,
  allianceIndex,
  alliancesAllowed,
  checkTile,
  isAuthoredTerrain,
  isOwnable,
  isShore,
  MAX_NATIONS,
  nationIndex,
  type ScenarioConfig,
  ScenarioConfigSchema,
  type ScenarioDocument,
  type ScenarioNation,
  ScenarioNationSchema,
  type ScenarioStructure,
  ScenarioStructureSchema,
  type ScenarioWarship,
  ScenarioWarshipSchema,
  structureAt,
  warshipAt,
  warshipsAllowed,
  WATER,
  IMPASSABLE,
} from "./ScenarioDocument";
import { type SendCommand, sendTerrain } from "./ScenarioReplay";

export type Edit =
  /** At `index` in the nation list, or at its end. */
  | { type: "add_nation"; nation: ScenarioNation; index?: number }
  /** Takes its land, structures, warships and alliances with it. */
  | { type: "remove_nation"; id: string }
  /** Changes only the fields given. */
  | {
      type: "set_nation";
      id: string;
      name?: string;
      flag?: string | null;
      troops?: number;
      gold?: number;
      playable?: boolean;
    }
  | { type: "set_owner"; tiles: number[]; owner: string | null }
  | { type: "place_structure"; structure: ScenarioStructure }
  | { type: "remove_structure"; tile: number }
  | { type: "place_warship"; warship: ScenarioWarship }
  | { type: "remove_warship"; tile: number }
  /** Two nations allied from the start, by id, in either order. */
  | { type: "add_alliance"; nations: [string, string] }
  | { type: "remove_alliance"; nations: [string, string] }
  /**
   * Replaces the settings. Structures of a type it disables go with it, as
   * do all warships if it disables them and all alliances if it turns
   * alliances off.
   */
  | { type: "set_config"; config: ScenarioConfig }
  /** `terrain[i]` for `tiles[i]`; the last value given for a tile wins. */
  | {
      type: "set_terrain";
      tiles: readonly number[];
      terrain: readonly number[];
    };

/** One undo step: the edits that undo a step, in order. */
type Step = Edit[];

export class DocumentEditor {
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  // The step being built: the inverse of each edit applied since the last
  // commit, in the order applied.
  private open: Edit[][] = [];
  private openTerrain = false;

  constructor(
    readonly doc: ScenarioDocument,
    private readonly send: SendCommand,
    // How many tiles one set_terrain carries. Only tests set it, small, to
    // cross a batch boundary without writing a million tiles.
    private readonly terrainBatch: number = MAX_TERRAIN_BATCH,
  ) {}

  /**
   * Applies an edit as part of the current step, which commit() ends. A
   * stroke is many edits in one step. A new edit ends redo. Throws, having
   * changed nothing, if the edit can't apply.
   */
  apply(edit: Edit): void {
    this.run(edit);
    this.redoStack = [];
  }

  /** Ends the current step, which undo() then takes back as one. */
  commit(): void {
    if (this.open.length > 0) this.undoStack.push(this.closeStep());
  }

  canUndo(): boolean {
    return this.open.length > 0 || this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    this.commit();
    const step = this.undoStack.pop();
    if (step !== undefined) this.redoStack.push(this.applyStep(step));
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (step !== undefined) this.undoStack.push(this.applyStep(step));
  }

  /** Applies a step and returns the step that undoes it. */
  private applyStep(step: Step): Step {
    for (const edit of step) this.run(edit);
    return this.closeStep();
  }

  private run(edit: Edit): void {
    this.open.push(this.applyEdit(edit));
    if (edit.type === "set_terrain") this.openTerrain = true;
  }

  private closeStep(): Step {
    // A run of terrain writes ends with one full terrain pass.
    if (this.openTerrain) this.send({ type: "end_terrain_edit" });
    const step = this.open.reverse().flat();
    this.open = [];
    this.openTerrain = false;
    return step;
  }

  /** Applies one edit and returns the edits that undo it, in order. */
  private applyEdit(edit: Edit): Edit[] {
    const doc = this.doc;
    switch (edit.type) {
      case "add_nation": {
        const nation = ScenarioNationSchema.parse(edit.nation);
        const index = edit.index ?? doc.nations.length;
        if (doc.nations.some((n) => n.id === nation.id)) {
          throw new Error(`nation ${nation.id} already exists`);
        }
        if (doc.nations.length >= MAX_NATIONS) {
          throw new Error(`a scenario has at most ${MAX_NATIONS} nations`);
        }
        if (index < 0 || index > doc.nations.length) {
          throw new Error(`no place ${index} in the nation list`);
        }
        doc.nations.splice(index, 0, nation);
        // Owners after it move up one.
        const owners = doc.owners;
        for (let t = 0; t < owners.length; t++) {
          if (owners[t] > index) owners[t]++;
        }
        this.send({
          type: "add_nation",
          id: nation.id,
          name: nation.name,
          flag: nation.flag,
        });
        this.send({
          type: "set_nation",
          id: nation.id,
          troops: nation.troops,
          gold: nation.gold,
          playable: nation.playable,
        });
        return [{ type: "remove_nation", id: nation.id }];
      }
      case "remove_nation": {
        const index = nationIndex(doc, edit.id);
        const owner = index + 1;
        const tiles: number[] = [];
        const owners = doc.owners;
        for (let t = 0; t < owners.length; t++) {
          if (owners[t] === owner) {
            tiles.push(t);
            owners[t] = 0;
          } else if (owners[t] > owner) {
            owners[t]--;
          }
        }
        const structures = doc.structures.filter((s) => s.nation === edit.id);
        doc.structures = doc.structures.filter((s) => s.nation !== edit.id);
        const warships = this.removeWarships((w) => w.nation === edit.id);
        // The engine's remove_nation ends its alliances too.
        const alliances = doc.alliances.filter((p) => p.includes(edit.id));
        doc.alliances = doc.alliances.filter((p) => !p.includes(edit.id));
        const [nation] = doc.nations.splice(index, 1);
        this.send({ type: "remove_nation", id: edit.id });
        return [
          { type: "add_nation", nation, index },
          ...(tiles.length > 0
            ? [{ type: "set_owner" as const, tiles, owner: edit.id }]
            : []),
          ...structures.map((structure): Edit => ({
            type: "place_structure",
            structure,
          })),
          ...warships,
          ...alliances.map((nations): Edit => ({
            type: "add_alliance",
            nations,
          })),
        ];
      }
      case "set_nation": {
        const { type, id, ...given } = SetNationCommandSchema.parse(edit);
        const nation = doc.nations[nationIndex(doc, id)];
        const keys = (Object.keys(given) as (keyof typeof given)[]).filter(
          (k) => given[k] !== undefined,
        );
        const fields = Object.fromEntries(keys.map((k) => [k, given[k]]));
        const before = Object.fromEntries(keys.map((k) => [k, nation[k]]));
        Object.assign(nation, fields);
        this.send({ type, id, ...fields });
        return [{ type, id, ...before }];
      }
      case "set_owner": {
        const owner =
          edit.owner === null ? 0 : nationIndex(doc, edit.owner) + 1;
        for (const t of edit.tiles) {
          checkTile(doc, t);
          if (owner !== 0 && !isOwnable(doc.terrain[t])) {
            throw new Error(`tile ${t} can't be owned`);
          }
        }
        const before = new Map<number, number[]>();
        for (const t of edit.tiles) {
          const previous = doc.owners[t];
          if (previous === owner) continue;
          if (!before.has(previous)) before.set(previous, []);
          before.get(previous)!.push(t);
          doc.owners[t] = owner;
        }
        // A structure stands only on its nation's land.
        const lost = this.removeStructures(
          (s) => doc.owners[s.tile] !== nationIndex(doc, s.nation) + 1,
        );
        this.send({ type: "set_owner", tiles: edit.tiles, owner: edit.owner });
        return [...this.ownerEdits(before), ...lost];
      }
      case "place_structure": {
        const structure = ScenarioStructureSchema.parse(edit.structure);
        addStructure(doc, structure);
        const { type: unit, ...rest } = structure;
        this.send({ type: "place_structure", unit, ...rest });
        return [{ type: "remove_structure", tile: structure.tile }];
      }
      case "add_alliance": {
        const nations = addAlliance(doc, ...edit.nations);
        this.send({ type: "add_alliance", nations });
        return [{ type: "remove_alliance", nations }];
      }
      case "remove_alliance": {
        const i = allianceIndex(doc, ...edit.nations);
        if (i === -1) {
          throw new Error(`${edit.nations.join(" and ")} are not allies`);
        }
        const [nations] = doc.alliances.splice(i, 1);
        this.send({ type: "remove_alliance", nations });
        return [{ type: "add_alliance", nations }];
      }
      case "set_config": {
        const config = ScenarioConfigSchema.parse(edit.config);
        const before = doc.config;
        doc.config = config;
        // The engine keeps the editor's own settings, so only what the new
        // ones remove reaches it.
        const disabled = config.disabledUnits ?? [];
        const structures = doc.structures.filter((s) =>
          disabled.includes(s.type),
        );
        doc.structures = doc.structures.filter(
          (s) => !disabled.includes(s.type),
        );
        const warships = warshipsAllowed(config) ? [] : doc.warships;
        if (warships.length > 0) doc.warships = [];
        const alliances = alliancesAllowed(config) ? [] : doc.alliances;
        if (alliances.length > 0) doc.alliances = [];
        for (const s of structures) {
          this.send({ type: "remove_structure", tile: s.tile });
        }
        for (const w of warships) {
          this.send({ type: "remove_warship", tile: w.tile });
        }
        for (const nations of alliances) {
          this.send({ type: "remove_alliance", nations });
        }
        // The old settings first: they allow what the rest puts back.
        return [
          { type: "set_config", config: before },
          ...structures.map((structure): Edit => ({
            type: "place_structure",
            structure,
          })),
          ...warships.map((warship): Edit => ({
            type: "place_warship",
            warship,
          })),
          ...alliances.map((nations): Edit => ({
            type: "add_alliance",
            nations,
          })),
        ];
      }
      case "remove_structure": {
        checkTile(doc, edit.tile);
        const structure = structureAt(doc, edit.tile);
        if (structure === undefined) {
          throw new Error(`tile ${edit.tile} has no structure`);
        }
        doc.structures = doc.structures.filter((s) => s !== structure);
        this.send({ type: "remove_structure", tile: edit.tile });
        return [{ type: "place_structure", structure }];
      }
      case "place_warship": {
        const warship = ScenarioWarshipSchema.parse(edit.warship);
        addWarship(doc, warship);
        this.send({ type: "place_warship", ...warship });
        return [{ type: "remove_warship", tile: warship.tile }];
      }
      case "remove_warship": {
        checkTile(doc, edit.tile);
        const warship = warshipAt(doc, edit.tile);
        if (warship === undefined) {
          throw new Error(`tile ${edit.tile} has no warship`);
        }
        doc.warships = doc.warships.filter((w) => w !== warship);
        this.send({ type: "remove_warship", tile: edit.tile });
        return [{ type: "place_warship", warship }];
      }
      case "set_terrain": {
        if (edit.tiles.length !== edit.terrain.length) {
          throw new Error(
            `${edit.tiles.length} tiles but ${edit.terrain.length} terrain values`,
          );
        }
        const terrain = new Map<number, number>();
        edit.tiles.forEach((t, i) => {
          checkTile(doc, t);
          if (!isAuthoredTerrain(edit.terrain[i])) {
            throw new Error(`${edit.terrain[i]} is not an authored terrain`);
          }
          terrain.set(t, edit.terrain[i]);
        });
        const tiles = [...terrain.keys()];
        const previous = tiles.map((t) => doc.terrain[t]);
        // A tile that changes between water, land and impassable loses its
        // owner, its structure and its warship.
        const before = new Map<number, number[]>();
        const kindChanged = new Set<number>();
        for (const [t, value] of terrain) {
          if (kind(doc.terrain[t]) === kind(value)) continue;
          kindChanged.add(t);
          const owner = doc.owners[t];
          if (owner === 0) continue;
          if (!before.has(owner)) before.set(owner, []);
          before.get(owner)!.push(t);
          doc.owners[t] = 0;
        }
        const lost = [
          ...this.removeStructures((s) => kindChanged.has(s.tile)),
          ...this.removeWarships((w) => kindChanged.has(w.tile)),
        ];
        // A port needs a shore, which an edit beside it can take away. The
        // engine checks after each set_terrain, so the document writes the
        // terrain in the same batches sendTerrain sends, checking after each.
        // Undo writes the batches back last first, so it passes through the
        // same terrain the edit did, where every port it keeps had a shore.
        const undoTerrain: Edit[] = [];
        for (let i = 0; i < tiles.length; i += this.terrainBatch) {
          const batch = tiles.slice(i, i + this.terrainBatch);
          for (const t of batch) doc.terrain[t] = terrain.get(t)!;
          const ports = this.removeStructures(
            (s) => s.type === UnitType.Port && !isShore(doc, s.tile),
          );
          for (const port of ports) lost.push(port);
          undoTerrain.unshift({
            type: "set_terrain",
            tiles: batch,
            terrain: previous.slice(i, i + this.terrainBatch),
          });
        }
        sendTerrain(tiles, [...terrain.values()], this.send, this.terrainBatch);
        return [...undoTerrain, ...this.ownerEdits(before), ...lost];
      }
    }
  }

  /** Removes the matching structures; returns the edits that put them back. */
  private removeStructures(remove: (s: ScenarioStructure) => boolean): Edit[] {
    const removed = this.doc.structures.filter(remove);
    this.doc.structures = this.doc.structures.filter((s) => !remove(s));
    return removed.map((structure) => ({ type: "place_structure", structure }));
  }

  /** Removes the matching warships; returns the edits that put them back. */
  private removeWarships(remove: (w: ScenarioWarship) => boolean): Edit[] {
    const removed = this.doc.warships.filter(remove);
    this.doc.warships = this.doc.warships.filter((w) => !remove(w));
    return removed.map((warship) => ({ type: "place_warship", warship }));
  }

  /** set_owner edits giving tiles back to their owners by index. */
  private ownerEdits(before: Map<number, number[]>): Edit[] {
    return [...before].map(([owner, tiles]) => ({
      type: "set_owner",
      tiles,
      owner: owner === 0 ? null : this.doc.nations[owner - 1].id,
    }));
  }
}

function kind(b: number): "water" | "land" | "impassable" {
  if (b === WATER) return "water";
  return b === IMPASSABLE ? "impassable" : "land";
}

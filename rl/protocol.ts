/** Shared constants between the Node env server and the C# trainer. Keep in sync with OpenFrontRL/Protocol.cs. */

export enum ActionType {
  Noop = 0,
  Attack = 1, // slot, ratio
  Boat = 2, // cell, ratio
  City = 3, // cell
  Port = 4, // cell
  DefensePost = 5, // cell
  Factory = 6, // cell
  Silo = 7, // cell
  Sam = 8, // cell
  Warship = 9, // cell
  AtomBomb = 10, // cell
  AllyRequest = 11, // slot (ally mask)
  AcceptAlliance = 12,
  Spawn = 13, // cell (spawn phase only)
}

export const TYPE_COUNT = 14;
export const NUM_SLOTS = 8;
export const RATIOS = [0.1, 0.25, 0.5, 0.75, 1.0];
export const NUM_RATIOS = RATIOS.length;

export enum Cmd {
  Init = 0,
  Reset = 1,
  Step = 2,
  Info = 3,
  Close = 4,
}

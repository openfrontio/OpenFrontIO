import { RailType } from "../../../core/game/GameUpdates";

const railTypeToFunctionMap: Record<RailType, () => number[][]> = {
  [RailType.TOP_RIGHT]: topRightRailroadCornerRects,
  [RailType.BOTTOM_LEFT]: bottomLeftRailroadCornerRects,
  [RailType.TOP_LEFT]: topLeftRailroadCornerRects,
  [RailType.BOTTOM_RIGHT]: bottomRightRailroadCornerRects,
  [RailType.HORIZONTAL]: horizontalRailroadRects,
  [RailType.VERTICAL]: verticalRailroadRects,
};

export function getRailroadRects(type: RailType): number[][] {
  const railRects = railTypeToFunctionMap[type];
  if (!railRects) {
    // Should never happen
    throw new Error(`Unsupported RailType: ${type}`);
  }
  return railRects();
}

function horizontalRailroadRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -1, 2, 1],
    [-1, 1, 2, 1],
    [-1, 0, 1, 1],
  ];
  return rects;
}

function verticalRailroadRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -2, 1, 2],
    [1, -2, 1, 2],
    [0, -1, 1, 1],
  ];
  return rects;
}

function topRightRailroadCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -2, 1, 2],
    [0, -1, 1, 2],
    [1, -2, 1, 4],
  ];
  return rects;
}

function topLeftRailroadCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -2, 1, 4],
    [0, -1, 1, 2],
    [1, -2, 1, 2],
  ];
  return rects;
}

function bottomRightRailroadCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, 1, 1, 2],
    [0, 0, 1, 2],
    [1, -1, 1, 4],
  ];
  return rects;
}

function bottomLeftRailroadCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -1, 1, 4],
    [0, 0, 1, 2],
    [1, 1, 1, 2],
  ];
  return rects;
}

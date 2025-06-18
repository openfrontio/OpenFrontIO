import { RailType } from "../../../core/game/GameUpdates";

const railTypeToFunctionMap: Record<RailType, () => number[][]> = {
  [RailType.TOP_RIGHT]: topRightRailRoadCornerRects,
  [RailType.BOTTOM_LEFT]: bottomLeftRailRoadCornerRects,
  [RailType.TOP_LEFT]: topLeftRailRoadCornerRects,
  [RailType.BOTTOM_RIGHT]: bottomRightRailRoadCornerRects,
  [RailType.HORIZONTAL]: horizontalRailRoadRects,
  [RailType.VERTICAL]: verticalRailRoadRects,
};

export function getRailRoadRects(type: RailType): number[][] {
  const railRects = railTypeToFunctionMap[type];
  if (!railRects) {
    // Should never happen
    throw new Error(`Unsupported RailType: ${type}`);
  }
  return railRects();
}

function horizontalRailRoadRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -1, 2, 1],
    [-1, 1, 2, 1],
    [-1, 0, 1, 1],
  ];
  return rects;
}

function verticalRailRoadRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -2, 1, 2],
    [1, -2, 1, 2],
    [0, -1, 1, 1],
  ];
  return rects;
}

function topRightRailRoadCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -2, 1, 2],
    [0, -1, 1, 2],
    [1, -2, 1, 4],
  ];
  return rects;
}

function topLeftRailRoadCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -2, 1, 4],
    [0, -1, 1, 2],
    [1, -2, 1, 2],
  ];
  return rects;
}

function bottomRightRailRoadCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, 1, 1, 2],
    [0, 0, 1, 2],
    [1, -1, 1, 4],
  ];
  return rects;
}

function bottomLeftRailRoadCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-1, -1, 1, 4],
    [0, 0, 1, 2],
    [1, 1, 1, 2],
  ];
  return rects;
}

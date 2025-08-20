import { RailType } from "../../../core/game/GameUpdates";

const railTypeToFunctionMap: Record<RailType, () => number[][]> = {
  ["TOP_RIGHT"]: topRightRailroadCornerRects,
  ["BOTTOM_LEFT"]: bottomLeftRailroadCornerRects,
  ["TOP_LEFT"]: topLeftRailroadCornerRects,
  ["BOTTOM_RIGHT"]: bottomRightRailroadCornerRects,
  ["HORIZONTAL"]: horizontalRailroadRects,
  ["VERTICAL"]: verticalRailroadRects,
};

const railTypeToBridgeFunctionMap: Record<RailType, () => number[][]> = {
  ["TOP_RIGHT"]: topRightBridgeCornerRects,
  ["BOTTOM_LEFT"]: bottomLeftBridgeCornerRects,
  ["TOP_LEFT"]: topLeftBridgeCornerRects,
  ["BOTTOM_RIGHT"]: bottomRightBridgeCornerRects,
  ["HORIZONTAL"]: horizontalBridge,
  ["VERTICAL"]: verticalBridge,
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

export function getBridgeRects(type: RailType): number[][] {
  const bridgeRects = railTypeToBridgeFunctionMap[type];
  if (!bridgeRects) {
    // Should never happen
    throw new Error(`Unsupported RailType: ${type}`);
  }
  return bridgeRects();
}

function horizontalBridge(): number[][] {
  // x/y/w/h
  return [
    [-1, -2, 3, 1],
    [-1, 2, 3, 1],
    [-1, 3, 1, 1],
    [1, 3, 1, 1],
  ];
}

function verticalBridge(): number[][] {
  // x/y/w/h
  return [
    [-2, -2, 1, 3],
    [2, -2, 1, 3],
  ];
}
// ⌞
function topRightBridgeCornerRects(): number[][] {
  return [
    [-2, -2, 1, 2],
    [-1, 0, 1, 1],
    [0, 1, 1, 1],
    [1, 2, 2, 1],
    [2, -2, 1, 1],
  ];
}
// ⌝
function bottomLeftBridgeCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-2, -2, 2, 1],
    [0, -1, 1, 1],
    [1, 0, 1, 1],
    [2, 1, 1, 2],
    [-2, 2, 1, 1],
  ];
  return rects;
}
// ⌟
function topLeftBridgeCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-2, -2, 1, 1],
    [-2, 2, 2, 1],
    [0, 1, 1, 1],
    [1, 0, 1, 1],
    [2, -2, 1, 2],
  ];
  return rects;
}
// ⌜
function bottomRightBridgeCornerRects(): number[][] {
  // x/y/w/h
  const rects = [
    [-2, 1, 1, 2],
    [-1, 0, 1, 1],
    [0, -1, 1, 1],
    [1, -2, 2, 1],
    [2, 2, 1, 1],
  ];
  return rects;
}

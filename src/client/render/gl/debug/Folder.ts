import type { ConfigProp } from "./ConfigProp";

export interface FolderNode {
  kind: "folder";
  label: string;
  closed: boolean;
  children: DebugNode[];
}

export type DebugNode = ConfigProp | FolderNode;

export function folder(
  label: string,
  children: DebugNode[],
  opts: { closed?: boolean } = {},
): FolderNode {
  return { kind: "folder", label, closed: opts.closed ?? true, children };
}

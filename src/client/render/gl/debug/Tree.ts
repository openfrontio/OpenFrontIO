import GUI from "lil-gui";
import type { ConfigProp } from "./ConfigProp";
import type { DebugNode, FolderNode } from "./Folder";

/** Walk the debug tree, drawing each node onto the GUI. Returns all leaf props. */
export function walkTree(nodes: DebugNode[], parent: GUI): ConfigProp[] {
  const props: ConfigProp[] = [];
  for (const node of nodes) {
    if (isFolderNode(node)) {
      const sub = parent.addFolder(node.label);
      props.push(...walkTree(node.children, sub));
      if (node.closed) sub.close();
    } else {
      node.draw(parent);
      props.push(node);
    }
  }
  return props;
}

function isFolderNode(node: DebugNode): node is FolderNode {
  return (node as FolderNode).kind === "folder";
}

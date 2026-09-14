import GUI, { FunctionController } from "lil-gui";
import type { RenderSettings } from "../RenderSettings";
import { dumpSettings } from "../RenderSettings";
import { deepAssign } from "../SettingsUtils";
import type { ConfigProp } from "./ConfigProp";

// ---------------------------------------------------------------------------
// Draggable title bar
// ---------------------------------------------------------------------------

export function makeDraggable(gui: GUI): void {
  const titleBar = gui.domElement.querySelector(
    ".title, .lil-title",
  ) as HTMLElement | null;
  if (!titleBar) return;

  titleBar.style.cursor = "grab";
  let dragging = false;
  let didDrag = false;
  let startX = 0,
    startY = 0,
    startLeft = 0,
    startTop = 0;

  titleBar.addEventListener("mousedown", (e) => {
    dragging = true;
    didDrag = false;
    titleBar.style.cursor = "grabbing";
    const rect = gui.domElement.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    gui.domElement.style.left = rect.left + "px";
    gui.domElement.style.right = "auto";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    didDrag = true;
    gui.domElement.style.left = startLeft + e.clientX - startX + "px";
    gui.domElement.style.top = startTop + e.clientY - startY + "px";
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    titleBar.style.cursor = "grab";
  });

  titleBar.addEventListener(
    "click",
    (e) => {
      if (didDrag) e.stopPropagation();
    },
    { capture: true },
  );
}

// ---------------------------------------------------------------------------
// Actions: Download JSON, Load JSON, Reset to Defaults
// ---------------------------------------------------------------------------

export function wireActions(
  gui: GUI,
  settings: RenderSettings,
  props: ConfigProp[],
  resolveDefaults: () => RenderSettings,
  onSettingsChanged?: () => void,
): void {
  gui.add({ dump: () => dumpSettings(settings) }, "dump").name("Download JSON");

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        deepAssign(settings, JSON.parse(reader.result as string));
        props.forEach((p) => p.updateDisplay());
        onSettingsChanged?.();
      } catch (e) {
        console.error("Failed to load render settings:", e);
      }
    };
    reader.readAsText(file);
    fileInput.value = "";
  });

  gui.add({ load: () => fileInput.click() }, "load").name("Load JSON");

  gui
    .add(
      {
        reset: () => {
          deepAssign(settings, resolveDefaults());
          props.forEach((p) => p.resetToDefault());
          onSettingsChanged?.();
        },
      },
      "reset",
    )
    .name("Reset to Defaults");
}

// ---------------------------------------------------------------------------
// Modified indicators: blue label + right-click reset context menu
// ---------------------------------------------------------------------------

const MODIFIED_CLASS = "lil-modified";

let stylesInjected = false;
function injectModifiedStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .${MODIFIED_CLASS} .lil-name { color: #5ba8d6; }
    .lil-reset-menu {
      position: fixed;
      z-index: 10000;
      background: #1a1a2e;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 4px 0;
      font: 12px sans-serif;
      color: #ccc;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    }
    .lil-reset-menu div {
      padding: 4px 16px;
      cursor: pointer;
      white-space: nowrap;
    }
    .lil-reset-menu div:hover {
      background: #2a2a4e;
      color: #fff;
    }
  `;
  document.head.appendChild(style);
}

function createContextMenu(): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "lil-reset-menu";
  menu.style.display = "none";
  document.body.appendChild(menu);
  document.addEventListener("mousedown", (e) => {
    if (!menu.contains(e.target as Node)) menu.style.display = "none";
  });
  return menu;
}

export function wireModifiedIndicators(
  gui: GUI,
  props: ConfigProp[],
  onSettingsChanged?: () => void,
): void {
  injectModifiedStyles();
  const contextMenu = createContextMenu();

  // Map each lil-gui Controller back to its ConfigProp
  const allControllers = gui.controllersRecursive();
  // Props were pushed in walk order, controllers are in the same order (minus FunctionControllers)
  const propControllers = allControllers.filter(
    (c) => !(c instanceof FunctionController),
  );

  propControllers.forEach((ctrl, i) => {
    const prop = props[i];

    const updateClass = () =>
      ctrl.domElement.classList.toggle(MODIFIED_CLASS, prop.isModified());

    updateClass();

    const prev = ctrl._onChange;
    ctrl.onChange(function (...args: unknown[]) {
      prev?.apply(ctrl, args as any);
      updateClass();
    });

    ctrl.$name.addEventListener("contextmenu", (e) => {
      if (!prop.isModified()) return;
      e.preventDefault();
      e.stopPropagation();

      contextMenu.innerHTML = "";
      const item = document.createElement("div");
      item.textContent = "Reset to default";
      item.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        prop.resetToDefault();
        updateClass();
        onSettingsChanged?.();
        contextMenu.style.display = "none";
      });
      contextMenu.appendChild(item);
      contextMenu.style.left = e.clientX + "px";
      contextMenu.style.top = e.clientY + "px";
      contextMenu.style.display = "";
    });
  });

  // Wire onFinishChange for persistence
  if (onSettingsChanged) {
    allControllers.forEach((c) => c.onFinishChange(onSettingsChanged));
  }
}

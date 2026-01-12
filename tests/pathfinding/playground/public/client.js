// Application State
const state = {
  currentMap: null,
  mapData: null,
  mapWidth: 0,
  mapHeight: 0,
  startPoint: null,
  endPoint: null,
  hpaPath: null,
  hpaResult: null, // Store full HPA* result including timing
  comparisons: [], // Array of comparison results
  visibleComparisons: new Set(), // Which comparison paths are visible
  adapters: [], // Available comparison adapters (loaded from backend)
  graphDebug: null, // Static graph data (allNodes, edges, clusterSize) - loaded once per map
  debugInfo: null, // Per-path debug data (timings, nodePath, initialPath)
  isMapLoading: false, // Loading state for map switching
  isHpaLoading: false, // Separate loading state for HPA*
  activeRefreshButton: null, // Track which refresh button is spinning
};

// Colors for comparison paths
const COMPARISON_COLORS = {
  hpa: "#ff8800", // orange
  "a.baseline": "#ff00ff", // magenta
  "a.generic": "#88ff00", // lime
  "a.full": "#ffff00", // yellow
};

// Canvas state
let zoomLevel = 1.0;
let panX = 0;
let panY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;

let mapCanvas, overlayCanvas, interactiveCanvas;
let mapCtx, overlayCtx, interactiveCtx;
let mapRendered = false;
let hoveredNode = null;
let hoveredPoint = null; // 'start', 'end', or null
let draggingPoint = null; // 'start', 'end', or null
let draggingPointPosition = null; // [x, y] canvas position while dragging
let lastPathRecalcTime = 0;
let renderRequested = false;

// Save current state to URL query string
function updateURLState() {
  const params = new URLSearchParams();

  if (state.currentMap) {
    params.set("map", state.currentMap);
  }
  if (state.startPoint) {
    params.set("start", `${state.startPoint[0]},${state.startPoint[1]}`);
  }
  if (state.endPoint) {
    params.set("end", `${state.endPoint[0]},${state.endPoint[1]}`);
  }

  const newURL = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", newURL);
}

// Restore state from URL query string
function restoreFromURL() {
  const params = new URLSearchParams(window.location.search);

  const mapName = params.get("map");
  const startStr = params.get("start");
  const endStr = params.get("end");

  const result = {
    map: mapName,
    start: null,
    end: null,
  };

  if (startStr) {
    const [x, y] = startStr.split(",").map(Number);
    if (!isNaN(x) && !isNaN(y)) {
      result.start = [x, y];
    }
  }

  if (endStr) {
    const [x, y] = endStr.split(",").map(Number);
    if (!isNaN(x) && !isNaN(y)) {
      result.end = [x, y];
    }
  }

  return result;
}

// Initialize on DOM load
window.addEventListener("DOMContentLoaded", () => {
  initializeCanvases();
  initializeControls();
  initializeDragControls();
  initializeTimingsPanel();
  loadMaps();
});

// Initialize canvas elements
function initializeCanvases() {
  mapCanvas = document.getElementById("mapCanvas");
  mapCtx = mapCanvas.getContext("2d");

  overlayCanvas = document.getElementById("overlayCanvas");
  overlayCtx = overlayCanvas.getContext("2d");

  // Create interactive canvas OUTSIDE the CSS transform wrapper
  // This canvas is viewport-sized and renders paths/points at screen coordinates
  const canvasContainer = document.querySelector(".canvas-container");
  interactiveCanvas = document.createElement("canvas");
  interactiveCanvas.id = "interactiveCanvas";
  interactiveCanvas.style.position = "absolute";
  interactiveCanvas.style.top = "0";
  interactiveCanvas.style.left = "0";
  interactiveCanvas.style.width = "100%";
  interactiveCanvas.style.height = "100%";
  interactiveCanvas.style.zIndex = "3";
  interactiveCanvas.style.pointerEvents = "none";
  canvasContainer.appendChild(interactiveCanvas);
  interactiveCtx = interactiveCanvas.getContext("2d");

  // Size interactive canvas to viewport
  const resizeInteractiveCanvas = () => {
    const rect = canvasContainer.getBoundingClientRect();
    interactiveCanvas.width = rect.width;
    interactiveCanvas.height = rect.height;
  };
  resizeInteractiveCanvas();
  window.addEventListener("resize", resizeInteractiveCanvas);
}

// Initialize control event listeners
function initializeControls() {
  // Map selector (top panel)
  document.getElementById("scenarioSelect").addEventListener("change", (e) => {
    switchMap(e.target.value);
  });

  // Map selector (welcome screen)
  document
    .getElementById("welcomeMapSelect")
    .addEventListener("change", (e) => {
      const mapName = e.target.value;
      if (mapName) {
        switchMap(mapName);
      }
    });

  // Refresh HPA* button
  document.getElementById("refreshHpa").addEventListener("click", (e) => {
    if (state.startPoint && state.endPoint) {
      const btn = e.currentTarget;
      btn.classList.add("spinning");
      state.activeRefreshButton = btn;
      requestPathfinding(state.startPoint, state.endPoint);
    }
  });

  // Visualization toggles - all buttons
  [
    "showInitialPath",
    "showUsedNodes",
    "showColoredMap",
    "showNodes",
    "showSectorGrid",
    "showEdges",
  ].forEach((id) => {
    const button = document.getElementById(id);
    button.addEventListener("click", () => {
      const isActive = button.dataset.active === "true";
      button.dataset.active = !isActive;
      // Map coloring affects map canvas
      if (id === "showColoredMap") {
        renderMapBackground(2);
      }
      // Static overlays (sectors, edges, all nodes) go on overlay canvas
      if (["showNodes", "showSectorGrid", "showEdges"].includes(id)) {
        renderOverlay(2);
      }
      // Dynamic elements (paths, highlighted nodes) go on interactive canvas
      renderInteractive();
    });
  });

  // Zoom control
  document.getElementById("zoom").addEventListener("input", (e) => {
    zoomLevel = parseFloat(e.target.value);
    document.getElementById("zoomValue").textContent =
      zoomLevel.toFixed(1) + "x";
    updateTransform();
  });

  // Clear points button
  document.getElementById("clearPoints").addEventListener("click", () => {
    clearPoints();
  });
}

// Helper function to check if mouse is over a start/end point
function getPointAtPosition(canvasX, canvasY) {
  const scale = zoomLevel;
  const zoomFactor = 3 / zoomLevel;
  const hitRadius = Math.max(4, scale * 3 * zoomFactor) + 3; // Add 3px tolerance

  // Check end point first (render on top)
  if (state.endPoint) {
    const dx = canvasX - (state.endPoint[0] + 0.5);
    const dy = canvasY - (state.endPoint[1] + 0.5);
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= hitRadius / scale) {
      return "end";
    }
  }

  // Check start point
  if (state.startPoint) {
    const dx = canvasX - (state.startPoint[0] + 0.5);
    const dy = canvasY - (state.startPoint[1] + 0.5);
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= hitRadius / scale) {
      return "start";
    }
  }

  return null;
}

// Throttled path recalculation (max once per 16ms ~60fps)
function schedulePathRecalc() {
  const now = Date.now();
  const timeSinceLastCall = now - lastPathRecalcTime;

  if (timeSinceLastCall >= 16) {
    // Enough time has passed, request immediately
    lastPathRecalcTime = now;
    if (state.startPoint && state.endPoint) {
      // Skip comparisons during drag for snappy feel
      requestPathfinding(state.startPoint, state.endPoint, true);
    }
  }
  // If not enough time has passed, skip this call (throttle)
}

// Initialize drag and click controls
function initializeDragControls() {
  const wrapper = document.getElementById("canvasWrapper");
  const tooltip = document.getElementById("tooltip");

  wrapper.addEventListener("mousedown", (e) => {
    const rect = wrapper.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - panX) / zoomLevel;
    const canvasY = (e.clientY - rect.top - panY) / zoomLevel;

    // Check if clicking on a point
    const pointAtMouse = getPointAtPosition(canvasX, canvasY);

    if (pointAtMouse) {
      // Start dragging the point
      draggingPoint = pointAtMouse;
      wrapper.style.cursor = "move";
    } else {
      // Start panning the map
      isDragging = true;
      wrapper.style.cursor = "grabbing";
    }

    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPanX = panX;
    dragStartPanY = panY;
  });

  wrapper.addEventListener("mousemove", (e) => {
    const rect = wrapper.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - panX) / zoomLevel;
    const canvasY = (e.clientY - rect.top - panY) / zoomLevel;

    if (draggingPoint) {
      // Dragging a start/end point - snap to water tile
      const tileX = Math.floor(canvasX);
      const tileY = Math.floor(canvasY);

      // Validate tile is within bounds and is water
      if (
        tileX >= 0 &&
        tileX < state.mapWidth &&
        tileY >= 0 &&
        tileY < state.mapHeight
      ) {
        const tileIndex = tileY * state.mapWidth + tileX;
        const isWater = state.mapData[tileIndex] === 1;

        if (isWater) {
          // Snap to water tile center
          draggingPointPosition = [tileX, tileY];

          // Update the actual point position and trigger throttled path recalculation
          if (draggingPoint === "start") {
            state.startPoint = [tileX, tileY];
          } else {
            state.endPoint = [tileX, tileY];
          }

          // Trigger throttled path recalculation (16ms)
          if (state.startPoint && state.endPoint) {
            schedulePathRecalc();
          }
        }
        // If not water, keep previous valid position (don't update)
      }

      renderInteractive();
    } else if (isDragging) {
      // Panning the map
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      panX = dragStartPanX + dx;
      panY = dragStartPanY + dy;
      updateTransform(); // Updates interactive layer at screen coordinates
    } else {
      // Check for point hover
      const pointAtMouse = getPointAtPosition(canvasX, canvasY);
      if (pointAtMouse !== hoveredPoint) {
        hoveredPoint = pointAtMouse;
        renderInteractive(); // Fast - only redraws points
        // Update cursor
        wrapper.style.cursor = hoveredPoint ? "move" : "grab";
      }

      // Check for node hover (only if node visualization is enabled)
      const showNodes =
        document.getElementById("showNodes").dataset.active === "true";
      const showUsedNodes =
        document.getElementById("showUsedNodes").dataset.active === "true";

      if (
        (showNodes || showUsedNodes) &&
        state.graphDebug &&
        state.graphDebug.allNodes
      ) {
        // Filter nodes based on what's visible
        let nodesToCheck = state.graphDebug.allNodes;
        if (
          showUsedNodes &&
          !showNodes &&
          state.debugInfo &&
          state.debugInfo.nodePath
        ) {
          // Only show tooltips for used nodes
          // nodePath are coordinates [x, y] matching the map format
          const usedNodeCoords = new Set(
            state.debugInfo.nodePath.map(([x, y]) => `${x},${y}`),
          );
          nodesToCheck = state.graphDebug.allNodes.filter((node) =>
            usedNodeCoords.has(`${node.x * 2},${node.y * 2}`),
          );
        }

        const foundNode = findNodeAtPosition(canvasX, canvasY, nodesToCheck);

        if (foundNode !== hoveredNode) {
          hoveredNode = foundNode;
          if (hoveredNode) {
            showNodeTooltip(hoveredNode, e.clientX, e.clientY);
          } else {
            tooltip.classList.remove("visible");
          }
          renderInteractive();
        } else if (hoveredNode) {
          tooltip.style.left = e.clientX + 15 + "px";
          tooltip.style.top = e.clientY + 15 + "px";
        }
      } else {
        // No node visualization enabled, clear any existing tooltip
        if (hoveredNode) {
          hoveredNode = null;
          tooltip.classList.remove("visible");
          renderInteractive();
        }
      }
    }
  });

  wrapper.addEventListener("mouseup", (e) => {
    // Only treat as click if mouse didn't move much
    const dx = Math.abs(e.clientX - dragStartX);
    const dy = Math.abs(e.clientY - dragStartY);

    if (draggingPoint) {
      // Finished dragging a point
      // Request final path update to ensure we have the path for the final position
      // (in case throttling skipped the last update during fast dragging)
      if (state.startPoint && state.endPoint) {
        requestPathfinding(state.startPoint, state.endPoint);
      }
      draggingPoint = null;
      draggingPointPosition = null;
      renderInteractive();
      updateURLState();
    } else if (isDragging && dx < 5 && dy < 5) {
      // Was panning but didn't move much - treat as click
      handleMapClick(e);
    }

    isDragging = false;

    // Reset cursor based on current hover state
    const rect = wrapper.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - panX) / zoomLevel;
    const canvasY = (e.clientY - rect.top - panY) / zoomLevel;
    const pointAtMouse = getPointAtPosition(canvasX, canvasY);
    wrapper.style.cursor = pointAtMouse ? "move" : "grab";
  });

  wrapper.addEventListener("mouseleave", () => {
    isDragging = false;
    draggingPoint = null;
    draggingPointPosition = null;
    tooltip.classList.remove("visible");
    wrapper.style.cursor = "grab";

    const needsRender = hoveredNode || hoveredPoint;
    hoveredNode = null;
    hoveredPoint = null;

    if (needsRender) {
      renderInteractive();
    }
  });

  wrapper.addEventListener("wheel", (e) => {
    e.preventDefault();

    const rect = wrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldZoom = zoomLevel;
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomLevel = Math.max(0.1, Math.min(5, zoomLevel * zoomDelta));

    panX = mouseX - (mouseX - panX) * (zoomLevel / oldZoom);
    panY = mouseY - (mouseY - panY) * (zoomLevel / oldZoom);

    document.getElementById("zoom").value = zoomLevel;
    document.getElementById("zoomValue").textContent = zoomLevel.toFixed(1);

    updateTransform();
    renderInteractive();
  });
}

// Initialize timings panel to default state
function initializeTimingsPanel() {
  // Set initial state to match "no path" state
  updateTimingsPanel({ primary: null, comparisons: [] });
}

// Handle map clicks for point selection
function handleMapClick(e) {
  if (!state.currentMap || state.isMapLoading || state.isHpaLoading) return;

  const wrapper = document.getElementById("canvasWrapper");
  const rect = wrapper.getBoundingClientRect();

  // Convert screen coordinates to tile coordinates
  const canvasX = (e.clientX - rect.left - panX) / zoomLevel;
  const canvasY = (e.clientY - rect.top - panY) / zoomLevel;
  const tileX = Math.floor(canvasX);
  const tileY = Math.floor(canvasY);

  // Validate coordinates
  if (
    tileX < 0 ||
    tileX >= state.mapWidth ||
    tileY < 0 ||
    tileY >= state.mapHeight
  ) {
    return;
  }

  // Check if tile is water
  const index = tileY * state.mapWidth + tileX;
  const isWater = state.mapData[index] === 1;

  if (!isWater) {
    showError("Selected point must be on water");
    return;
  }

  // Point selection state machine
  if (!state.startPoint) {
    // Set start point
    state.startPoint = [tileX, tileY];
    updatePointDisplay();
    renderInteractive();
    updateURLState();
  } else if (!state.endPoint) {
    // Set end point and trigger pathfinding
    state.endPoint = [tileX, tileY];
    updatePointDisplay();
    renderInteractive();
    updateURLState();
    requestPathfinding(state.startPoint, state.endPoint);
  } else {
    // Reset and set new start point
    clearPoints();
    state.startPoint = [tileX, tileY];
    updatePointDisplay();
    renderInteractive();
    updateURLState();
  }
}

// Clear selected points
function clearPoints() {
  state.startPoint = null;
  state.endPoint = null;
  state.hpaPath = null;
  state.hpaResult = null;
  state.comparisons = [];
  state.debugInfo = null;
  updatePointDisplay();
  hidePathInfo();
  updateURLState(); // Remove points from URL
  renderInteractive();
}

// Update transform for pan/zoom
function updateTransform() {
  const transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  mapCanvas.style.transform = transform;
  overlayCanvas.style.transform = transform;
  // Interactive canvas is outside the transform - update it separately
  renderInteractive();
}

// Load available maps
async function loadMaps() {
  setStatus("Loading maps...", true);

  try {
    const response = await fetch("/api/maps");
    if (!response.ok) throw new Error("Failed to load maps");

    const data = await response.json();

    // Featured maps to show in grid (in order)
    const featuredMapNames = [
      "giantworldmap",
      "northamerica",
      "southamerica",
      "europe",
      "asia",
      "straitofgibraltar",
      "manicouagan",
      "mars",
    ];

    // Get featured maps in the specified order
    const gridMaps = featuredMapNames
      .map((name) => data.maps.find((m) => m.name === name))
      .filter((map) => map !== undefined);

    // Populate map grid with featured maps - update placeholders
    gridMaps.forEach((map, index) => {
      const card = document.querySelector(`[data-map-index="${index}"]`);
      if (!card) return;

      // Update click handler
      card.onclick = () => switchMap(map.name);

      // Update image
      const img = card.querySelector("img");
      if (img) {
        img.src = `/api/maps/${encodeURIComponent(map.name)}/thumbnail`;
        img.alt = map.displayName;
      }

      // Update name
      const nameEl = card.querySelector(".map-card-name");
      if (nameEl) {
        nameEl.textContent = map.displayName;
        nameEl.style.opacity = "1";
      }
    });

    // Populate both selectors (all maps)
    const topSelect = document.getElementById("scenarioSelect");
    const welcomeSelect = document.getElementById("welcomeMapSelect");

    topSelect.innerHTML = '<option value="">Select a map</option>';
    welcomeSelect.innerHTML = '<option value="">Select a map</option>';

    data.maps.forEach((map) => {
      // Top panel selector
      const topOption = document.createElement("option");
      topOption.value = map.name;
      topOption.textContent = map.displayName;
      topSelect.appendChild(topOption);

      // Welcome screen selector
      const welcomeOption = document.createElement("option");
      welcomeOption.value = map.name;
      welcomeOption.textContent = map.displayName;
      welcomeSelect.appendChild(welcomeOption);
    });

    setStatus("Select a map to begin");

    // Restore state from URL if present
    const urlState = restoreFromURL();
    if (urlState.map) {
      // Load the map from URL
      await switchMap(urlState.map, true); // Restore points from URL

      // Points will be restored in switchMap after the map loads
    }
  } catch (error) {
    showError(`Failed to load maps: ${error.message}`);
  }
}

// Switch to a different map
async function switchMap(mapName, restorePointsFromURL = false) {
  if (!mapName) return;

  setStatus("Loading map...", true);
  state.isMapLoading = true;

  try {
    const response = await fetch(`/api/maps/${encodeURIComponent(mapName)}`);
    if (!response.ok) throw new Error("Failed to load map");

    const data = await response.json();

    // Update state
    state.currentMap = mapName;
    state.mapWidth = data.width;
    state.mapHeight = data.height;
    state.mapData = data.mapData;
    state.graphDebug = data.graphDebug; // Store static graph debug data
    state.adapters = data.adapters || []; // Store available comparison adapters

    // Clear paths (but don't update URL yet if we're restoring from URL)
    state.startPoint = null;
    state.endPoint = null;
    state.hpaPath = null;
    state.hpaResult = null;
    state.comparisons = [];
    state.debugInfo = null;
    updatePointDisplay();
    hidePathInfo();

    // Size canvases
    mapCanvas.width = state.mapWidth * 2;
    mapCanvas.height = state.mapHeight * 2;
    mapCanvas.style.width = `${state.mapWidth}px`;
    mapCanvas.style.height = `${state.mapHeight}px`;

    overlayCanvas.width = state.mapWidth * 2;
    overlayCanvas.height = state.mapHeight * 2;
    overlayCanvas.style.width = `${state.mapWidth}px`;
    overlayCanvas.style.height = `${state.mapHeight}px`;

    // Render map and overlays
    renderMapBackground(2);
    renderOverlay(2);
    renderInteractive();

    // Reset view
    zoomLevel = 1.0;
    panX = 0;
    panY = 0;
    document.getElementById("zoom").value = 1.0;
    document.getElementById("zoomValue").textContent = "1.0";
    updateTransform();

    // Hide welcome screen
    hideWelcomeScreen();

    // Sync both selectors
    document.getElementById("scenarioSelect").value = mapName;
    document.getElementById("welcomeMapSelect").value = mapName;

    setStatus("Click on map to set start point");
    mapRendered = true;

    // Restore start/end points from URL if requested (initial page load)
    if (restorePointsFromURL) {
      const urlState = restoreFromURL();
      if (urlState.start) {
        const [x, y] = urlState.start;
        if (x >= 0 && x < state.mapWidth && y >= 0 && y < state.mapHeight) {
          const tileIndex = y * state.mapWidth + x;
          const isWater = state.mapData[tileIndex] === 1;
          if (isWater) {
            state.startPoint = [x, y];
          }
        }
      }
      if (urlState.end) {
        const [x, y] = urlState.end;
        if (x >= 0 && x < state.mapWidth && y >= 0 && y < state.mapHeight) {
          const tileIndex = y * state.mapWidth + x;
          const isWater = state.mapData[tileIndex] === 1;
          if (isWater) {
            state.endPoint = [x, y];
          }
        }
      }

      // If both points are set, request pathfinding
      if (state.startPoint && state.endPoint) {
        renderInteractive();
        requestPathfinding(state.startPoint, state.endPoint);
      }
    } else {
      // User manually switched maps - update URL to clear points
      updateURLState();
    }
  } catch (error) {
    showError(`Failed to load map: ${error.message}`);
  } finally {
    state.isMapLoading = false;
  }
}

// Show/hide welcome screen
function showWelcomeScreen() {
  document.getElementById("welcomeScreen").classList.remove("hidden");
}

function hideWelcomeScreen() {
  document.getElementById("welcomeScreen").classList.add("hidden");
}

// Request pathfinding computation (HPA* primary + comparisons)
async function requestPathfinding(from, to, skipComparisons = false) {
  setStatus("Computing path...", true);
  state.isHpaLoading = true;

  try {
    const body = {
      map: state.currentMap,
      from,
      to,
    };
    // Skip comparisons during drag for snappy feel
    if (skipComparisons) {
      body.adapters = [];
    }

    const response = await fetch("/api/pathfind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Pathfinding failed");
    }

    const result = await response.json();

    // Update state with new API format
    state.hpaPath = result.primary.path;
    state.hpaResult = result.primary;
    state.comparisons = result.comparisons;
    state.debugInfo = {
      initialPath: result.primary.debug.initialPath,
      nodePath: result.primary.debug.nodePath,
      timings: result.primary.debug.timings,
    };

    // Update UI
    updatePathInfo(result);
    renderInteractive();

    setStatus("Path computed successfully");
  } catch (error) {
    showError(`Pathfinding failed: ${error.message}`);
  } finally {
    state.isHpaLoading = false;
    // Stop refresh button spinning
    if (state.activeRefreshButton) {
      state.activeRefreshButton.classList.remove("spinning");
      state.activeRefreshButton = null;
    }
  }
}

// Update point display
function updatePointDisplay() {
  // No-op now, kept for compatibility
}

// Update path info in UI
function updatePathInfo(result) {
  // Update timings panel
  updateTimingsPanel(result);
}

// Update the dedicated timings panel
function updateTimingsPanel(result) {
  const primary = result.primary;
  const timings = primary && primary.debug ? primary.debug.timings : {};

  // Use timings.total (excludes debug overhead) instead of raw time
  const hpaTime = timings.total || 0;

  // Show HPA* time and path length (or 0.00 in light gray if no data)
  const hpaTimeEl = document.getElementById("hpaTime");
  if (hpaTime > 0) {
    hpaTimeEl.textContent = `${hpaTime.toFixed(2)}ms`;
    hpaTimeEl.classList.remove("faded");
  } else {
    hpaTimeEl.textContent = "0.00ms";
    hpaTimeEl.classList.add("faded");
  }

  const hpaTilesEl = document.getElementById("hpaTiles");
  if (primary && primary.length > 0) {
    hpaTilesEl.textContent = `- ${primary.length} tiles`;
  } else {
    hpaTilesEl.textContent = "";
  }

  // Show timing breakdown - always visible with gray dashes when no data
  // Early Exit
  const earlyExitEl = document.getElementById("timingEarlyExit");
  const earlyExitValueEl = document.getElementById("timingEarlyExitValue");
  earlyExitEl.style.display = "flex";
  if (timings.earlyExitLocalPath !== undefined) {
    earlyExitValueEl.textContent = `${timings.earlyExitLocalPath.toFixed(2)}ms`;
    earlyExitValueEl.style.color = "#f5f5f5";
  } else {
    earlyExitValueEl.textContent = "—";
    earlyExitValueEl.style.color = "#666";
  }

  // Find Nodes
  const findNodesEl = document.getElementById("timingFindNodes");
  const findNodesValueEl = document.getElementById("timingFindNodesValue");
  findNodesEl.style.display = "flex";
  if (timings.findNodes !== undefined) {
    findNodesValueEl.textContent = `${timings.findNodes.toFixed(2)}ms`;
    findNodesValueEl.style.color = "#f5f5f5";
  } else {
    findNodesValueEl.textContent = "—";
    findNodesValueEl.style.color = "#666";
  }

  // Abstract Path
  const abstractPathEl = document.getElementById("timingAbstractPath");
  const abstractPathValueEl = document.getElementById(
    "timingAbstractPathValue",
  );
  abstractPathEl.style.display = "flex";
  if (timings.findAbstractPath !== undefined) {
    abstractPathValueEl.textContent = `${timings.findAbstractPath.toFixed(2)}ms`;
    abstractPathValueEl.style.color = "#f5f5f5";
  } else {
    abstractPathValueEl.textContent = "—";
    abstractPathValueEl.style.color = "#666";
  }

  // Initial Path
  const initialPathEl = document.getElementById("timingInitialPath");
  const initialPathValueEl = document.getElementById("timingInitialPathValue");
  initialPathEl.style.display = "flex";
  if (timings.buildInitialPath !== undefined) {
    initialPathValueEl.textContent = `${timings.buildInitialPath.toFixed(2)}ms`;
    initialPathValueEl.style.color = "#f5f5f5";
  } else {
    initialPathValueEl.textContent = "—";
    initialPathValueEl.style.color = "#666";
  }

  // Show comparisons section
  const comparisonsSection = document.getElementById("comparisonsSection");
  const comparisonsContainer = document.getElementById("comparisonsContainer");

  // Only show comparisons section if we have adapters loaded
  if (!state.adapters || state.adapters.length === 0) {
    comparisonsSection.style.display = "none";
    return;
  }
  comparisonsSection.style.display = "block";

  // Build lookup map for comparison data
  const compMap = {};
  if (result.comparisons) {
    for (const comp of result.comparisons) {
      compMap[comp.adapter] = comp;
    }
  }

  // Find fastest time overall (including HPA*) when we have data
  const compTimes = result.comparisons
    ? result.comparisons.map((c) => c.time).filter((t) => t > 0)
    : [];
  const fastestCompTime =
    compTimes.length > 0 ? Math.min(...compTimes) : Infinity;

  // Update HPA* time color - green if fastest, red if slower than any comparison
  const hpaIsFastest = hpaTime > 0 && hpaTime <= fastestCompTime;
  const hpaSlower = hpaTime > 0 && fastestCompTime < hpaTime;
  const fastestTime = Math.min(hpaTime || Infinity, fastestCompTime);

  if (hpaIsFastest) {
    hpaTimeEl.style.color = "#00ff88";
  } else if (hpaSlower) {
    hpaTimeEl.style.color = "#ff6666";
  } else {
    hpaTimeEl.style.color = "#f5f5f5";
  }

  // Build comparison rows for all known adapters
  let html = "";
  for (const adapter of state.adapters) {
    const comp = compMap[adapter];
    const pathColor = COMPARISON_COLORS[adapter] || "#ffffff";
    const isActive = state.visibleComparisons.has(adapter);

    // Show actual values or placeholders
    const hasData = comp && comp.time > 0;
    const isFastest = hasData && comp.time === fastestTime;
    const timeColor = isFastest ? "#00ff88" : hasData ? "#f5f5f5" : "#666";
    const tilesText = hasData ? comp.length : "—";
    const timeText = hasData ? `${comp.time.toFixed(2)}ms` : "—";

    html += `
      <div class="comparison-row${isActive ? " active" : ""}" data-adapter="${adapter}">
        <span class="comp-color" style="background: ${pathColor}"></span>
        <span class="comp-name">${adapter}</span>
        <span class="comp-tiles" style="color: ${hasData ? "#888" : "#666"}">${tilesText}</span>
        <span class="comp-time" style="color: ${timeColor}">${timeText}</span>
      </div>
    `;
  }
  comparisonsContainer.innerHTML = html;

  // Add click handlers to toggle path visibility
  comparisonsContainer.querySelectorAll(".comparison-row").forEach((row) => {
    row.addEventListener("click", () => {
      const adapter = row.dataset.adapter;
      if (state.visibleComparisons.has(adapter)) {
        state.visibleComparisons.delete(adapter);
        row.classList.remove("active");
      } else {
        state.visibleComparisons.add(adapter);
        row.classList.add("active");
      }
      renderInteractive();
    });
  });
}

// Reset path info to show dashes
function hidePathInfo() {
  // Don't hide the panel, just reset to show dashes
  updateTimingsPanel({ primary: null, comparisons: [] });
}

// Set status message
function setStatus(message, loading = false) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = loading ? "loading" : "";
}

// Show error message
function showError(message) {
  const errorEl = document.getElementById("error");
  errorEl.textContent = message;
  errorEl.classList.add("visible");
  setTimeout(() => {
    errorEl.classList.remove("visible");
  }, 5000);
  setStatus(message, false);
}

// Render map background
function renderMapBackground(scale) {
  mapCanvas.width = state.mapWidth * scale;
  mapCanvas.height = state.mapHeight * scale;
  mapCanvas.style.width = `${state.mapWidth}px`;
  mapCanvas.style.height = `${state.mapHeight}px`;

  // Use ImageData for much faster rendering
  const imageData = mapCtx.createImageData(
    state.mapWidth * scale,
    state.mapHeight * scale,
  );
  const data = imageData.data;

  // Check if colored map is enabled
  const showColored =
    document.getElementById("showColoredMap").dataset.active === "true";

  let waterR, waterG, waterB, landR, landG, landB;

  if (showColored) {
    // Colored: Water = #2a5c8a (darker blue), Land = #a1bb75
    waterR = 42;
    waterG = 92;
    waterB = 138;
    landR = 161;
    landG = 187;
    landB = 117;
  } else {
    // Grayscale: Water = #3c3c3c (darker gray), Land = #777777 (slightly darker)
    waterR = 60;
    waterG = 60;
    waterB = 60;
    landR = 119;
    landG = 119;
    landB = 119;
  }

  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      const mapIndex = y * state.mapWidth + x;
      const isWater = state.mapData[mapIndex] === 1;

      const r = isWater ? waterR : landR;
      const g = isWater ? waterG : landG;
      const b = isWater ? waterB : landB;

      // Fill all pixels for this tile (scale x scale block)
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x * scale + dx;
          const py = y * scale + dy;
          const pixelIndex = (py * state.mapWidth * scale + px) * 4;

          data[pixelIndex] = r;
          data[pixelIndex + 1] = g;
          data[pixelIndex + 2] = b;
          data[pixelIndex + 3] = 255; // Alpha
        }
      }
    }
  }

  mapCtx.putImageData(imageData, 0, 0);
}

// Render static debug overlays (clusters, edges, all nodes) at map scale
function renderOverlay(scale) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!state.mapData || !state.graphDebug) return;

  const showSectorGrid =
    document.getElementById("showSectorGrid").dataset.active === "true";
  const showEdges =
    document.getElementById("showEdges").dataset.active === "true";
  const showNodes =
    document.getElementById("showNodes").dataset.active === "true";

  // Draw cluster grid (clusterSize is in mini map coords, scale 2x for real map)
  if (showSectorGrid && state.graphDebug.clusterSize) {
    const clusterSize = state.graphDebug.clusterSize * 2;
    overlayCtx.strokeStyle = "#777777";
    overlayCtx.lineWidth = scale * 0.5;
    overlayCtx.globalAlpha = 0.7;
    overlayCtx.setLineDash([5 * scale, 5 * scale]);

    // Vertical lines
    for (let x = 0; x <= state.mapWidth; x += clusterSize) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(x * scale, 0);
      overlayCtx.lineTo(x * scale, state.mapHeight * scale);
      overlayCtx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= state.mapHeight; y += clusterSize) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(0, y * scale);
      overlayCtx.lineTo(state.mapWidth * scale, y * scale);
      overlayCtx.stroke();
    }

    overlayCtx.setLineDash([]);
    overlayCtx.globalAlpha = 1.0;
  }

  // Draw edges
  if (showEdges && state.graphDebug.edges) {
    overlayCtx.strokeStyle = "#00ff88";
    overlayCtx.lineWidth = scale * 0.5;
    overlayCtx.globalAlpha = 0.4;

    for (const edge of state.graphDebug.edges) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(
        (edge.from[0] + 0.5) * scale,
        (edge.from[1] + 0.5) * scale,
      );
      overlayCtx.lineTo((edge.to[0] + 0.5) * scale, (edge.to[1] + 0.5) * scale);
      overlayCtx.stroke();
    }

    overlayCtx.globalAlpha = 1.0;
  }

  // Draw all nodes
  if (showNodes && state.graphDebug.allNodes) {
    overlayCtx.fillStyle = "#aaaaaa";
    const nodeRadius = scale * 1.5;

    for (const node of state.graphDebug.allNodes) {
      overlayCtx.beginPath();
      overlayCtx.arc(
        (node.x * 2 + 0.5) * scale,
        (node.y * 2 + 0.5) * scale,
        nodeRadius,
        0,
        Math.PI * 2,
      );
      overlayCtx.fill();
    }
  }
}

// Convert map coordinates to screen coordinates
function mapToScreen(mapX, mapY) {
  return {
    x: mapX * zoomLevel + panX,
    y: mapY * zoomLevel + panY,
  };
}

// Render truly interactive/dynamic overlay (paths, points, highlights) at screen coordinates
function renderInteractive() {
  // Clear viewport-sized canvas (super fast!)
  interactiveCtx.clearRect(
    0,
    0,
    interactiveCanvas.width,
    interactiveCanvas.height,
  );

  if (!state.mapData) return;

  const markerSize = Math.max(4, 3 * zoomLevel);

  // Check what to show
  const showUsedNodes =
    document.getElementById("showUsedNodes").dataset.active === "true";
  const showInitialPath =
    document.getElementById("showInitialPath").dataset.active === "true";
  const showEdges =
    document.getElementById("showEdges").dataset.active === "true";
  const showNodes =
    document.getElementById("showNodes").dataset.active === "true";

  // Draw highlighted edges for hovered node only
  if (hoveredNode && showEdges && state.graphDebug && state.graphDebug.edges) {
    const connectedEdges = state.graphDebug.edges.filter(
      (e) => e.fromId === hoveredNode.id || e.toId === hoveredNode.id,
    );

    interactiveCtx.strokeStyle = "#00ffaa";
    interactiveCtx.lineWidth = Math.max(1, zoomLevel * 0.8);
    interactiveCtx.globalAlpha = 1.0;

    for (const edge of connectedEdges) {
      const from = mapToScreen(edge.from[0], edge.from[1]);
      const to = mapToScreen(edge.to[0], edge.to[1]);
      interactiveCtx.beginPath();
      interactiveCtx.moveTo(from.x, from.y);
      interactiveCtx.lineTo(to.x, to.y);
      interactiveCtx.stroke();
    }

    interactiveCtx.globalAlpha = 1.0;
  }

  // Draw highlighted nodes (hovered + connected) only
  if (
    hoveredNode &&
    showNodes &&
    state.graphDebug &&
    state.graphDebug.allNodes
  ) {
    // Get connected nodes
    let connectedNodeIds = new Set();
    if (state.graphDebug.edges) {
      const connectedEdges = state.graphDebug.edges.filter(
        (e) => e.fromId === hoveredNode.id || e.toId === hoveredNode.id,
      );
      connectedEdges.forEach((edge) => {
        if (edge.fromId !== hoveredNode.id) connectedNodeIds.add(edge.fromId);
        if (edge.toId !== hoveredNode.id) connectedNodeIds.add(edge.toId);
      });
    }

    // Draw connected nodes
    for (const nodeId of connectedNodeIds) {
      const node = state.graphDebug.allNodes.find((n) => n.id === nodeId);
      if (node) {
        const screen = mapToScreen(node.x * 2, node.y * 2);
        interactiveCtx.fillStyle = "#00ff88";
        interactiveCtx.strokeStyle = "#ffffff";
        interactiveCtx.lineWidth = Math.max(1, zoomLevel * 0.3);
        interactiveCtx.beginPath();
        interactiveCtx.arc(
          screen.x,
          screen.y,
          Math.max(3, zoomLevel * 2),
          0,
          Math.PI * 2,
        );
        interactiveCtx.fill();
        interactiveCtx.stroke();
      }
    }

    // Draw hovered node on top
    const screen = mapToScreen(hoveredNode.x * 2, hoveredNode.y * 2);
    interactiveCtx.fillStyle = "#ffff00";
    interactiveCtx.strokeStyle = "#ffffff";
    interactiveCtx.lineWidth = Math.max(1, zoomLevel * 0.5);
    interactiveCtx.beginPath();
    interactiveCtx.arc(
      screen.x,
      screen.y,
      Math.max(4, zoomLevel * 2.5),
      0,
      Math.PI * 2,
    );
    interactiveCtx.fill();
    interactiveCtx.stroke();
  }

  // Draw initial path (unsmoothed)
  if (
    showInitialPath &&
    state.debugInfo &&
    state.debugInfo.initialPath &&
    state.debugInfo.initialPath.length > 0
  ) {
    interactiveCtx.strokeStyle = "#ff00ff";
    interactiveCtx.lineWidth = Math.max(1, zoomLevel);
    interactiveCtx.lineCap = "round";
    interactiveCtx.lineJoin = "round";
    interactiveCtx.beginPath();

    for (let i = 0; i < state.debugInfo.initialPath.length; i++) {
      const [x, y] = state.debugInfo.initialPath[i];
      const screen = mapToScreen(x + 0.5, y + 0.5);
      if (i === 0) {
        interactiveCtx.moveTo(screen.x, screen.y);
      } else {
        interactiveCtx.lineTo(screen.x, screen.y);
      }
    }
    interactiveCtx.stroke();
  }

  // Draw comparison paths (before HPA* so primary is on top)
  if (state.comparisons && state.visibleComparisons.size > 0) {
    interactiveCtx.lineCap = "round";
    interactiveCtx.lineJoin = "round";

    for (const comp of state.comparisons) {
      if (!state.visibleComparisons.has(comp.adapter)) continue;
      if (!comp.path || comp.path.length === 0) continue;

      const color = COMPARISON_COLORS[comp.adapter] || "#ffffff";
      interactiveCtx.strokeStyle = color;
      interactiveCtx.lineWidth = Math.max(1, zoomLevel);
      interactiveCtx.beginPath();

      for (let i = 0; i < comp.path.length; i++) {
        const [x, y] = comp.path[i];
        const screen = mapToScreen(x + 0.5, y + 0.5);
        if (i === 0) {
          interactiveCtx.moveTo(screen.x, screen.y);
        } else {
          interactiveCtx.lineTo(screen.x, screen.y);
        }
      }
      interactiveCtx.stroke();
    }
  }

  // Draw HPA* path
  if (state.hpaPath && state.hpaPath.length > 0) {
    interactiveCtx.strokeStyle = "#00ffff";
    interactiveCtx.lineWidth = Math.max(1, zoomLevel);
    interactiveCtx.lineCap = "round";
    interactiveCtx.lineJoin = "round";
    interactiveCtx.beginPath();

    for (let i = 0; i < state.hpaPath.length; i++) {
      const [x, y] = state.hpaPath[i];
      const screen = mapToScreen(x + 0.5, y + 0.5);
      if (i === 0) {
        interactiveCtx.moveTo(screen.x, screen.y);
      } else {
        interactiveCtx.lineTo(screen.x, screen.y);
      }
    }
    interactiveCtx.stroke();
  }

  // Draw used nodes (highlighted)
  if (showUsedNodes && state.debugInfo && state.debugInfo.nodePath) {
    interactiveCtx.fillStyle = "#ffff00";
    const usedNodeRadius = Math.max(3, zoomLevel * 2.5);

    for (const [x, y] of state.debugInfo.nodePath) {
      // Nodes are coordinates [x, y] in the same format as path
      const screen = mapToScreen(x + 0.5, y + 0.5);
      interactiveCtx.beginPath();
      interactiveCtx.arc(screen.x, screen.y, usedNodeRadius, 0, Math.PI * 2);
      interactiveCtx.fill();
    }
  }

  // Start point
  if (state.startPoint) {
    let mapX, mapY;
    if (draggingPoint === "start" && draggingPointPosition) {
      // Dragging - snap to tile center
      mapX = draggingPointPosition[0] + 0.5;
      mapY = draggingPointPosition[1] + 0.5;
    } else {
      mapX = state.startPoint[0] + 0.5;
      mapY = state.startPoint[1] + 0.5;
    }

    const screen = mapToScreen(mapX, mapY);

    // Highlight ring if hovered
    if (hoveredPoint === "start") {
      interactiveCtx.strokeStyle = "#ff4444";
      interactiveCtx.lineWidth = Math.max(2, zoomLevel * 0.5);
      interactiveCtx.globalAlpha = 0.5;
      interactiveCtx.beginPath();
      interactiveCtx.arc(screen.x, screen.y, markerSize + 3, 0, Math.PI * 2);
      interactiveCtx.stroke();
      interactiveCtx.globalAlpha = 1.0;
    }

    // Draw point
    interactiveCtx.fillStyle = "#ff4444";
    interactiveCtx.beginPath();
    interactiveCtx.arc(screen.x, screen.y, markerSize, 0, Math.PI * 2);
    interactiveCtx.fill();
  }

  // End point
  if (state.endPoint) {
    let mapX, mapY;
    if (draggingPoint === "end" && draggingPointPosition) {
      // Dragging - snap to tile center
      mapX = draggingPointPosition[0] + 0.5;
      mapY = draggingPointPosition[1] + 0.5;
    } else {
      mapX = state.endPoint[0] + 0.5;
      mapY = state.endPoint[1] + 0.5;
    }

    const screen = mapToScreen(mapX, mapY);

    // Highlight ring if hovered
    if (hoveredPoint === "end") {
      interactiveCtx.strokeStyle = "#44ff44";
      interactiveCtx.lineWidth = Math.max(2, zoomLevel * 0.5);
      interactiveCtx.globalAlpha = 0.5;
      interactiveCtx.beginPath();
      interactiveCtx.arc(screen.x, screen.y, markerSize + 3, 0, Math.PI * 2);
      interactiveCtx.stroke();
      interactiveCtx.globalAlpha = 1.0;
    }

    // Draw point
    interactiveCtx.fillStyle = "#44ff44";
    interactiveCtx.beginPath();
    interactiveCtx.arc(screen.x, screen.y, markerSize, 0, Math.PI * 2);
    interactiveCtx.fill();
  }
}

function findNodeAtPosition(canvasX, canvasY, nodesToCheck = null) {
  const nodes = nodesToCheck || (state.graphDebug && state.graphDebug.allNodes);
  if (!nodes) {
    return null;
  }

  const threshold = 10;

  for (const node of nodes) {
    const nodeX = node.x * 2;
    const nodeY = node.y * 2;
    const dx = Math.abs(canvasX - nodeX);
    const dy = Math.abs(canvasY - nodeY);

    if (dx < threshold && dy < threshold) {
      return node;
    }
  }

  return null;
}

// Show node tooltip
function showNodeTooltip(node, mouseX, mouseY) {
  const tooltip = document.getElementById("tooltip");

  const connectedEdges = state.graphDebug.edges.filter(
    (e) => e.fromId === node.id || e.toId === node.id,
  );

  const selfLoops = connectedEdges.filter((e) => e.fromId === e.toId);

  let html = `<strong>Node ${node.id}</strong><br>`;
  html += `Position: (${node.x * 2}, ${node.y * 2})<br>`;
  html += `<strong>Edges: ${connectedEdges.length}</strong>`;

  if (selfLoops.length > 0) {
    html += ` <span style="color: #ff4444;">(${selfLoops.length} self-loop!)</span>`;
  }

  if (connectedEdges.length > 0) {
    html += '<br><div style="margin-top: 5px; font-size: 11px;">';

    // Edges are bidirectional now, just show connected nodes
    const connected = connectedEdges.filter((e) => e.fromId !== e.toId);

    if (connected.length > 0) {
      html += `<div style="color: #88ff88;">Connected (${connected.length}):</div>`;
      connected.slice(0, 8).forEach((edge) => {
        const otherId = edge.fromId === node.id ? edge.toId : edge.fromId;
        html += `  ↔ Node ${otherId}: cost ${edge.cost.toFixed(1)}<br>`;
      });
      if (connected.length > 8) {
        html += `  ... and ${connected.length - 8} more<br>`;
      }
    }

    if (selfLoops.length > 0) {
      html += `<div style="color: #ff4444;">Self-loops (${selfLoops.length}):</div>`;
      selfLoops.forEach((edge) => {
        html += `  ⟲ cost ${edge.cost.toFixed(1)}<br>`;
      });
    }

    html += "</div>";
  }

  tooltip.innerHTML = html;
  tooltip.style.left = mouseX + 15 + "px";
  tooltip.style.top = mouseY + 15 + "px";
  tooltip.classList.add("visible");
}

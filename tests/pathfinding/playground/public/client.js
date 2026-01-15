// Application State
const state = {
  currentMap: null,
  mapData: null,
  mapWidth: 0,
  mapHeight: 0,
  startPoint: null,
  endPoint: null,
  navMeshPath: null,
  navMeshResult: null, // Store full NavMesh result including timing
  pfMiniPath: null,
  pfMiniResult: null, // Store full PF.Mini result including timing
  graphDebug: null, // Static graph data (gateways, edges, sectorSize) - loaded once per map
  debugInfo: null, // Per-path debug data (timings, gatewayWaypoints, initialPath)
  isMapLoading: false, // Loading state for map switching
  isNavMeshLoading: false, // Separate loading state for NavMesh
  isPfMiniLoading: false, // Separate loading state for PF.Mini
  showPfMini: false,
  activeRefreshButton: null, // Track which refresh button is spinning
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
let hoveredGateway = null;
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

  // PF.Mini request button
  document.getElementById("requestPfMini").addEventListener("click", () => {
    if (
      state.startPoint &&
      state.endPoint &&
      !state.pfMiniPath &&
      !state.isPfMiniLoading
    ) {
      state.showPfMini = true;
      requestPfMiniOnly(state.startPoint, state.endPoint);
    }
  });

  // Refresh NavMesh button
  document.getElementById("refreshNavMesh").addEventListener("click", (e) => {
    if (state.startPoint && state.endPoint) {
      const btn = e.currentTarget;
      btn.classList.add("spinning");
      state.activeRefreshButton = btn;
      requestPathfinding(state.startPoint, state.endPoint);
    }
  });

  // Refresh PF.Mini button
  document.getElementById("refreshPfMini").addEventListener("click", (e) => {
    if (state.startPoint && state.endPoint && state.pfMiniPath) {
      const btn = e.currentTarget;
      btn.classList.add("spinning");
      state.activeRefreshButton = btn;
      requestPfMiniOnly(state.startPoint, state.endPoint);
    }
  });

  // Visualization toggles - all buttons
  [
    "showInitialPath",
    "showUsedGateways",
    "showColoredMap",
    "showGateways",
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
      // Static overlays (sectors, edges, all gateways) go on overlay canvas
      if (["showGateways", "showSectorGrid", "showEdges"].includes(id)) {
        renderOverlay(2);
      }
      // Dynamic elements (paths, highlighted gateways) go on interactive canvas
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
      requestPathfinding(state.startPoint, state.endPoint);
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

      // Invalidate PF.Mini path since we're changing the route
      state.pfMiniPath = null;
      state.pfMiniResult = null;
      updatePfMiniButton();
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

      // Check for gateway hover (only if gateway visualization is enabled)
      const showGateways =
        document.getElementById("showGateways").dataset.active === "true";
      const showUsedGateways =
        document.getElementById("showUsedGateways").dataset.active === "true";

      if (
        (showGateways || showUsedGateways) &&
        state.graphDebug &&
        state.graphDebug.allGateways
      ) {
        // Filter gateways based on what's visible
        let gatewaysToCheck = state.graphDebug.allGateways;
        if (
          showUsedGateways &&
          !showGateways &&
          state.debugInfo &&
          state.debugInfo.gatewayWaypoints
        ) {
          // Only show tooltips for used gateways
          // gatewayWaypoints are coordinates [x, y] matching the map format
          const usedGatewayCoords = new Set(
            state.debugInfo.gatewayWaypoints.map(([x, y]) => `${x},${y}`),
          );
          gatewaysToCheck = state.graphDebug.allGateways.filter((gw) =>
            usedGatewayCoords.has(`${gw.x * 2},${gw.y * 2}`),
          );
        }

        const foundGateway = findGatewayAtPosition(
          canvasX,
          canvasY,
          gatewaysToCheck,
        );

        if (foundGateway !== hoveredGateway) {
          hoveredGateway = foundGateway;
          if (hoveredGateway) {
            showGatewayTooltip(hoveredGateway, e.clientX, e.clientY);
          } else {
            tooltip.classList.remove("visible");
          }
          renderInteractive();
        } else if (hoveredGateway) {
          tooltip.style.left = e.clientX + 15 + "px";
          tooltip.style.top = e.clientY + 15 + "px";
        }
      } else {
        // No gateway visualization enabled, clear any existing tooltip
        if (hoveredGateway) {
          hoveredGateway = null;
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

    const needsRender = hoveredGateway || hoveredPoint;
    hoveredGateway = null;
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
  updateTimingsPanel({ navMesh: null, pfMini: null });
  updatePfMiniButton();
}

// Handle map clicks for point selection
function handleMapClick(e) {
  if (
    !state.currentMap ||
    state.isMapLoading ||
    state.isNavMeshLoading ||
    state.isPfMiniLoading
  )
    return;

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
  state.navMeshPath = null;
  state.navMeshResult = null;
  state.pfMiniPath = null;
  state.pfMiniResult = null;
  state.debugInfo = null;
  state.showPfMini = false;
  updatePointDisplay();
  hidePathInfo();
  updatePfMiniButton();
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

    // Clear paths (but don't update URL yet if we're restoring from URL)
    state.startPoint = null;
    state.endPoint = null;
    state.navMeshPath = null;
    state.navMeshResult = null;
    state.pfMiniPath = null;
    state.pfMiniResult = null;
    state.debugInfo = null;
    state.showPfMini = false;
    updatePointDisplay();
    hidePathInfo();
    updatePfMiniButton();

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

// Request pathfinding computation (NavMesh only)
async function requestPathfinding(from, to) {
  setStatus("Computing path...", true);
  state.isNavMeshLoading = true;

  try {
    const response = await fetch("/api/pathfind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        map: state.currentMap,
        from,
        to,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Pathfinding failed");
    }

    const result = await response.json();

    // Update state
    state.navMeshPath = result.path;
    state.navMeshResult = result; // Store full result for later use
    // Don't reset pfMiniPath - preserve it across NavMesh refreshes
    state.debugInfo = {
      initialPath: result.initialPath,
      gatewayWaypoints: result.gateways,
      timings: result.timings,
    };

    // Update UI - preserve existing PF.Mini if it exists
    updatePathInfo({ navMesh: result, pfMini: state.pfMiniResult });
    renderInteractive();

    setStatus("Path computed successfully");
  } catch (error) {
    showError(`Pathfinding failed: ${error.message}`);
  } finally {
    state.isNavMeshLoading = false;
    // Stop refresh button spinning
    if (state.activeRefreshButton) {
      state.activeRefreshButton.classList.remove("spinning");
      state.activeRefreshButton = null;
    }
  }
}

// Request PF.Mini computation only (without re-computing NavMesh)
async function requestPfMiniOnly(from, to) {
  setStatus("Computing PF.Mini path...", true);
  state.isPfMiniLoading = true;
  updatePfMiniButton(); // Update button to show loading state

  try {
    const response = await fetch("/api/pathfind-pfmini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        map: state.currentMap,
        from,
        to,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Pathfinding failed");
    }

    const result = await response.json();

    // Update only PF.Mini path (preserve existing NavMesh path and debug info)
    state.pfMiniPath = result.path;
    state.pfMiniResult = result; // Store full result

    // Update UI (preserve existing NavMesh result)
    updatePathInfo({ navMesh: state.navMeshResult, pfMini: result });
    renderInteractive();

    setStatus("PF.Mini path computed successfully");
  } catch (error) {
    showError(`PF.Mini pathfinding failed: ${error.message}`);
  } finally {
    state.isPfMiniLoading = false;
    // Stop refresh button spinning
    if (state.activeRefreshButton) {
      state.activeRefreshButton.classList.remove("spinning");
      state.activeRefreshButton = null;
    }
    // Update button state
    updatePfMiniButton();
  }
}

// Update point display
function updatePointDisplay() {
  updatePfMiniButton();
}

// Update PF.Mini button state
function updatePfMiniButton() {
  const button = document.getElementById("requestPfMini");
  const requestSection = document.getElementById("pfMiniRequestSection");

  if (state.pfMiniPath) {
    // Hide button when PF.Mini is already computed
    requestSection.style.display = "none";
  } else if (state.isPfMiniLoading && !state.activeRefreshButton) {
    // Show loading spinner when computing PF.Mini (not a refresh)
    requestSection.style.display = "block";
    button.disabled = true;
    button.innerHTML = 'Computing... <span class="loading-spinner"></span>';
  } else if (state.startPoint && state.endPoint && state.navMeshPath) {
    // Show and enable button when points are set and NavMesh path exists
    requestSection.style.display = "block";
    button.disabled = false;
    button.textContent = "Request PathFinder.Mini";
  } else {
    // Show but disable button when points aren't set
    requestSection.style.display = "block";
    button.disabled = true;
    button.textContent = "Request PathFinder.Mini";
  }
}

// Update path info in UI
function updatePathInfo(result) {
  // Update PF.Mini legend visibility
  if (result.pfMini) {
    document.getElementById("pfMiniLegend").style.display = "flex";
  } else {
    document.getElementById("pfMiniLegend").style.display = "none";
  }

  // Update timings panel
  updateTimingsPanel(result);

  // Update PF.Mini button
  updatePfMiniButton();
}

// Update the dedicated timings panel
function updateTimingsPanel(result) {
  const navMesh = result.navMesh;

  // Show NavMesh time and path length (or 0.00 in light gray if no data)
  const navMeshTimeEl = document.getElementById("navMeshTime");
  if (navMesh && navMesh.time > 0) {
    navMeshTimeEl.textContent = `${navMesh.time.toFixed(2)}ms`;
    navMeshTimeEl.classList.remove("faded");
  } else {
    navMeshTimeEl.textContent = "0.00ms";
    navMeshTimeEl.classList.add("faded");
  }

  const navMeshTilesEl = document.getElementById("navMeshTiles");
  if (navMesh && navMesh.length > 0) {
    navMeshTilesEl.textContent = `- ${navMesh.length} tiles`;
  } else {
    navMeshTilesEl.textContent = "";
  }

  // Show timing breakdown - always visible with gray dashes when no data
  const timings = navMesh && navMesh.timings ? navMesh.timings : {};

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

  // Find Gateways
  const findGatewaysEl = document.getElementById("timingFindGateways");
  const findGatewaysValueEl = document.getElementById(
    "timingFindGatewaysValue",
  );
  findGatewaysEl.style.display = "flex";
  if (timings.findGateways !== undefined) {
    findGatewaysValueEl.textContent = `${timings.findGateways.toFixed(2)}ms`;
    findGatewaysValueEl.style.color = "#f5f5f5";
  } else {
    findGatewaysValueEl.textContent = "—";
    findGatewaysValueEl.style.color = "#666";
  }

  // Gateway Path
  const gatewayPathEl = document.getElementById("timingGatewayPath");
  const gatewayPathValueEl = document.getElementById("timingGatewayPathValue");
  gatewayPathEl.style.display = "flex";
  if (timings.findGatewayPath !== undefined) {
    gatewayPathValueEl.textContent = `${timings.findGatewayPath.toFixed(2)}ms`;
    gatewayPathValueEl.style.color = "#f5f5f5";
  } else {
    gatewayPathValueEl.textContent = "—";
    gatewayPathValueEl.style.color = "#666";
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

  // Smooth Path
  const smoothPathEl = document.getElementById("timingSmoothPath");
  const smoothPathValueEl = document.getElementById("timingSmoothPathValue");
  smoothPathEl.style.display = "flex";
  if (timings.buildSmoothPath !== undefined) {
    smoothPathValueEl.textContent = `${timings.buildSmoothPath.toFixed(2)}ms`;
    smoothPathValueEl.style.color = "#f5f5f5";
  } else {
    smoothPathValueEl.textContent = "—";
    smoothPathValueEl.style.color = "#666";
  }

  // Show PF.Mini time and speedup if available
  if (result.pfMini && result.pfMini.time > 0) {
    const pfMiniTimeEl = document.getElementById("pfMiniTime");
    pfMiniTimeEl.textContent = `${result.pfMini.time.toFixed(2)}ms`;
    pfMiniTimeEl.classList.remove("faded");

    document.getElementById("pfMiniTiles").textContent =
      `- ${result.pfMini.length} tiles`;
    document.getElementById("pfMiniTimingSection").style.display = "block";

    // Calculate and show speedup
    if (navMesh && navMesh.time > 0) {
      const speedup = result.pfMini.time / navMesh.time;
      document.getElementById("speedupValue").textContent =
        `${speedup.toFixed(1)}x`;
      document.getElementById("speedupSection").style.display = "block";
    } else {
      document.getElementById("speedupSection").style.display = "none";
    }
  } else if (result.pfMini) {
    // PF.Mini exists but time is 0
    const pfMiniTimeEl = document.getElementById("pfMiniTime");
    pfMiniTimeEl.textContent = "—";
    pfMiniTimeEl.classList.add("faded");
    document.getElementById("pfMiniTiles").textContent = "";
    document.getElementById("pfMiniTimingSection").style.display = "block";
    document.getElementById("speedupSection").style.display = "none";
  } else {
    document.getElementById("pfMiniTimingSection").style.display = "none";
    document.getElementById("speedupSection").style.display = "none";
  }
}

// Reset path info to show dashes
function hidePathInfo() {
  // Don't hide the panel, just reset to show dashes
  updateTimingsPanel({ navMesh: null, pfMini: null });
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

// Render static debug overlays (sectors, edges, all gateways) at map scale
function renderOverlay(scale) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!state.mapData || !state.graphDebug) return;

  const showSectorGrid =
    document.getElementById("showSectorGrid").dataset.active === "true";
  const showEdges =
    document.getElementById("showEdges").dataset.active === "true";
  const showGateways =
    document.getElementById("showGateways").dataset.active === "true";

  // Draw sector grid (sectorSize is in mini map coords, scale 2x for real map)
  if (showSectorGrid && state.graphDebug.sectorSize) {
    const sectorSize = state.graphDebug.sectorSize * 2;
    overlayCtx.strokeStyle = "#777777";
    overlayCtx.lineWidth = scale * 0.5;
    overlayCtx.globalAlpha = 0.7;
    overlayCtx.setLineDash([5 * scale, 5 * scale]);

    // Vertical lines
    for (let x = 0; x <= state.mapWidth; x += sectorSize) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(x * scale, 0);
      overlayCtx.lineTo(x * scale, state.mapHeight * scale);
      overlayCtx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= state.mapHeight; y += sectorSize) {
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

  // Draw all gateways
  if (showGateways && state.graphDebug.allGateways) {
    overlayCtx.fillStyle = "#aaaaaa";
    const gatewayRadius = scale * 1.5;

    for (const gw of state.graphDebug.allGateways) {
      overlayCtx.beginPath();
      overlayCtx.arc(
        (gw.x * 2 + 0.5) * scale,
        (gw.y * 2 + 0.5) * scale,
        gatewayRadius,
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
  const showUsedGateways =
    document.getElementById("showUsedGateways").dataset.active === "true";
  const showInitialPath =
    document.getElementById("showInitialPath").dataset.active === "true";
  const showEdges =
    document.getElementById("showEdges").dataset.active === "true";
  const showGateways =
    document.getElementById("showGateways").dataset.active === "true";

  // Draw highlighted edges for hovered gateway only
  if (
    hoveredGateway &&
    showEdges &&
    state.graphDebug &&
    state.graphDebug.edges
  ) {
    const connectedEdges = state.graphDebug.edges.filter(
      (e) => e.fromId === hoveredGateway.id || e.toId === hoveredGateway.id,
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

  // Draw highlighted gateways (hovered + connected) only
  if (
    hoveredGateway &&
    showGateways &&
    state.graphDebug &&
    state.graphDebug.allGateways
  ) {
    // Get connected gateways
    let connectedGatewayIds = new Set();
    if (state.graphDebug.edges) {
      const connectedEdges = state.graphDebug.edges.filter(
        (e) => e.fromId === hoveredGateway.id || e.toId === hoveredGateway.id,
      );
      connectedEdges.forEach((edge) => {
        if (edge.fromId !== hoveredGateway.id)
          connectedGatewayIds.add(edge.fromId);
        if (edge.toId !== hoveredGateway.id) connectedGatewayIds.add(edge.toId);
      });
    }

    // Draw connected gateways
    for (const gwId of connectedGatewayIds) {
      const gw = state.graphDebug.allGateways.find((g) => g.id === gwId);
      if (gw) {
        const screen = mapToScreen(gw.x * 2, gw.y * 2);
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

    // Draw hovered gateway on top
    const screen = mapToScreen(hoveredGateway.x * 2, hoveredGateway.y * 2);
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

  // Draw NavMesh path
  if (state.navMeshPath && state.navMeshPath.length > 0) {
    interactiveCtx.strokeStyle = "#00ffff";
    interactiveCtx.lineWidth = Math.max(1, zoomLevel);
    interactiveCtx.lineCap = "round";
    interactiveCtx.lineJoin = "round";
    interactiveCtx.beginPath();

    for (let i = 0; i < state.navMeshPath.length; i++) {
      const [x, y] = state.navMeshPath[i];
      const screen = mapToScreen(x + 0.5, y + 0.5);
      if (i === 0) {
        interactiveCtx.moveTo(screen.x, screen.y);
      } else {
        interactiveCtx.lineTo(screen.x, screen.y);
      }
    }
    interactiveCtx.stroke();
  }

  // Draw PF.Mini path
  if (state.pfMiniPath && state.pfMiniPath.length > 0) {
    interactiveCtx.strokeStyle = "#ffaa00";
    interactiveCtx.lineWidth = Math.max(1, zoomLevel);
    interactiveCtx.lineCap = "round";
    interactiveCtx.lineJoin = "round";
    interactiveCtx.beginPath();

    for (let i = 0; i < state.pfMiniPath.length; i++) {
      const [x, y] = state.pfMiniPath[i];
      const screen = mapToScreen(x + 0.5, y + 0.5);
      if (i === 0) {
        interactiveCtx.moveTo(screen.x, screen.y);
      } else {
        interactiveCtx.lineTo(screen.x, screen.y);
      }
    }
    interactiveCtx.stroke();
  }

  // Draw used gateways (highlighted)
  if (showUsedGateways && state.debugInfo && state.debugInfo.gatewayWaypoints) {
    interactiveCtx.fillStyle = "#ffff00";
    const usedGatewayRadius = Math.max(3, zoomLevel * 2.5);

    for (const [x, y] of state.debugInfo.gatewayWaypoints) {
      // Gateways are coordinates [x, y] in the same format as path
      const screen = mapToScreen(x + 0.5, y + 0.5);
      interactiveCtx.beginPath();
      interactiveCtx.arc(screen.x, screen.y, usedGatewayRadius, 0, Math.PI * 2);
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

function findGatewayAtPosition(canvasX, canvasY, gatewaysToCheck = null) {
  const gateways =
    gatewaysToCheck || (state.graphDebug && state.graphDebug.allGateways);
  if (!gateways) {
    return null;
  }

  const threshold = 10;

  for (const gw of gateways) {
    const gwX = gw.x * 2;
    const gwY = gw.y * 2;
    const dx = Math.abs(canvasX - gwX);
    const dy = Math.abs(canvasY - gwY);

    if (dx < threshold && dy < threshold) {
      return gw;
    }
  }

  return null;
}

// Show gateway tooltip
function showGatewayTooltip(gateway, mouseX, mouseY) {
  const tooltip = document.getElementById("tooltip");

  const connectedEdges = state.graphDebug.edges.filter(
    (e) => e.fromId === gateway.id || e.toId === gateway.id,
  );

  const selfLoops = connectedEdges.filter((e) => e.fromId === e.toId);

  let html = `<strong>Gateway ${gateway.id}</strong><br>`;
  html += `Position: (${gateway.x * 2}, ${gateway.y * 2})<br>`;
  html += `<strong>Edges: ${connectedEdges.length}</strong>`;

  if (selfLoops.length > 0) {
    html += ` <span style="color: #ff4444;">(${selfLoops.length} self-loop!)</span>`;
  }

  if (connectedEdges.length > 0) {
    html += '<br><div style="margin-top: 5px; font-size: 11px;">';

    const outgoing = connectedEdges.filter(
      (e) => e.fromId === gateway.id && e.toId !== gateway.id,
    );
    const incoming = connectedEdges.filter(
      (e) => e.toId === gateway.id && e.fromId !== gateway.id,
    );

    if (outgoing.length > 0) {
      html += `<div style="color: #88ff88;">Outgoing (${outgoing.length}):</div>`;
      outgoing.slice(0, 5).forEach((edge) => {
        const pathLen = edge.path ? edge.path.length : 0;
        html += `  → GW ${edge.toId}: cost ${edge.cost.toFixed(1)}`;
        if (pathLen > 0) html += ` (${pathLen} tiles)`;
        html += "<br>";
      });
      if (outgoing.length > 5) {
        html += `  ... and ${outgoing.length - 5} more<br>`;
      }
    }

    if (incoming.length > 0) {
      html += `<div style="color: #ffaa88;">Incoming (${incoming.length}):</div>`;
      incoming.slice(0, 5).forEach((edge) => {
        const pathLen = edge.path ? edge.path.length : 0;
        html += `  ← GW ${edge.fromId}: cost ${edge.cost.toFixed(1)}`;
        if (pathLen > 0) html += ` (${pathLen} tiles)`;
        html += "<br>";
      });
      if (incoming.length > 5) {
        html += `  ... and ${incoming.length - 5} more<br>`;
      }
    }

    if (selfLoops.length > 0) {
      html += `<div style="color: #ff4444;">Self-loops (${selfLoops.length}):</div>`;
      selfLoops.forEach((edge) => {
        const pathLen = edge.path ? edge.path.length : 0;
        html += `  ⟲ cost ${edge.cost.toFixed(1)}`;
        if (pathLen > 0) html += ` (${pathLen} tiles)`;
        html += "<br>";
      });
    }

    html += "</div>";
  }

  tooltip.innerHTML = html;
  tooltip.style.left = mouseX + 15 + "px";
  tooltip.style.top = mouseY + 15 + "px";
  tooltip.classList.add("visible");
}

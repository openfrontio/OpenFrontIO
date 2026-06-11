#version 300 es
precision highp float;
precision highp int;

// Unit quad vertex position [0,0]→[1,1]
layout(location = 0) in vec2 aPos;

// Data textures (shared with name shader)
uniform sampler2D uPlayerData; // 8 × MAX_PLAYERS, RGBA32F

// Uniforms
uniform mat3  uCamera;
uniform float uTime;
uniform float uLerpSpeed;
uniform float uCullThreshold;
uniform float uNameScaleFactor;
uniform float uNameScaleCap;
uniform float uFontSize;
uniform float uFontBase;

// Status atlas layout
uniform float uStatusCell;   // texels per cell (square)
uniform float uStatusCols;   // columns in atlas
uniform float uStatusAtlasW; // atlas texture width
uniform float uStatusAtlasH; // atlas texture height
uniform float uStatusPad;    // transparent padding in texels per side

// Configurable layout
uniform float uStatusRowOffset;  // row Y offset (multiples of uFontBase * nameWorldScale)

uniform float uFadeOwnerID;    // smallID of player whose name plate the cursor is over (0 = none)
uniform float uHoverFadeAlpha; // alpha multiplier applied to that player's name plate

out vec2 vUV;
out vec2 vLocalUV;               // 0..1 within the icon cell
flat out int vDiscard;
flat out float vAllianceFraction; // 0 = no drain effect, >0 = active drain
flat out vec2 vFadedUV0;         // top-left UV of faded alliance cell
flat out vec2 vFadedUV1;         // bottom-right UV of faded alliance cell
flat out float vFlashAlpha;      // traitor flash opacity (1.0 = fully visible)
out float vHoverAlpha;

// Status flag float array — indexed by icon slot.
// Slot mapping: 0=crown, 1=traitor, 2=disconnected, 3=alliance,
//               4=allianceReq, 5=target, 6=embargo, 7=nukeActive
float statusFlag[8];

// Read status flags from pd5/pd6 into the statusFlag array.
void readStatusFlags(int playerIdx) {
  vec4 pd5 = texelFetch(uPlayerData, ivec2(5, playerIdx), 0);
  vec4 pd6 = texelFetch(uPlayerData, ivec2(6, playerIdx), 0);
  statusFlag[0] = pd5.x; // crown
  statusFlag[1] = pd5.y; // traitor
  statusFlag[2] = pd5.z; // disconnected
  statusFlag[3] = pd5.w; // alliance
  statusFlag[4] = pd6.x; // allianceReq
  statusFlag[5] = pd6.y; // target
  statusFlag[6] = pd6.z; // embargo
  statusFlag[7] = pd6.w; // nukeActive
}

// Count active icons with index < pos.
int countBelow(int pos) {
  int count = 0;
  for (int i = 0; i < pos; i++) {
    if (statusFlag[i] > 0.5) count++;
  }
  return count;
}

// Compute padded UV rect for an atlas cell.
// Returns (u0, v0) in xy and (u1, v1) in zw, inset by pad pixels.
vec4 cellUV(int idx) {
  int col = idx - (idx / int(uStatusCols)) * int(uStatusCols);
  int row = idx / int(uStatusCols);
  float u0 = (float(col) * uStatusCell + uStatusPad) / uStatusAtlasW;
  float v0 = (float(row) * uStatusCell + uStatusPad) / uStatusAtlasH;
  float iconSize = uStatusCell - 2.0 * uStatusPad;
  float u1 = u0 + iconSize / uStatusAtlasW;
  float v1 = v0 + iconSize / uStatusAtlasH;
  return vec4(u0, v0, u1, v1);
}

void main() {
  // Decode instance ID → playerIdx + iconSlot (0..7)
  int playerIdx = gl_InstanceID / 8;
  int iconSlot  = gl_InstanceID - playerIdx * 8;

  // Read player data
  vec4 pd0 = texelFetch(uPlayerData, ivec2(0, playerIdx), 0); // srcX, srcY, srcScale, startTime
  vec4 pd1 = texelFetch(uPlayerData, ivec2(1, playerIdx), 0); // tgtX, tgtY, tgtScale, alive
  vec4 pd4 = texelFetch(uPlayerData, ivec2(4, playerIdx), 0); // flagIdx, emojiIdx, smallID, [free]
  vec4 pd7 = texelFetch(uPlayerData, ivec2(7, playerIdx), 0); // nukeTargetsMe, traitorRemainingTicks, allianceFraction, [free]

  // Early out: dead player OR emoji is active
  if (pd1.w <= 0.0 || pd4.y >= 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vLocalUV = vec2(0.0);
    vDiscard = 1;
    vAllianceFraction = 0.0;
    vFadedUV0 = vec2(0.0);
    vFadedUV1 = vec2(0.0);
    vFlashAlpha = 1.0;
    vHoverAlpha = 1.0;
    return;
  }

  // Read status flags into array
  readStatusFlags(playerIdx);

  // Early out: this icon slot is inactive
  if (statusFlag[iconSlot] < 0.5) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vLocalUV = vec2(0.0);
    vDiscard = 1;
    vAllianceFraction = 0.0;
    vFadedUV0 = vec2(0.0);
    vFadedUV1 = vec2(0.0);
    vFlashAlpha = 1.0;
    vHoverAlpha = 1.0;
    return;
  }

  // Lerped world position and size (same math as name.vert.glsl)
  float elapsed = uTime - pd0.w;
  float t = clamp(1.0 - exp(-uLerpSpeed * elapsed), 0.0, 1.0);
  float wx = mix(pd0.x, pd1.x, t);
  float wy = mix(pd0.y, pd1.y, t);
  float ws = mix(pd0.z, pd1.z, t);

  // Sizing pipeline (must match name.vert.glsl exactly)
  float baseSize      = max(1.0, floor(ws));
  float nameSize      = max(4.0, floor(baseSize * uNameScaleFactor));
  float nameScale     = min(baseSize * 0.25, uNameScaleCap);
  float nameWorldScale = (nameSize * nameScale) / uFontSize;

  // Zoom-based culling (same as name shader)
  float cameraScale = length(vec2(uCamera[0][0], uCamera[1][0]));
  float screenSize  = nameWorldScale * uFontBase * cameraScale;
  if (screenSize < uCullThreshold) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vLocalUV = vec2(0.0);
    vDiscard = 1;
    vAllianceFraction = 0.0;
    vFadedUV0 = vec2(0.0);
    vFadedUV1 = vec2(0.0);
    vFlashAlpha = 1.0;
    vHoverAlpha = 1.0;
    return;
  }

  // Icon world size: matches name text height
  float iconWorldSize = uFontBase * nameWorldScale * 1.1;

  // Count active icons and position of this one (left-to-right)
  int totalActive = 0;
  for (int i = 0; i < 8; i++) {
    if (statusFlag[i] > 0.5) totalActive++;
  }
  int myIndex = countBelow(iconSlot);

  // Horizontal centering: spread icons evenly above the name
  float gap = iconWorldSize * 0.15;
  float totalWidth = float(totalActive) * iconWorldSize + float(totalActive - 1) * gap;
  float startX = wx - totalWidth * 0.5;
  float iconX = startX + float(myIndex) * (iconWorldSize + gap);

  // Position: row above the emoji row
  float iconY = wy - uFontBase * nameWorldScale * uStatusRowOffset;

  // Determine atlas index
  // Slots 0-6 map directly to atlas indices 0-6
  // Slot 7 (nuke): use nukeRed (7) if nukeTargetsMe, else nukeWhite (8)
  int atlasIdx = iconSlot;
  if (iconSlot == 7) {
    atlasIdx = (pd7.x > 0.5) ? 7 : 8;
  }

  // Fade the status row along with the rest of the name plate when the cursor
  // is over any part of it. Hit test runs on the CPU (NamePass).
  vHoverAlpha = (uFadeOwnerID > 0.0 && pd4.z == uFadeOwnerID)
    ? uHoverFadeAlpha : 1.0;

  // Quad world position
  vec2 iconOrigin = vec2(iconX, iconY);
  vec2 worldPos = iconOrigin + aPos * vec2(iconWorldSize, iconWorldSize);

  // Camera transform
  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  // UV from atlas grid (padded to avoid mipmap bleed)
  vec4 uv = cellUV(atlasIdx);
  vUV = vec2(mix(uv.x, uv.z, aPos.x), mix(uv.y, uv.w, aPos.y));
  vLocalUV = aPos;

  // Alliance drain: slot 3 = alliance icon
  float allianceFrac = pd7.z;
  if (iconSlot == 3 && allianceFrac > 0.0 && allianceFrac < 1.0) {
    vAllianceFraction = allianceFrac;
    // Faded alliance icon is at atlas index 9
    vec4 fadedUV = cellUV(9);
    vFadedUV0 = fadedUV.xy;
    vFadedUV1 = fadedUV.zw;
  } else {
    vAllianceFraction = 0.0;
    vFadedUV0 = vec2(0.0);
    vFadedUV1 = vec2(0.0);
  }

  // Traitor flash: slot 1 = traitor icon
  // Frequency ramps linearly from 2 Hz (at 15s) to 5 Hz (at 0s).
  // Phase = uTime*2 + elapsed²*0.1 — the quadratic term adds smooth
  // acceleration without phase discontinuities between ticks.
  vFlashAlpha = 1.0;
  if (iconSlot == 1) {
    float remaining = pd7.y;                          // ticks (0-300, 10/sec)
    float remainingSec = remaining / 10.0;             // seconds
    if (remainingSec <= 15.0 && remainingSec > 0.0) {
      float elapsed = 15.0 - remainingSec;
      float phase = uTime * 2.0 + elapsed * elapsed * 0.1;
      vFlashAlpha = 0.3 + 0.7 * (0.5 + 0.5 * cos(phase * 6.2832));
    }
  }

  vDiscard = 0;
}

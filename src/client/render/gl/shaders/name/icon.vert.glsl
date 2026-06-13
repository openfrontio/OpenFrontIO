#version 300 es
precision highp float;
precision highp int;

// Unit quad vertex position [0,0]→[1,1]
layout(location = 0) in vec2 aPos;

// Data textures (shared with name shader)
uniform sampler2D uPlayerData; // PLAYER_DATA_COLS × MAX_PLAYERS, RGBA32F

// Uniforms
uniform mat3  uCamera;
uniform float uTime;
uniform float uLerpSpeed;
uniform float uCullThreshold;
uniform float uNameScaleFactor;
uniform float uNameScaleCap;
uniform float uFontSize;        // atlas reference font size (same as name shader's uFontSize)
uniform float uFontBase;        // atlas baseline height (same as name shader's uBase)

// Flag cell shape (fixed, matches FlagAtlasArray cell size)
uniform float uFlagCellW;
uniform float uFlagCellH;

// Emoji atlas layout
uniform float uEmojiCell;    // texels per emoji cell (square)
uniform float uEmojiCols;    // columns in emoji atlas
uniform float uEmojiAtlasW;  // emoji atlas texture width
uniform float uEmojiAtlasH;  // emoji atlas texture height

// Row offset (multiples of uFontBase * nameWorldScale)
uniform float uEmojiRowOffset;

uniform float uFadeOwnerID;    // smallID of player whose name plate the cursor is over (0 = none)
uniform float uHoverFadeAlpha; // alpha multiplier applied to that player's name plate

out vec2 vUV;
flat out int vIconType;  // 0 = flag, 1 = emoji, -1 = discard
flat out int vFlagLayer; // valid when vIconType == 0
out float vHoverAlpha;

void main() {
  // Decode instance ID → playerIdx + iconType (0=flag, 1=emoji)
  int playerIdx = gl_InstanceID / 2;
  int iconType  = gl_InstanceID - playerIdx * 2;

  // Read player data
  vec4 pd0 = texelFetch(uPlayerData, ivec2(0, playerIdx), 0); // srcX, srcY, srcScale, startTime
  vec4 pd1 = texelFetch(uPlayerData, ivec2(1, playerIdx), 0); // tgtX, tgtY, tgtScale, alive
  vec4 pd3 = texelFetch(uPlayerData, ivec2(3, playerIdx), 0); // nameLen, troopLen, isHuman, nameHalfWidth
  vec4 pd4 = texelFetch(uPlayerData, ivec2(4, playerIdx), 0); // flagLayer, emojiIdx, smallID, [free]

  // Early out: dead player
  if (pd1.w <= 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vIconType = -1;
    vFlagLayer = 0;
    vHoverAlpha = 1.0;
    return;
  }

  // Get atlas/layer index for this icon type
  float atlasIdx = (iconType == 0) ? pd4.x : pd4.y;
  if (atlasIdx < 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vIconType = -1;
    vFlagLayer = 0;
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
    vIconType = -1;
    vFlagLayer = 0;
    vHoverAlpha = 1.0;
    return;
  }

  float nameHalfWidth = pd3.w; // in font units (pre-scaled by nameWorldScale at runtime)

  // Compute icon size and position based on type
  float iconW, iconH;
  vec2 iconOrigin;

  if (iconType == 0) {
    // FLAG — to the left of the name. Sampled from sampler2DArray; uses
    // plain [0,1] UVs and the layer is passed via vFlagLayer.
    float flagWorldH = uFontBase * nameWorldScale * 1.2;
    float flagWorldW = flagWorldH * (uFlagCellW / uFlagCellH);

    iconOrigin = vec2(
      wx - nameHalfWidth * nameWorldScale - flagWorldW,
      wy - flagWorldH * 0.5
    );
    iconW = flagWorldW;
    iconH = flagWorldH;

    vUV = aPos;
    vFlagLayer = int(atlasIdx);
  } else {
    // EMOJI — above the name. Sampled from a 2D atlas; compute grid UVs.
    float cellW  = uEmojiCell;
    float cellH  = uEmojiCell;
    float cols   = uEmojiCols;
    float atlasW = uEmojiAtlasW;
    float atlasH = uEmojiAtlasH;

    float emojiWorldSize = uFontBase * nameWorldScale * 1.0;

    iconOrigin = vec2(
      wx - emojiWorldSize * 0.5,
      wy - uFontBase * nameWorldScale * uEmojiRowOffset
    );
    iconW = emojiWorldSize;
    iconH = emojiWorldSize;

    int idx = int(atlasIdx);
    int col = idx - (idx / int(cols)) * int(cols);
    int row = idx / int(cols);
    float u0 = float(col) * cellW / atlasW;
    float v0 = float(row) * cellH / atlasH;
    float u1 = u0 + cellW / atlasW;
    float v1 = v0 + cellH / atlasH;
    vUV = vec2(mix(u0, u1, aPos.x), mix(v0, v1, aPos.y));
    vFlagLayer = 0;
  }

  // Fade the icon along with the rest of the name plate when the cursor is
  // over any part of it. Hit test runs on the CPU (NamePass).
  vHoverAlpha = (uFadeOwnerID > 0.0 && pd4.z == uFadeOwnerID)
    ? uHoverFadeAlpha : 1.0;

  // Quad world position
  vec2 worldPos = iconOrigin + aPos * vec2(iconW, iconH);

  // Camera transform
  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vIconType = iconType;
}

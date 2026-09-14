#version 300 es
precision highp float;

uniform vec2 uMapSize;
uniform float uCellSize;
uniform float uZoom;
uniform float uFontSize;
uniform sampler2D uGlyphTex;
uniform float uOpacity;

in vec2 vWorldPos;
out vec4 fragColor;

const float GLYPH_COUNT = 36.0;  // 0-9, A-Z

void main() {
  vec2 wp = vWorldPos;
  if (wp.x < 0.0 || wp.y < 0.0 || wp.x >= uMapSize.x || wp.y >= uMapSize.y)
    discard;

  float cs = uCellSize;
  float px = 1.0 / uZoom;       // 1 screen pixel in world units
  float lineW = px * 1.25;

  // Grid cell index + position within cell
  int cellCol = int(floor(wp.x / cs));
  int cellRow = int(floor(wp.y / cs));
  float localX = wp.x - float(cellCol) * cs;
  float localY = wp.y - float(cellRow) * cs;

  // --- Grid lines (at cell boundaries) ---
  if (localX < lineW || localY < lineW) {
    fragColor = vec4(1.0, 1.0, 1.0, uOpacity);
    return;
  }

  // --- Labels (only when cells are large enough on screen) ---
  float cellScreenPx = cs * uZoom;
  if (cellScreenPx < 60.0) discard;

  float fontSize = clamp(uFontSize + (uZoom - 1.0) * 1.2, uFontSize * 0.9, uFontSize * 1.6);
  float gw = fontSize * 0.6 * px;   // glyph width in world units
  float gh = fontSize * px;          // glyph height
  float pad = 8.0 * px;              // padding from cell corner

  float lx = localX - pad;
  float ly = localY - pad;

  // Compute label characters: row alpha + col digits
  // Atlas indices: 0-9 = digits '0'-'9', 10-35 = letters 'A'-'Z'
  int c0, c1 = -1, c2 = -1, c3 = -1;
  int nc;

  // Row part (A, B, ..., Z, AA, AB, ...)
  if (cellRow < 26) {
    c0 = cellRow + 10;
    nc = 1;
  } else {
    c0 = (cellRow / 26 - 1) + 10;
    c1 = (cellRow % 26) + 10;
    nc = 2;
  }

  // Col part (1-indexed: 1, 2, ..., 50)
  int colNum = cellCol + 1;
  if (nc == 1) {
    if (colNum < 10) { c1 = colNum; nc = 2; }
    else { c1 = colNum / 10; c2 = colNum % 10; nc = 3; }
  } else {
    if (colNum < 10) { c2 = colNum; nc = 3; }
    else { c2 = colNum / 10; c3 = colNum % 10; nc = 4; }
  }

  float totalW = float(nc) * gw;

  // Check if on actual glyph
  if (lx < 0.0 || ly < 0.0 || lx >= totalW || ly >= gh) {
    discard;
  }

  int ci = int(floor(lx / gw));
  if (ci < nc) {
    int g;
    if (ci == 0) g = c0;
    else if (ci == 1) g = c1;
    else if (ci == 2) g = c2;
    else g = c3;

    float cu = fract(lx / gw);
    float cv = ly / gh;
    float au = (float(g) + cu) / GLYPH_COUNT;
    vec4 gColor = texture(uGlyphTex, vec2(au, cv));
    fragColor = gColor.a * vec4(gColor.rgb, uOpacity);
    return;
  }
}

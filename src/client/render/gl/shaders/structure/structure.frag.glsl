#version 300 es
precision highp float;

uniform sampler2D uPalette;
uniform sampler2D uAtlas;
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — row 1 = unit affiliation
uniform sampler2D uEffect;        // RGBA32F — shared effect palette, keyed by
                                  //   ownerID. The structures block starts at row
                                  //   STRUCT_EFFECT_ROW_BASE; same layout as
                                  //   trail.frag.glsl (row r = color r's rgb;
                                  //   row 0.a = count, 1.a = styleId,
                                  //   2.a = scalar0, 3.a = scalar1)
uniform float uTime;              // seconds, for animated effect styles
uniform float uHoverOwner;        // smallID of the hovered territory's owner
                                  //   (0 = none) — gates the structures effect
uniform float uDotsThreshold;
uniform float uGhostAlpha;       // 1.0 = normal, <1.0 = ghost transparency
uniform vec3  uOutlineColor;     // ghost outline color (vec3(0) = no outline)
uniform int   uAltView;
uniform int   uHighlightMask;   // bitmask of atlas columns to highlight (0 = off)
uniform float uHighlightOutlineW; // outline width for highlighted structures
uniform float uHighlightDimAlpha; // alpha multiplier for non-highlighted structures
uniform float uFillDarken;      // HSV value multiplier on icon fill
uniform float uBorderDarken;    // HSV value multiplier on icon border
uniform float uIconAlpha;       // global multiplier on final icon alpha
uniform vec3  uIconColor;       // color of the inner icon glyph (was white)
uniform float uIconDarken;      // >0: glyph = darkened player color instead of uIconColor
uniform float uLocalPlayerID;

in vec2  vLocalPos;
in vec2  vAtlasUV;
flat in float vOwnerID;
flat in float vUnderConstruction;
flat in float vMarkedForDeletion;
flat in float vZoom;
flat in float vAtlasIdx;
flat in float vShapeScale;

out vec4 fragColor;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 darken(vec3 rgb, float vScale) {
  vec3 hsv = rgb2hsv(rgb);
  hsv.z *= vScale;
  return hsv2rgb(hsv);
}

// The owner's structures cosmetic color, if equipped. Reads the structures
// block of the shared effect palette; the gradient/transition math mirrors
// trail.frag.glsl so the same catalog attributes look identical on both.
// Returns false when the owner has no structures effect (count 0).
bool structuresEffectColor(int owner, out vec3 color) {
  const int rowBase = STRUCT_EFFECT_ROW_BASE;
  int count = int(texelFetch(uEffect, ivec2(owner, rowBase), 0).a + 0.5);
  if (count <= 0) return false;
  if (count == 1) {
    // Single color — flat recolor.
    color = texelFetch(uEffect, ivec2(owner, rowBase), 0).rgb;
  } else if (int(texelFetch(uEffect, ivec2(owner, rowBase + 1), 0).a + 0.5) == 1) {
    // transition — one color at a time, cross-fading through the list.
    // frequency = color changes per second.
    float frequency = texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a;
    float t = uTime * frequency;
    int i = int(t) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(t));
  } else {
    // gradient — the palette spans the icon's diagonal once, so the whole
    // gradient is visible across the shape (world-space banding like the
    // trail's would put the entire icon inside one band and read as a flat
    // color). It scrolls along the diagonal at the trail-equivalent pace:
    // one full slide every colorSize · count / movementSpeed seconds,
    // so both knobs keep their trail timing semantics.
    float colorSize = max(texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a, 0.001);
    float movementSpeed = texelFetch(uEffect, ivec2(owner, rowBase + 3), 0).a;
    float dn = (vLocalPos.x + vLocalPos.y) * 0.5; // icon diagonal, -0.5..0.5
    float phase =
      fract(dn - uTime * movementSpeed / (colorSize * float(count)));
    float f = phase * float(count);
    int i = int(f) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(f));
  }
  return true;
}

#define PI 3.14159265

// Signed distance to regular polygon edge.
// R = circumradius (center-to-vertex), n = sides, rot = rotation in radians.
// Returns negative inside, positive outside.
float sdPolygon(vec2 p, float R, float n, float rot) {
  float an = PI / n;
  float a = atan(p.y, p.x) - rot;
  a = mod(a + an, 2.0 * an) - an;
  return length(p) * cos(a) - R * cos(an);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
  return length(p - mix(a, b, h));
}

float lineAlpha(vec2 p, vec2 a, vec2 b, float width) {
  float aa = fwidth(p.x) + fwidth(p.y);
  return 1.0 - smoothstep(width, width + max(aa, 0.004), sdSegment(p, a, b));
}

// Dedicated mine glyphs. These are procedural rather than atlas-backed so they
// cannot disappear because of sprite-atlas dimensions or asset decoding.
float mineGlyphAlpha(vec2 p, float atlasIdx) {
  float alpha = 0.0;

  if (atlasIdx < 6.5) {
    // Oil derrick / pumpjack.
    alpha = max(alpha, lineAlpha(p, vec2(-0.22, 0.24), vec2(0.0, -0.20), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(0.22, 0.24), vec2(0.0, -0.20), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(-0.24, 0.24), vec2(0.24, 0.24), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(-0.17, 0.04), vec2(0.17, 0.04), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(-0.22, -0.20), vec2(0.22, -0.20), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(0.0, -0.20), vec2(0.0, 0.32), 0.03));
  } else if (atlasIdx < 7.5) {
    // Gold pickaxe.
    alpha = max(alpha, lineAlpha(p, vec2(-0.22, 0.22), vec2(0.20, -0.22), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(-0.27, 0.23), vec2(0.02, 0.30), 0.04));
    alpha = max(alpha, lineAlpha(p, vec2(0.02, 0.30), vec2(0.27, 0.22), 0.04));
  } else if (atlasIdx < 8.5) {
    // Diamond gem with internal facets.
    alpha = max(alpha, lineAlpha(p, vec2(-0.28, 0.12), vec2(-0.12, 0.28), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(-0.12, 0.28), vec2(0.12, 0.28), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(0.12, 0.28), vec2(0.28, 0.12), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(0.28, 0.12), vec2(0.0, -0.28), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(0.0, -0.28), vec2(-0.28, 0.12), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(-0.28, 0.12), vec2(0.28, 0.12), 0.025));
    alpha = max(alpha, lineAlpha(p, vec2(-0.12, 0.28), vec2(0.0, 0.12), 0.025));
    alpha = max(alpha, lineAlpha(p, vec2(0.12, 0.28), vec2(0.0, 0.12), 0.025));
    alpha = max(alpha, lineAlpha(p, vec2(0.0, 0.12), vec2(0.0, -0.28), 0.025));
  } else {
    // Livestock Farm / Barn with gambrel roof and door cross.
    alpha = max(alpha, lineAlpha(p, vec2(0.0, 0.24), vec2(-0.16, 0.14), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(0.0, 0.24), vec2(0.16, 0.14), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(-0.16, 0.14), vec2(-0.22, 0.02), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(0.16, 0.14), vec2(0.22, 0.02), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(-0.19, 0.02), vec2(-0.19, -0.22), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(0.19, 0.02), vec2(0.19, -0.22), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(-0.22, -0.22), vec2(0.22, -0.22), 0.035));
    alpha = max(alpha, lineAlpha(p, vec2(-0.08, -0.22), vec2(-0.08, -0.06), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(0.08, -0.22), vec2(0.08, -0.06), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(-0.08, -0.06), vec2(0.08, -0.06), 0.03));
    alpha = max(alpha, lineAlpha(p, vec2(-0.07, -0.07), vec2(0.07, -0.21), 0.025));
    alpha = max(alpha, lineAlpha(p, vec2(-0.07, -0.21), vec2(0.07, -0.07), 0.025));
  }

  return clamp(alpha, 0.0, 1.0);
}

// Per-structure-type shape SDF.
// Atlas indices: 0=City, 1=Port, 2=Factory, 3=DefensePost, 4=SAM,
// 5=Silo, 6=Oil Mine, 7=Gold Mine, 8=Diamond Mine, 9=Livestock Farm
float shapeSDF(vec2 p, float R) {
  if (vAtlasIdx < 0.5)
    return length(p) - R;                     // City → circle
  if (vAtlasIdx < 1.5)
    return sdPolygon(p, R, 5.0, PI * 0.5);    // Port → pentagon (vertex up)
  if (vAtlasIdx < 2.5)
    return sdPolygon(p, R, 6.0, PI / 6.0);    // Factory → hexagon (flat top)
  if (vAtlasIdx < 3.5)
    return sdPolygon(p, R, 8.0, 0.0);         // Defense Post → octagon (flat top)
  if (vAtlasIdx < 4.5)
    return sdPolygon(p, R, 4.0, 0.0);         // SAM Launcher → square (flat sides)
  if (vAtlasIdx < 5.5)
    return sdPolygon(p, R, 3.0, PI * 0.5);    // Missile Silo → triangle (vertex up)
  if (vAtlasIdx < 6.5)
    return sdPolygon(p, R, 6.0, PI / 6.0);    // Oil Mine → hexagon
  if (vAtlasIdx < 7.5)
    return length(p) - R;                     // Gold Mine → circle
  if (vAtlasIdx < 8.5)
    return sdPolygon(p, R, 4.0, PI * 0.25);   // Diamond Mine → diamond
  return length(p) - R;                       // Livestock Farm → circle
}

void main() {
  float dist = length(vLocalPos);
  float radius = 0.45;
  float borderWidth = 0.06 / vShapeScale;

  float sdf = shapeSDF(vLocalPos, radius);
  float fw = fwidth(dist);

  // When highlight is active, expand the region to include the outer outline band.
  float highlightOutlineW = uHighlightMask != 0 ? uHighlightOutlineW / vShapeScale : 0.0;
  float outerAlpha = 1.0 - smoothstep(-fw, fw, sdf - highlightOutlineW);

  if (outerAlpha <= 0.0) discard;

  float borderMask = 1.0 - smoothstep(-fw, fw, sdf + borderWidth);

  // Player color
  vec4 fillColor;
  vec4 borderColor;

  if (uAltView != 0 && vUnderConstruction < 0.5) {
    vec3 ac = texelFetch(uAffiliation, ivec2(int(vOwnerID), 1), 0).rgb;
    fillColor = vec4(darken(ac, uFillDarken), 1.0);
    borderColor = vec4(darken(ac, uBorderDarken), 1.0);
  } else if (vUnderConstruction > 0.5) {
    fillColor = vec4(198.0/255.0, 198.0/255.0, 198.0/255.0, 1.0);
    borderColor = vec4(127.0/255.0, 127.0/255.0, 127.0/255.0, 1.0);
  } else {
    int owner = int(vOwnerID + 0.5);
    int local = int(uLocalPlayerID);
    float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
    fillColor = texture(uPalette, vec2(u, 0.25));
    // if local player, use territory color because the border color is grey
    borderColor = texture(uPalette, vec2(u, owner == local ? 0.25 : 0.75));
    // Darken via HSV value so hue/saturation stay intact
    // vScale < 1.0 = darker, > 1.0 = brighter
    fillColor.rgb = darken(fillColor.rgb, uFillDarken);
    borderColor.rgb = darken(borderColor.rgb, uBorderDarken);
    fillColor.a = 1.0;
    borderColor.a = 1.0;
  }

  // structures cosmetic: recolor the fill with the owner's effect (raw catalog
  // colors, like trails — no darken) while their territory is hovered. The
  // local player's own effect always shows — touch devices never hover, and
  // buyers should see what they paid for. The border keeps the player color
  // so ownership stays readable. Skipped for alt view and construction gray.
  bool effectActive = false;
  if (uAltView == 0 && vUnderConstruction < 0.5) {
    int effOwner = int(vOwnerID + 0.5);
    if ((effOwner == int(uHoverOwner + 0.5) ||
         effOwner == int(uLocalPlayerID)) && effOwner > 0) {
      vec3 effectRGB;
      if (structuresEffectColor(effOwner, effectRGB)) {
        fillColor.rgb = effectRGB;
        effectActive = true;
      }
    }
  }

  vec4 bgColor = mix(borderColor, fillColor, borderMask);

  // Sample icon from atlas (white on transparent)
  // Only show icon detail when zoomed in enough
  float iconAlpha = 0.0;
  if (vZoom > uDotsThreshold) {
    if (vAtlasIdx >= 5.5) {
      iconAlpha = mineGlyphAlpha(vLocalPos, vAtlasIdx) * borderMask;
    } else {
      // Clamp UV to this atlas column to prevent bleeding into neighbours
      // when uIconFill shrinks the icon (expanding UV range beyond column).
      float colStart = vAtlasIdx / float(BASE_ATLAS_COLS);
      float colEnd = (vAtlasIdx + 1.0) / float(BASE_ATLAS_COLS);
      vec2 safeUV = vec2(clamp(vAtlasUV.x, colStart, colEnd), clamp(vAtlasUV.y, 0.0, 1.0));
      vec4 iconSample = texture(uAtlas, safeUV);
      // Zero out icon outside the valid UV region (clamped pixels would repeat the edge)
      float inBounds = step(colStart, vAtlasUV.x) * step(vAtlasUV.x, colEnd)
                     * step(0.0, vAtlasUV.y) * step(vAtlasUV.y, 1.0);
      // Clip to fill area so icon doesn't bleed into the border ring.
      iconAlpha = iconSample.a * borderMask * inBounds;
    }
  }

  // Composite: tinted icon over player-colored shape.
  // Classic icons (uIconDarken > 0) tint the glyph with a darkened player
  // color. When the shape itself is already dark, that darkened glyph blends
  // into the shape (and the dark territory behind it) and becomes unreadable —
  // so flip the glyph to the light icon color when the fill is too dark.
  // While the structures effect is animating the fill, the flip becomes a
  // smooth luminance fade so the glyph cross-fades instead of snapping;
  // without the effect this is the classic hard threshold, pixel-identical
  // to having no cosmetic equipped.
  vec3 glyphColor = uIconColor;
  if (uIconDarken > 0.0) {
    float fillLum = dot(fillColor.rgb, vec3(0.299, 0.587, 0.114));
    if (effectActive) {
      float t = smoothstep(0.25, 0.45, fillLum); // 0 = dark fill → light glyph
      glyphColor = mix(uIconColor, darken(fillColor.rgb, uIconDarken), t);
    } else {
      glyphColor =
        fillLum < 0.25 ? uIconColor : darken(fillColor.rgb, uIconDarken);
    }
  }
  vec3 finalRGB = mix(bgColor.rgb, glyphColor, iconAlpha);

  // Red X overlay for units marked for deletion
  if (vMarkedForDeletion > 0.5) {
    float lineW = max(0.025, fw * 1.5);
    float d1 = abs(vLocalPos.x - vLocalPos.y) * 0.7071; // dist to y=x diagonal
    float d2 = abs(vLocalPos.x + vLocalPos.y) * 0.7071; // dist to y=-x diagonal
    float dMin = min(d1, d2);
    // Extend arms close to the circle edge
    float maskR = max(radius * 1.55, fw * 6.0);
    float mask = 1.0 - smoothstep(maskR - fw, maskR, dist);
    float xLine = (1.0 - smoothstep(lineW - fw, lineW + fw, dMin)) * mask;
    finalRGB = mix(finalRGB, vec3(1.0, 0.25, 0.25), xLine * 0.95);
  }

  // Ghost tint — blend entire surface toward uOutlineColor when non-zero
  float tintActive = step(0.01, dot(uOutlineColor, uOutlineColor));
  finalRGB = mix(finalRGB, uOutlineColor, tintActive * 0.5);

  float finalAlpha = bgColor.a * outerAlpha * uGhostAlpha * uIconAlpha;

  // Build-button hover highlight: white outline on matching types, dim the rest
  if (uHighlightMask != 0) {
    int bit = 1 << int(vAtlasIdx + 0.5);
    if ((uHighlightMask & bit) != 0) {
      // White outline band outside the shape edge (matches game's OutlineFilter)
      float shapeEdge = 1.0 - smoothstep(-fw, fw, sdf);           // 1 inside shape, 0 outside
      float expandedEdge = 1.0 - smoothstep(-fw, fw, sdf - highlightOutlineW); // includes outline band
      float outlineBand = expandedEdge - shapeEdge;                // 1 in outline region only
      finalRGB = mix(finalRGB, vec3(1.0), outlineBand);
      finalAlpha = max(finalAlpha, outlineBand);
    } else {
      finalAlpha *= uHighlightDimAlpha;
    }
  }

  fragColor = vec4(finalRGB, finalAlpha);
}

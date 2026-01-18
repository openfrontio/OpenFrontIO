struct Uniforms {
  mapResolution_viewScale_time: vec4f, // x=mapW, y=mapH, z=viewScale, w=timeSec
  viewOffset_alt_highlight: vec4f,     // x=offX, y=offY, z=alternativeView, w=highlightOwnerId
  viewSize_pad: vec4f,                // x=viewW, y=viewH, z=myPlayerSmallId, w unused
  shaderParams0: vec4f,               // x=thicknessPx, y=borderStrength, z=glowStrength, w=glowRadiusMul
  shaderParams1: vec4f,               // x=flags, y=relationTintStrength, z=defendedPatternStrength, w=defendedThreshold
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var stateTex: texture_2d<u32>;
@group(0) @binding(2) var defendedStrengthTex: texture_2d<f32>;
@group(0) @binding(3) var paletteTex: texture_2d<f32>;
@group(0) @binding(4) var terrainTex: texture_2d<f32>;
@group(0) @binding(5) var ownerIndexTex: texture_2d<u32>;
@group(0) @binding(6) var relationsTex: texture_2d<u32>;

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let p = pos[vi];
  return vec4f(p, 0.0, 1.0);
}

fn hasFlag(flags: u32, bit: u32) -> bool {
  return (flags & (1u << bit)) != 0u;
}

fn relationCode(ownerA: u32, ownerB: u32) -> u32 {
  if (ownerA == 0u || ownerB == 0u) {
    return 0u;
  }
  let aDense = textureLoad(ownerIndexTex, vec2i(i32(ownerA), 0), 0).x;
  let bDense = textureLoad(ownerIndexTex, vec2i(i32(ownerB), 0), 0).x;
  if (aDense == 0u || bDense == 0u) {
    return 0u;
  }
  return textureLoad(relationsTex, vec2i(i32(aDense), i32(bDense)), 0).x;
}

fn applyDefendedPattern(
  baseRgb: vec3f,
  strength: f32,
  texCoord: vec2i,
) -> vec3f {
  let parity = (u32(texCoord.x) ^ u32(texCoord.y)) & 1u;
  let factor = select(0.75, 1.25, parity == 1u);
  let patterned = clamp(baseRgb * factor, vec3f(0.0), vec3f(1.0));
  return mix(baseRgb, patterned, clamp(strength, 0.0, 1.0));
}

@fragment
fn fsMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let mapRes = u.mapResolution_viewScale_time.xy;
  let viewScale = u.mapResolution_viewScale_time.z;
  let timeSec = u.mapResolution_viewScale_time.w;
  let viewOffset = u.viewOffset_alt_highlight.xy;
  let altView = u.viewOffset_alt_highlight.z;
  let highlightId = u.viewOffset_alt_highlight.w;
  let myPlayerSmallId = u.viewSize_pad.z;

  let thicknessPx = u.shaderParams0.x;
  let borderStrength = u.shaderParams0.y;
  let glowStrength = u.shaderParams0.z;
  let glowRadiusMul = u.shaderParams0.w;

  let flags = u32(max(0.0, u.shaderParams1.x) + 0.5);
  let relationTintStrength = u.shaderParams1.y;
  let defendedPatternStrength = u.shaderParams1.z;
  let defendedThreshold = u.shaderParams1.w;

  let enableRelations = hasFlag(flags, 0u);
  let enableDefendedPattern = hasFlag(flags, 1u);
  let enableSplit = hasFlag(flags, 2u);
  let drawDefendedRadius = hasFlag(flags, 3u);
  let disableDefendedTint = hasFlag(flags, 4u);

  // WebGPU fragment position is top-left origin and at pixel centers (0.5, 1.5, ...).
  let viewCoord = vec2f(pos.x - 0.5, pos.y - 0.5);
  let mapHalf = mapRes * 0.5;
  let mapCoord = (viewCoord - mapHalf) / viewScale + viewOffset + mapHalf;

  if (
    mapCoord.x < 0.0 ||
    mapCoord.y < 0.0 ||
    mapCoord.x >= mapRes.x ||
    mapCoord.y >= mapRes.y
  ) {
    discard;
  }

  let texCoord = vec2i(mapCoord);
  let state = textureLoad(stateTex, texCoord, 0).x;
  let owner = state & 0xFFFu;
  let hasFallout = (state & 0x2000u) != 0u;

  let terrain = textureLoad(terrainTex, texCoord, 0);
  let defendedStrength = textureLoad(defendedStrengthTex, texCoord, 0).x;

  var outColor = terrain;
  if (owner != 0u) {
    // Player colors start at index 10
    let c = textureLoad(paletteTex, vec2i(i32(owner) + 10, 0), 0);
    var territoryRgb = c.rgb;
    if (!disableDefendedTint) {
      let defendedTint = select(
        0.0,
        clamp(0.8 * defendedStrength, 0.1, 0.35),
        defendedStrength > 0.001,
      );
      territoryRgb = mix(
        territoryRgb,
        vec3f(1.0, 0.0, 1.0),
        defendedTint,
      );
    }
    if (hasFallout) {
      // Fallout color is at index 0
      let falloutColor = textureLoad(paletteTex, vec2i(0, 0), 0).rgb;
      territoryRgb = mix(territoryRgb, falloutColor, 0.5);
    }
    outColor = vec4f(mix(terrain.rgb, territoryRgb, 0.65), 1.0);
  } else if (hasFallout) {
    let falloutColor = textureLoad(paletteTex, vec2i(0, 0), 0).rgb;
    outColor = vec4f(mix(terrain.rgb, falloutColor, 0.5), 1.0);
  }

  // In alt view we show only borders on top of terrain.
  if (altView > 0.5) {
    outColor = terrain;
  }

  if (owner != 0u) {
    let fx = fract(mapCoord.x);
    let fy = fract(mapCoord.y);

    var bestDist = 1e9;
    var otherOwner = 0u;
    var otherCoord = texCoord;

    // Only border against other non-zero owners.
    if (texCoord.x > 0) {
      let o = textureLoad(stateTex, texCoord + vec2i(-1, 0), 0).x & 0xFFFu;
      if (o != 0u && o != owner) {
        let d = fx;
        if (d < bestDist) {
          bestDist = d;
          otherOwner = o;
          otherCoord = texCoord + vec2i(-1, 0);
        }
      }
    }
    if (texCoord.x + 1 < i32(mapRes.x)) {
      let o = textureLoad(stateTex, texCoord + vec2i(1, 0), 0).x & 0xFFFu;
      if (o != 0u && o != owner) {
        let d = 1.0 - fx;
        if (d < bestDist) {
          bestDist = d;
          otherOwner = o;
          otherCoord = texCoord + vec2i(1, 0);
        }
      }
    }
    if (texCoord.y > 0) {
      let o = textureLoad(stateTex, texCoord + vec2i(0, -1), 0).x & 0xFFFu;
      if (o != 0u && o != owner) {
        let d = fy;
        if (d < bestDist) {
          bestDist = d;
          otherOwner = o;
          otherCoord = texCoord + vec2i(0, -1);
        }
      }
    }
    if (texCoord.y + 1 < i32(mapRes.y)) {
      let o = textureLoad(stateTex, texCoord + vec2i(0, 1), 0).x & 0xFFFu;
      if (o != 0u && o != owner) {
        let d = 1.0 - fy;
        if (d < bestDist) {
          bestDist = d;
          otherOwner = o;
          otherCoord = texCoord + vec2i(0, 1);
        }
      }
    }

    if (otherOwner != 0u) {
      let pxPerTile = max(viewScale, 0.001);
      let aaTiles = 1.0 / pxPerTile;
      let thicknessTiles = max(0.1, thicknessPx) / pxPerTile;

      let line = 1.0 - smoothstep(thicknessTiles, thicknessTiles + aaTiles, bestDist);
      let glowTiles = (max(0.1, thicknessPx) * max(0.1, glowRadiusMul)) / pxPerTile;
      let glow = 1.0 - smoothstep(glowTiles, glowTiles + aaTiles * 3.0, bestDist);

      var baseBorderRgb = textureLoad(paletteTex, vec2i(i32(owner) + 10, 1), 0).rgb;

      if (!enableSplit) {
        let otherBorderRgb = textureLoad(paletteTex, vec2i(i32(otherOwner) + 10, 1), 0).rgb;
        baseBorderRgb = 0.5 * (baseBorderRgb + otherBorderRgb);
      }

      var edgeDefendedStrength = defendedStrength;
      if (!enableSplit) {
        let otherDef = textureLoad(defendedStrengthTex, otherCoord, 0).x;
        edgeDefendedStrength = max(edgeDefendedStrength, otherDef);
      }

      // Determine relation color (normal: between owners, altView: relation to viewer).
      var rel = 0u;
      if (enableRelations) {
        if (altView > 0.5) {
          rel = relationCode(owner, u32(max(0.0, myPlayerSmallId) + 0.5));
        } else {
          rel = relationCode(owner, otherOwner);
        }
      }

      var borderRgb = baseBorderRgb;
      if (rel != 0u) {
        let tintTarget = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), rel == 2u);
        let tint = clamp(0.35 * relationTintStrength, 0.0, 1.0);
        borderRgb = mix(borderRgb, tintTarget, tint);
      }

      if (enableDefendedPattern && edgeDefendedStrength >= defendedThreshold) {
        borderRgb = applyDefendedPattern(borderRgb, defendedPatternStrength, texCoord);
      }

      outColor = vec4f(
        mix(outColor.rgb, borderRgb, clamp(line * borderStrength, 0.0, 1.0)),
        outColor.a,
      );
      outColor = vec4f(
        mix(outColor.rgb, borderRgb, clamp(glow * glowStrength, 0.0, 1.0)),
        outColor.a,
      );
    }
  }

  if (drawDefendedRadius && defendedStrength > 0.001 && owner != 0u) {
    let fx = fract(mapCoord.x);
    let fy = fract(mapCoord.y);

    var dist = 1e9;

    if (texCoord.x > 0) {
      let s = textureLoad(defendedStrengthTex, texCoord + vec2i(-1, 0), 0).x;
      if (s <= 0.001) {
        dist = min(dist, fx);
      }
    }
    if (texCoord.x + 1 < i32(mapRes.x)) {
      let s = textureLoad(defendedStrengthTex, texCoord + vec2i(1, 0), 0).x;
      if (s <= 0.001) {
        dist = min(dist, 1.0 - fx);
      }
    }
    if (texCoord.y > 0) {
      let s = textureLoad(defendedStrengthTex, texCoord + vec2i(0, -1), 0).x;
      if (s <= 0.001) {
        dist = min(dist, fy);
      }
    }
    if (texCoord.y + 1 < i32(mapRes.y)) {
      let s = textureLoad(defendedStrengthTex, texCoord + vec2i(0, 1), 0).x;
      if (s <= 0.001) {
        dist = min(dist, 1.0 - fy);
      }
    }

    if (dist < 1e8) {
      let pxPerTile = max(viewScale, 0.001);
      let aaTiles = 1.0 / pxPerTile;
      let thicknessTiles = 1.5 / pxPerTile;
      let line = 1.0 - smoothstep(thicknessTiles, thicknessTiles + aaTiles, dist);

      let baseBorderRgb = textureLoad(paletteTex, vec2i(i32(owner) + 10, 1), 0).rgb;
      let ringRgb = mix(baseBorderRgb, vec3f(1.0, 1.0, 1.0), 0.5);
      outColor = vec4f(
        mix(outColor.rgb, ringRgb, clamp(line * 0.65, 0.0, 1.0)),
        outColor.a,
      );
    }
  }

  // Apply hover highlight if needed
  if (highlightId > 0.5) {
    let alpha = select(0.65, 0.0, altView > 0.5);

    if (alpha > 0.0 && owner != 0u && abs(f32(owner) - highlightId) < 0.5) {
      let pulse = 0.5 + 0.5 * sin(timeSec * 6.2831853);
      let strength = 0.15 + 0.15 * pulse;
      let highlightedRgb = mix(outColor.rgb, vec3f(1.0, 1.0, 1.0), strength);
      outColor = vec4f(highlightedRgb, outColor.a);
    }
  }

  return outColor;
}

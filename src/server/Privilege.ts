import { fetchUrl } from "../client/CosmeticPackLoader";
import { Cosmetics } from "../core/CosmeticSchemas";
import { decodePatternData } from "../core/PatternDecoder";
import {
  PlayerColor,
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerPack,
  PlayerPattern,
} from "../core/Schemas";

type CosmeticResult =
  | { type: "allowed"; cosmetics: PlayerCosmetics }
  | { type: "forbidden"; reason: string };

export interface PrivilegeChecker {
  isAllowed(flares: string[], refs: PlayerCosmeticRefs): CosmeticResult;
}

export class PrivilegeCheckerImpl implements PrivilegeChecker {
  constructor(
    private cosmetics: Cosmetics,
    private b64urlDecode: (base64: string) => Uint8Array,
  ) {}

  isAllowed(flares: string[], refs: PlayerCosmeticRefs): CosmeticResult {
    const cosmetics: PlayerCosmetics = {};
    if (refs.patternName) {
      try {
        cosmetics.pattern = this.isPatternAllowed(
          flares,
          refs.patternName,
          refs.patternColorPaletteName ?? null,
        );
      } catch (e) {
        return { type: "forbidden", reason: "invalid pattern: " + e.message };
      }
    }
    if (refs.color) {
      try {
        cosmetics.color = this.isColorAllowed(flares, refs.color);
      } catch (e) {
        return { type: "forbidden", reason: "invalid color: " + e.message };
      }
    }
    if (refs.flag) {
      cosmetics.flag = cosmetics.flag = refs.flag.replace(
        /[^a-z0-9-_ ()]/gi,
        "",
      );
    }

    const pack = {
      structurePort: refs?.structurePort,
      structureCity: refs?.structureCity,
      structureFactory: refs?.structureFactory,
      structureMissilesilo: refs?.structureMissilesilo,
      structureDefensepost: refs?.structureDefensepost,
      structureSamlauncher: refs?.structureSamlauncher,
      spriteTransportship: refs?.spriteTransportship,
      spriteWarship: refs?.spriteWarship,
      spriteSammissile: refs?.spriteSammissile,
      spriteAtombomb: refs?.spriteAtombomb,
      spriteHydrogenbomb: refs?.spriteHydrogenbomb,
      spriteTradeship: refs?.spriteTradeship,
      spriteMirv: refs?.spriteMirv,
      spriteEngine: refs?.spriteEngine,
      spriteCarriage: refs?.spriteCarriage,
      spriteLoadedcarriage: refs?.spriteLoadedcarriage,
    };

    if (Object.values(pack).some((v) => v !== undefined)) {
      try {
        cosmetics.pack = this.isPackAllowed(flares, pack);
      } catch (e) {
        return { type: "forbidden", reason: "invalid pack: " + e.message };
      }
    }

    return { type: "allowed", cosmetics };
  }

  isPatternAllowed(
    flares: readonly string[],
    name: string,
    colorPaletteName: string | null,
  ): PlayerPattern {
    // Look for the pattern in the cosmetics.json config
    const found = this.cosmetics.patterns[name];
    if (!found) throw new Error(`Pattern ${name} not found`);

    try {
      decodePatternData(found.pattern, this.b64urlDecode);
    } catch (e) {
      throw new Error(`Invalid pattern ${name}`);
    }

    const colorPalette = this.cosmetics.colorPalettes?.[colorPaletteName ?? ""];

    if (flares.includes("pattern:*")) {
      return {
        name: found.name,
        patternData: found.pattern,
        colorPalette,
      } satisfies PlayerPattern;
    }

    const flareName =
      `pattern:${found.name}` +
      (colorPaletteName ? `:${colorPaletteName}` : "");

    if (flares.includes(flareName)) {
      // Player has a flare for this pattern
      return {
        name: found.name,
        patternData: found.pattern,
        colorPalette,
      } satisfies PlayerPattern;
    } else {
      throw new Error(`No flares for pattern ${name}`);
    }
  }

  isColorAllowed(flares: string[], color: string): PlayerColor {
    const allowedColors = flares
      .filter((flare) => flare.startsWith("color:"))
      .map((flare) => "#" + flare.split(":")[1]);
    if (!allowedColors.includes(color)) {
      throw new Error(`Color ${color} not allowed`);
    }
    return { color };
  }

  isPackAllowed(flares: string[], pack: PlayerPack): PlayerPack {
    // TODO: add pack privilege checking
    return {
      structurePort: fetchUrl(pack.structurePort, "structurePort"),
      structureCity: fetchUrl(pack.structureCity, "structureCity"),
      structureFactory: fetchUrl(pack.structureFactory, "structureFactory"),
      structureMissilesilo: fetchUrl(
        pack.structureMissilesilo,
        "structureMissilesilo",
      ),
      structureDefensepost: fetchUrl(
        pack.structureDefensepost,
        "structureDefensepost",
      ),
      structureSamlauncher: fetchUrl(
        pack.structureSamlauncher,
        "structureSamlauncher",
      ),
      spriteTransportship: fetchUrl(
        pack.spriteTransportship,
        "spriteTransportship",
      ),
      spriteWarship: fetchUrl(pack.spriteWarship, "spriteWarship"),
      spriteSammissile: fetchUrl(pack.spriteSammissile, "spriteSammissile"),
      spriteAtombomb: fetchUrl(pack.spriteAtombomb, "spriteAtombomb"),
      spriteHydrogenbomb: fetchUrl(
        pack.spriteHydrogenbomb,
        "spriteHydrogenbomb",
      ),
      spriteTradeship: fetchUrl(pack.spriteTradeship, "spriteTradeship"),
      spriteMirv: fetchUrl(pack.spriteMirv, "spriteMirv"),
      spriteEngine: fetchUrl(pack.spriteEngine, "spriteEngine"),
      spriteCarriage: fetchUrl(pack.spriteCarriage, "spriteCarriage"),
      spriteLoadedcarriage: fetchUrl(
        pack.spriteLoadedcarriage,
        "spriteLoadedcarriage",
      ),
    };
  }
}

export class FailOpenPrivilegeChecker implements PrivilegeChecker {
  isAllowed(flares: string[], refs: PlayerCosmeticRefs): CosmeticResult {
    return { type: "allowed", cosmetics: {} };
  }
}

import { colord, Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import Color from "colorjs.io";
import { ColoredTeams, Team } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import {
  blueTeamColors,
  botTeamColors,
  greenTeamColors,
  orangeTeamColors,
  purpleTeamColors,
  redTeamColors,
  tealTeamColors,
  yellowTeamColors,
} from "./Colors";
extend([lchPlugin]);
extend([labPlugin]);

export class ColorAllocator {
  private availableColors: Colord[];
  private fallbackColors: Colord[];
  private assigned = new Map<string, Colord>();
  private teamPlayerColors = new Map<string, Colord>();

  constructor(colors: Colord[], fallback: Colord[]) {
    this.availableColors = [...colors];
    this.fallbackColors = [...colors, ...fallback];
  }

  private getTeamColorVariations(team: Team): Colord[] {
    switch (team) {
      case ColoredTeams.Blue:
        return blueTeamColors;
      case ColoredTeams.Red:
        return redTeamColors;
      case ColoredTeams.Teal:
        return tealTeamColors;
      case ColoredTeams.Purple:
        return purpleTeamColors;
      case ColoredTeams.Yellow:
        return yellowTeamColors;
      case ColoredTeams.Orange:
        return orangeTeamColors;
      case ColoredTeams.Green:
        return greenTeamColors;
      case ColoredTeams.Bot:
        return botTeamColors;
      case ColoredTeams.Humans:
        return blueTeamColors;
      case ColoredTeams.Nations:
        return redTeamColors;
      default:
        return [this.assignColor(team)];
    }
  }

  assignColor(id: string): Colord {
    if (this.assigned.has(id)) {
      return this.assigned.get(id)!;
    }

    if (this.availableColors.length === 0) {
      this.availableColors = [...this.fallbackColors];
    }

    let selectedIndex = 0;

    if (this.assigned.size === 0 || this.assigned.size > 50) {
      // Randomly pick the first color if no colors have been assigned yet.
      //
      // Or if more than 50 colors assigned just pick a random one for perf reasons,
      // as selecting a distinct color is O(n^2), and the color palette is mostly exhausted anyways.
      const rand = new PseudoRandom(simpleHash(id));
      selectedIndex = rand.nextInt(0, this.availableColors.length);
    } else {
      const assignedColors = Array.from(this.assigned.values());
      selectedIndex =
        selectDistinctColorIndex(this.availableColors, assignedColors) ?? 0;
    }

    const color = this.availableColors.splice(selectedIndex, 1)[0];
    this.assigned.set(id, color);
    return color;
  }

  assignTeamColor(team: Team): Colord {
    const teamColors = this.getTeamColorVariations(team);
    const rgb = teamColors[0].toRgb();
    rgb.r = Math.round(rgb.r);
    rgb.g = Math.round(rgb.g);
    rgb.b = Math.round(rgb.b);
    return colord(rgb);
  }

  assignTeamPlayerColor(team: Team, playerId: string): Colord {
    if (this.teamPlayerColors.has(playerId)) {
      return this.teamPlayerColors.get(playerId)!;
    }

    const teamColors = this.getTeamColorVariations(team);
    const hashValue = simpleHash(playerId);
    const colorIndex = hashValue % teamColors.length;
    const color = teamColors[colorIndex];

    this.teamPlayerColors.set(playerId, color);

    return color;
  }
}

// Select a distinct color index from the available colors that
// is most different from the assigned colors
export function selectDistinctColorIndex(
  availableColors: Colord[],
  assignedColors: Colord[],
): number | null {
  if (assignedColors.length === 0) {
    throw new Error("No assigned colors");
  }

  const assignedLabColors = assignedColors.map(toColor);

  let maxDeltaE = 0;
  let maxIndex = 0;

  for (let i = 0; i < availableColors.length; i++) {
    const color = availableColors[i];
    const deltaE = minDeltaE(toColor(color), assignedLabColors);
    if (deltaE > maxDeltaE) {
      maxDeltaE = deltaE;
      maxIndex = i;
    }
  }
  return maxIndex;
}

function minDeltaE(lab1: Color, assignedLabColors: Color[]) {
  return assignedLabColors.reduce((min, assigned) => {
    return Math.min(min, deltaE2000(lab1, assigned));
  }, Infinity);
}

function deltaE2000(c1: Color, c2: Color): number {
  return c1.deltaE(c2, "2000");
}

function toColor(colord: Colord): Color {
  const lab = colord.toLab();
  return new Color("lab", [lab.l, lab.a, lab.b]);
}

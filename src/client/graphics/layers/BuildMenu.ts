import {
  BuildableUnit,
  Gold,
  PlayerActions,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import warshipIcon from "/images/BattleshipIconWhite.svg?url";
import cityIcon from "/images/CityIconWhite.svg?url";
import factoryIcon from "/images/FactoryIconWhite.svg?url";
import mirvIcon from "/images/MIRVIcon.svg?url";
import missileSiloIcon from "/images/MissileSiloIconWhite.svg?url";
import hydrogenBombIcon from "/images/MushroomCloudIconWhite.svg?url";
import atomBombIcon from "/images/NukeIconWhite.svg?url";
import portIcon from "/images/PortIcon.svg?url";
import samlauncherIcon from "/images/SamLauncherIconWhite.svg?url";
import shieldIcon from "/images/ShieldIconWhite.svg?url";

export interface BuildItemDisplay {
  unitType: UnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

/**
 * Interface for the build menu, used by MainRadialMenu and RadialMenuElements.
 * Implemented by DioxusBuildMenu.
 */
export interface IBuildMenu {
  playerActions: PlayerActions | null;
  readonly isVisible: boolean;
  canBuildOrUpgrade(item: BuildItemDisplay): boolean;
  cost(item: BuildItemDisplay): Gold;
  count(item: BuildItemDisplay): string;
  sendBuildOrUpgrade(buildableUnit: BuildableUnit, tile: TileRef): void;
  hideMenu(): void;
}

export const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      key: "unit_type.warship",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
    // needs new icon
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "build_menu.desc.city",
      key: "unit_type.city",
      countable: true,
    },
    {
      unitType: UnitType.Factory,
      icon: factoryIcon,
      description: "build_menu.desc.factory",
      key: "unit_type.factory",
      countable: true,
    },
  ],
];

export const flattenedBuildTable = buildTable.flat();

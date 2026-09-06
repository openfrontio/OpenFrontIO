import { assetUrl } from "../../core/AssetUrls";
import { ResearchType } from "../../core/game/Research";

export const researchIcons: Record<ResearchType, string> = {
  [ResearchType.PopulationDensity]: assetUrl(
    "images/ResearchPopulationDensity.svg",
  ),
  [ResearchType.PopulationGrowth]: assetUrl(
    "images/ResearchPopulationGrowth.svg",
  ),
  [ResearchType.Economy]: assetUrl("images/ResearchEconomy.svg"),
  [ResearchType.Military]: assetUrl("images/ResearchMilitary.svg"),
  [ResearchType.Scientific]: assetUrl("images/ResearchScientific.svg"),
};

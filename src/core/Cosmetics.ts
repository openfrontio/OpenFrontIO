import rawTerritoryPatterns from "../../resources/cosmetics/cosmetics.json" with { type: "json" };
import { CosmeticsSchema } from "./CosmeticSchemas";

export const territoryPatterns = CosmeticsSchema.parse(rawTerritoryPatterns);

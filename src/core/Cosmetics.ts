import rawTerritoryPatterns from "../../resources/cosmetic/cosmetic.json" with { type: "json" };
import { CosmeticsSchema } from "./CosmeticSchemas";

export const territoryPatterns = CosmeticsSchema.parse(rawTerritoryPatterns);
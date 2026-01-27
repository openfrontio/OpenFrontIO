import { GameMapType } from "./Game";

export const publicLobbyMapWeights: Partial<Record<GameMapType, number>> = {
  [GameMapType.Africa]: 7,
  [GameMapType.Asia]: 6,
  [GameMapType.Australia]: 4,
  [GameMapType.Achiran]: 5,
  [GameMapType.Baikal]: 5,
  [GameMapType.BetweenTwoSeas]: 5,
  [GameMapType.BlackSea]: 6,
  [GameMapType.Britannia]: 5,
  [GameMapType.BritanniaClassic]: 4,
  [GameMapType.DeglaciatedAntarctica]: 4,
  [GameMapType.EastAsia]: 5,
  [GameMapType.Europe]: 3,
  [GameMapType.EuropeClassic]: 3,
  [GameMapType.FalklandIslands]: 4,
  [GameMapType.FaroeIslands]: 4,
  [GameMapType.FourIslands]: 4,
  [GameMapType.GatewayToTheAtlantic]: 5,
  [GameMapType.GulfOfStLawrence]: 4,
  [GameMapType.Halkidiki]: 4,
  [GameMapType.Iceland]: 4,
  [GameMapType.Italia]: 6,
  [GameMapType.Japan]: 6,
  [GameMapType.Lisbon]: 4,
  [GameMapType.Manicouagan]: 4,
  [GameMapType.Mars]: 3,
  [GameMapType.Mena]: 6,
  [GameMapType.Montreal]: 6,
  [GameMapType.NewYorkCity]: 3,
  [GameMapType.NorthAmerica]: 5,
  [GameMapType.Pangaea]: 5,
  [GameMapType.Pluto]: 6,
  [GameMapType.SouthAmerica]: 5,
  [GameMapType.StraitOfGibraltar]: 5,
  [GameMapType.Svalmel]: 8,
  [GameMapType.World]: 8,
  [GameMapType.Lemnos]: 3,
  [GameMapType.TwoLakes]: 6,
  [GameMapType.StraitOfHormuz]: 4,
  [GameMapType.Surrounded]: 4,
  [GameMapType.DidierFrance]: 1,
  [GameMapType.AmazonRiver]: 3,
  [GameMapType.Sierpinski]: 10,
};

export const publicLobbyMaps: GameMapType[] = Object.keys(publicLobbyMapWeights)
  .filter((map) => (publicLobbyMapWeights[map as GameMapType] ?? 0) > 0)
  .map((map) => map as GameMapType);

export const getPublicLobbyMapWeight = (map: GameMapType): number =>
  publicLobbyMapWeights[map] ?? 0;

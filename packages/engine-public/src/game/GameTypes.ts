// Pure enum/const declarations shared between the engine and clients.
// Extracted from engine/game/Game.ts so the public schema layer
// (engine-public) can reference them without importing engine.

export const AllPlayers = "AllPlayers" as const;

export const Duos = "Duos" as const;
export const Trios = "Trios" as const;
export const Quads = "Quads" as const;
export const HumansVsNations = "Humans Vs Nations" as const;

export enum Difficulty {
  Easy = "Easy",
  Medium = "Medium",
  Hard = "Hard",
  Impossible = "Impossible",
}

export enum GameType {
  Singleplayer = "Singleplayer",
  Public = "Public",
  Private = "Private",
}

export enum GameMode {
  FFA = "Free For All",
  Team = "Team",
}

export enum RankedType {
  OneVOne = "1v1",
}

export enum GameMapSize {
  Compact = "Compact",
  Normal = "Normal",
}

export enum GameMapType {
  World = "World",
  WorldInverted = "World Inverted",
  GiantWorldMap = "Giant World Map",
  Europe = "Europe",
  EuropeClassic = "Europe Classic",
  Mena = "Mena",
  NorthAmerica = "North America",
  SouthAmerica = "South America",
  Oceania = "Oceania",
  BlackSea = "Black Sea",
  Africa = "Africa",
  Pangaea = "Pangaea",
  Asia = "Asia",
  Mars = "Mars",
  BritanniaClassic = "Britannia Classic",
  Britannia = "Britannia",
  GatewayToTheAtlantic = "Gateway to the Atlantic",
  Australia = "Australia",
  Iceland = "Iceland",
  EastAsia = "East Asia",
  BetweenTwoSeas = "Between Two Seas",
  FaroeIslands = "Faroe Islands",
  DeglaciatedAntarctica = "Deglaciated Antarctica",
  FalklandIslands = "Falkland Islands",
  Baikal = "Baikal",
  Halkidiki = "Halkidiki",
  StraitOfGibraltar = "Strait of Gibraltar",
  Italia = "Italia",
  Japan = "Japan",
  Pluto = "Pluto",
  Montreal = "Montreal",
  NewYorkCity = "New York City",
  Achiran = "Achiran",
  BaikalNukeWars = "Baikal Nuke Wars",
  FourIslands = "Four Islands",
  Svalmel = "Svalmel",
  GulfOfStLawrence = "Gulf of St. Lawrence",
  Lisbon = "Lisbon",
  Manicouagan = "Manicouagan",
  Lemnos = "Lemnos",
  Tourney1 = "Tourney 2 Teams",
  Tourney2 = "Tourney 3 Teams",
  Tourney3 = "Tourney 4 Teams",
  Tourney4 = "Tourney 8 Teams",
  Passage = "Passage",
  Sierpinski = "Sierpinski",
  TheBox = "The Box",
  TwoLakes = "Two Lakes",
  StraitOfHormuz = "Strait of Hormuz",
  Surrounded = "Surrounded",
  Didier = "Didier",
  DidierFrance = "Didier France",
  AmazonRiver = "Amazon River",
  BosphorusStraits = "Bosphorus Straits",
  BeringStrait = "Bering Strait",
  Yenisei = "Yenisei",
  TradersDream = "Traders Dream",
  Hawaii = "Hawaii",
  Alps = "Alps",
  NileDelta = "Nile Delta",
  Arctic = "Arctic",
  SanFrancisco = "San Francisco",
  Aegean = "Aegean",
  MilkyWay = "MilkyWay",
  MareNostrum = "Mare Nostrum",
  Dyslexdria = "Dyslexdria",
  GreatLakes = "Great Lakes",
  StraitOfMalacca = "Strait Of Malacca",
  Luna = "Luna",
  Conakry = "Conakry",
  Caucasus = "Caucasus",
  LosAngeles = "Los Angeles",
  BeringSea = "Bering Sea",
  Antarctica = "Antarctica",
  ArchipelagoSea = "ArchipelagoSea",
  BajaCalifornia = "Baja California",
  MiddleEast = "Middle East",
  TaiwanStrait = "Taiwan Strait",
  IndianSubcontinent = "Indian Subcontinent",
  DanishStraits = "Danish Straits",
  NorthwestPassage = "Northwest Passage",
  Venice = "Venice",
  Korea = "Korea",
  Balkans = "Balkans",
  YellowSea = "Yellow Sea",
  Labyrinth = "Labyrinth",
  Caribbean = "Caribbean",
  Onion = "Onion",
  ChoppingBlock = "Chopping Block",
  SoutheastAsia = "SoutheastAsia",
  MississippiRiver = "Mississippi River",
  HongKong = "Hong Kong",
}

export enum UnitType {
  TransportShip = "Transport",
  Warship = "Warship",
  Shell = "Shell",
  SAMMissile = "SAMMissile",
  Port = "Port",
  AtomBomb = "Atom Bomb",
  HydrogenBomb = "Hydrogen Bomb",
  TradeShip = "Trade Ship",
  MissileSilo = "Missile Silo",
  DefensePost = "Defense Post",
  SAMLauncher = "SAM Launcher",
  City = "City",
  MIRV = "MIRV",
  MIRVWarhead = "MIRV Warhead",
  Train = "Train",
  Factory = "Factory",
}

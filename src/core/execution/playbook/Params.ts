// PlaybookBot parameters. Re-exported from PlaybookBotExecution.ts so callers keep one import.

export interface PlaybookParams {
  expandContested: number; // share of home troops per click into empty land while a rival borders us
  expandFree: number; // same, when nobody can contest
  expandEvery: number; // ticks between clicks
  openingAllIn: boolean; // nation-style opening: every 5 s throw everything above openingKeep of cap into empty land
  openingKeep: number;
  homeFloor: number; // never expand/fight below this share of cap at home
  botRatio: number; // attack bots with this multiple of their troops
  botMaxShare: number; // max share of home troops per bot click
  botEarlyShare: number; // while free land remains, only eat a tribe if the click is at most this share of home troops (and we are plentiful)
  botsAfterWild: boolean; // wait for the wilderness to run out before harvesting tribes
  botClickCap: number; // guide rule: no single tribe click above this share of home; split into follow-up clicks instead
  botFollowUpTicks: number; // ticks between follow-up clicks on the same tribe (they merge into the running attack)
  boatAtTick: number;
  boatShare: number;
  islandMaxTiles: number;
  fightAbove: number; // start fighting rivals when troops exceed this share of cap
  fightRatio: number; // attack size as multiple of the target's whole army
  fightNotBeforeTick: number; // no wars with nations/humans before this tick
  fightMinCities: number; // ... or before this many cities
  fightMaxShare: number; // never commit more than this share of home troops to one target
  retreatBelowRatio: number; // retreat an attack whose troops fall below this × target troops
  capFullShare: number; // buy cap when troops exceed this share of cap
  citiesBeforePort: number;
  portMinPartnerDist: number;
  allianceEvery: number;
  portLevelBeforeSecond: number; // level the first port to this before a second port
  maxPortUnits: number; // beyond this, only port levels
  seaFullShips: number; // map-wide trade ships at which ports stop being bought
  railSpacing: number; // tiles between infill cities on a rail
  siloAtTick: number; // earliest silo
  bombEvery: number; // ticks between bombs
  bombReserve: number; // gold kept after buying a bomb
  reserveShare: number; // share of CURRENT troops kept at home by send()/boat() (nations keep 30–40 %); a share of cap froze the bot whenever troops were low
  tribeConcurrency: number; // tribe attacks at once below 60 % of cap (one more above)
  spawnInland: number; // tiles walked inland from the chosen shore
  spawnBasin: boolean; // phase 0: refine the top spawn candidates by land-connected free land (an isthmus or a pocket between nations scores low)
  retreatOnAllianceEnd: boolean;
  finishRule: boolean; // hold under the nations' victory-denial line while a MIRV-capable rival exists; remove them; then push all-out
  endgameV2: boolean; // 15:00+: hydrogen bombs instead of hoarding, weak allies lapse, short boat jumps at 2×
  splitWatch: boolean; // reconnect a split territory: the owner of the gap becomes the war target
  econWar: boolean; // attack at 1.5× (after a bomb) when our cap is 2× the target's and gold is spare
  wholeWars: boolean; // a war wave is sent whole or not at all (never trimmed by the reserve)
  stickyWar: boolean; // one enemy to the end: the current war target is the only candidate while it lives and borders us
  postsBeforeCity2: boolean; // allow threat posts even while city 2 is unaffordable
  simWars: boolean; // B1: pick war targets and sizes with Estimate.ts (a replay of attackLogic over the shared border) and retreat when the re-estimate no longer wins; off = fightRatio heuristics
  realRetreats: boolean; // schedule a RetreatExecution when retreating (A1 finding: Player.orderRetreat() only flags the wave; without the execution it never comes home, stays in outgoingAttacks() and blocks that target)
  portWithoutPartnerTick: number; // first port on any ocean coast from this tick even with no partner (1e9 = never)
  nearbyEvery: number; // ticks the neighbouring-player set is cached for (1 = recompute every tick, the original behaviour)
  scoredSpend: boolean; // B3: Economy.build() scores every purchase (return over the phase horizon / cost, Spend.ts) and buys the best affordable one after one escrow list; off = the hand-ordered steps
}

export const DEFAULT_PLAYBOOK: PlaybookParams = {
  expandContested: 0.2,
  expandFree: 0.1,
  expandEvery: 10,
  openingAllIn: false, // 30-game lab: 20%/10% clicks each second beat the all-in (24 vs 22 alive, 800k vs 705k tiles)
  openingKeep: 0.15,
  homeFloor: 0.25,
  botRatio: 1.67,
  botMaxShare: 0.5,
  botEarlyShare: 0.15,
  botClickCap: 0.3, // 30-game lab: ties the single click on land, one more survivor; matches the guide's click table
  botFollowUpTicks: 100,
  botsAfterWild: false, // 2026-08-29 Hetzner sweeps, 20-min games: Medium 30-game A/B gate off beats on 14-7-9, median land 65k vs 37k, cities 70 vs 44, same survival; Hard 30-game A/B neutral (7-6-5). Tribes cost 2-3x more by 2:00 while free land never gets cheaper.
  boatAtTick: 50,
  boatShare: 0.2,
  islandMaxTiles: 20000,
  fightAbove: 0.7,
  fightRatio: 2.0, // Medium 30-game sweep hz3: 1.67× = +1 crown but −13% land, 3 fewer top-3, loses paired 13–17; the gate (attack whenever affordable, from 3:00) stays
  fightNotBeforeTick: 1800,
  fightMinCities: 2,
  fightMaxShare: 0.6,
  retreatBelowRatio: 0.4,
  capFullShare: 0.6,
  citiesBeforePort: 1,
  portMinPartnerDist: 300,
  allianceEvery: 300,
  portLevelBeforeSecond: 3,
  maxPortUnits: 8,
  seaFullShips: 400,
  railSpacing: 16,
  siloAtTick: 6000,
  bombEvery: 300,
  bombReserve: 250_000,
  reserveShare: 0.3,
  tribeConcurrency: 1,
  spawnInland: 0, // 30-game lab: 8 tiles inland = 18/30 alive vs 27/30 on the shore (an inland circle can be surrounded; the coast cannot)
  spawnBasin: true,
  retreatOnAllianceEnd: true,
  finishRule: true,
  endgameV2: true,
  splitWatch: true,
  econWar: true,
  wholeWars: true,
  stickyWar: true,
  postsBeforeCity2: true, // 30-game lab: +8% land, same survival as blocking them
  simWars: false, // default off until the 30-game Medium A/B (PlaybookBotPlan.md B1)
  realRetreats: false, // default off until the 30-game A/B; on = frozen waves finally return (see the interface comment)
  portWithoutPartnerTick: 1500,
  nearbyEvery: 1, // lab flag: 10 would save ~20 % of a lab game's CPU (me.nearby() profiled at 28 %) but needs a 30-game A/B first
  scoredSpend: false, // default off until the 30-game Medium A/B (PlaybookBotPlan.md B3)
};

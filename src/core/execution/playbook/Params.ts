// PlaybookBot parameters. Re-exported from PlaybookBotExecution.ts so callers keep one import.
//
// Graduated into the code (C2, no longer parameters): wholeWars (a war wave goes whole or not at all), stickyWar
// (one enemy to the end), splitWatch (reconnect a split territory), econWar (1.5× when our cap is twice theirs and
// gold is spare), postsBeforeCity2 (threat posts never wait for city 2; 30-game lab: +8 % land, same survival),
// retreatOnAllianceEnd (tribe waves come home when a stronger ally lapses), spawnBasin (spawn candidates refined by
// reachable free land). Dropped: openingAllIn/openingKeep (30-game lab: 20 %/10 % clicks beat the all-in, 24 vs 22
// alive, 800k vs 705k tiles) and homeFloor (declared and defaulted but read nowhere — A1 finding).

export interface PlaybookParams {
  expandContested: number; // share of home troops per click into empty land while a rival borders us
  expandFree: number; // same, when nobody can contest
  expandEvery: number; // ticks between clicks
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
  finishRule: boolean; // hold under the nations' victory-denial line while a MIRV-capable rival exists; remove them; then push all-out
  endgameV2: boolean; // 15:00+: hydrogen bombs instead of hoarding, weak allies lapse, short boat jumps at 2×
  simWars: boolean; // B1: pick war targets and sizes with Estimate.ts (a replay of attackLogic over the shared border) and retreat when the re-estimate no longer wins; off = fightRatio heuristics
  realRetreats: boolean; // schedule a RetreatExecution when retreating (A1 finding: Player.orderRetreat() only flags the wave; without the execution it never comes home, stays in outgoingAttacks() and blocks that target)
  portWithoutPartnerTick: number; // first port on any ocean coast from this tick even with no partner (1e9 = never)
  nearbyEvery: number; // ticks the neighbouring-player set is cached for (1 = recompute every tick, the original behaviour)
  scoredSpend: boolean; // B3: Economy.build() scores every purchase (return over the phase horizon / cost, Spend.ts) and buys the best affordable one after one escrow list; off = the hand-ordered steps
  bsrReserve: boolean; // C1: the troop reserve scales with the largest border-security ratio among unfriendly neighbours — reserveShare × clamp(0.5 + 0.5·maxBsr, 0.5, 2.0), so reserveShare is the value at bsr 1; off = flat reserveShare
  trustWars: boolean; // C1: fight() skips a target whose living ally on our border could pile in (nationCanAttack with nationWouldSend ≥ half our spendable) and prefers low-trust targets (+2 × (1 − trust)); off = the plain scorer
  nationAware: boolean; // C1: the expiry hold and the renewal gift use the nation attack rules (Rivals.couldAttackAtExpiry) instead of the 0.85× / 0.9× troop heuristics
  phaseGates: boolean; // C1: the tick literals in the rules (25:00 endgame, 15:00 late game, 5:00 wars/silos, 2:30–3:00 rail) read sit.phase instead; Spend.horizon comes from the phase
}

export const DEFAULT_PLAYBOOK: PlaybookParams = {
  expandContested: 0.2,
  expandFree: 0.1,
  expandEvery: 10,
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
  finishRule: true,
  endgameV2: true,
  simWars: false, // default off until the 30-game Medium A/B (PlaybookBotPlan.md B1)
  realRetreats: true, // graduated 2026-08-29: 30-game Medium A/B 18W-11L vs off, 30/30 alive, 5 crowns (2), +70 % land (3.53M vs 2.08M tiles); on = frozen waves finally return (see the interface comment)
  portWithoutPartnerTick: 1500,
  nearbyEvery: 10, // 90-game Medium 20-min A/B (openfront-00, 2026-08-29): 5 and 10 are a wash vs 1 (14W/15L, 14W/16L; alive 29/29/30) while bot CPU per game drops 19.0 s → 5.3 s. Details: PlaybookBotLab.md "Where a game's time goes".
  scoredSpend: false, // default off until the 30-game Medium A/B (PlaybookBotPlan.md B3)
  bsrReserve: false, // default off until the 30-game Medium A/B (PlaybookBotPlan.md C1)
  trustWars: true, // graduated 2026-08-29 with nationAware: 30-game Medium A/B on the realRetreats base 11W-8L (11 identical), 8 crowns vs 5, 21 top-3 vs 17, +19 % land
  nationAware: true, // graduated 2026-08-29 with trustWars (see above); alone 9W-6L, 15 identical
  phaseGates: false, // default off until the 30-game Medium A/B (PlaybookBotPlan.md C1)
};

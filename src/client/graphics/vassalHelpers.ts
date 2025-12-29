import { Config } from "../../core/configuration/Config";
import { MenuElementParams } from "./layers/RadialMenuElements";
import { PlayerType } from "../../core/game/Game";

// Unified helper to check if vassal features are enabled, tolerating either
// a Config instance or any object that exposes config(): Config.
export function vassalsEnabledFrom(source: { config?: () => Config } | Config | null | undefined): boolean {
  const cfg = (source as any)?.config ? (source as any).config() : source;
  if (cfg && typeof (cfg as any).vassalsEnabled === "function") {
    return (cfg as any).vassalsEnabled();
  }
  // default legacy behaviour: enabled
  return true;
}

// Simple helper for UI sliders.
export function shouldShowVassalSlider(
  source: { config?: () => Config } | Config | null | undefined,
): boolean {
  return vassalsEnabledFrom(source);
}

// Decide whether surrender/offer-vassal options should be shown for the current menu params.
export function vassalMenuVisibility(params: MenuElementParams): { showSurrender: boolean; showOffer: boolean } {
  if (!vassalsEnabledFrom(params.game)) {
    return { showSurrender: false, showOffer: false };
  }
  const target = params.selected;
  const isPlayer =
    !!target && typeof (target as any).isPlayer === "function"
      ? (target as any).isPlayer()
      : false;

  const canSurrender = params.playerActions?.interaction?.canSurrender ?? false;
  const canForce = params.playerActions?.interaction?.canOfferVassal ?? false;

  if (!isPlayer || !target) {
    return { showSurrender: false, showOffer: false };
  }

  // Surrender visibility
  let showSurrender = canSurrender;
  if (showSurrender) {
    if (target.id() === params.myPlayer.id()) showSurrender = false;
    if (params.myPlayer.overlord?.()) showSurrender = false;
    if (params.myPlayer.overlord && params.myPlayer.overlord() === target) showSurrender = false;
    if (target.overlord && target.overlord() === params.myPlayer) showSurrender = false;
    if (target.type && target.type() === PlayerType.Bot) showSurrender = false;
  }

  // Offer visibility
  let showOffer = canForce;
  if (showOffer) {
    if (target.id() === params.myPlayer.id()) showOffer = false;
    if (target.overlord && target.overlord()) showOffer = false;
    if (target.type && target.type() === PlayerType.Bot) showOffer = false;
    const permanentAllied =
      params.myPlayer.sharesHierarchy?.(target as any) ||
      params.myPlayer.isOnSameTeam?.(target as any);
    if (permanentAllied) showOffer = false;
  }

  return { showSurrender, showOffer };
}

// Compute effective tiles for leaderboard with vassal toggle respected.
export function effectiveTilesFromVassals(player: {
  numTilesOwned: () => number;
  overlord: () => any;
  vassals: () => any[];
  config?: () => Config;
}): number {
  const enabled = vassalsEnabledFrom(player);
  if (enabled && player.overlord() === null) {
    const sumHierarchy = (p: any): number =>
      p.numTilesOwned() +
      (p.vassals() || []).reduce((acc: number, v: any) => acc + sumHierarchy(v), 0);
    return sumHierarchy(player);
  }
  return player.numTilesOwned();
}

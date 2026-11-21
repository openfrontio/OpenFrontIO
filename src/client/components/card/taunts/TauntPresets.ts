// Taunts: a staff-made flourish on the player card. It plays once each time
// the card is shown, never loops, has no sound and no gameplay effect.
//
//   icon  a ~24px icon beside the name animates for 1–2 s, then rests
//   card  the whole strip animates for up to 1.5 s, then settles
//
// Only `transform` and `opacity` animate, so the animation runs on the
// compositor and never stutters the modal's backdrop blur. Under reduced
// motion an icon shows its resting frame and a card animation doesn't play;
// with taunts muted neither plays.

export interface TauntPreset {
  kind: "icon" | "card";
  durationMs: number;
  // The class that runs the animation (on the icon, or on the strip's
  // overlay for card kinds).
  className: string;
  // The icon at rest (icon kinds); card kinds have none.
  restingFrame: string;
}

const icon = (
  name: string,
  durationMs: number,
  glyph: string,
): TauntPreset => ({
  kind: "icon",
  durationMs,
  className: `taunt-${name}`,
  restingFrame: glyph,
});
const card = (name: string, durationMs: number): TauntPreset => ({
  kind: "card",
  durationMs,
  className: `taunt-${name}`,
  restingFrame: "",
});

// The glyphs stand in until staff art is ready; `flag_plant` shows the
// player's own flag instead.
export const TAUNT_PRESETS: Record<string, TauntPreset> = {
  salute: icon("salute", 1500, "🫡"),
  crown_drop: icon("crown_drop", 1500, "👑"),
  mushroom_cloud: icon("mushroom_cloud", 2000, "☁️"),
  flag_plant: icon("flag_plant", 1800, ""),
  trophy: icon("trophy", 1500, "🏆"),
  nuke_flash: card("nuke_flash", 1200),
  shockwave: card("shockwave", 1200),
  tremor: card("tremor", 600),
  territory_sweep: card("territory_sweep", 1500),
  badge_pulse: card("badge_pulse", 1000),
};

export function tauntPlayback(
  preset: TauntPreset,
  opts: { reducedMotion: boolean; muted: boolean },
): "play" | "rest" | "none" {
  if (opts.muted) return "none";
  if (opts.reducedMotion) return preset.kind === "icon" ? "rest" : "none";
  return "play";
}

// The animations. Each keyframe block may only set transform and opacity
// (a test holds this). Colours and sizes are static styles on the elements.
export const TAUNT_CSS = `
.taunt-salute { animation: taunt-salute 1500ms ease-out 1 both; }
@keyframes taunt-salute {
  0% { transform: translateY(60%) rotate(-30deg); opacity: 0; }
  40% { transform: translateY(0) rotate(8deg); opacity: 1; }
  70% { transform: rotate(-4deg); }
  100% { transform: rotate(0deg); opacity: 1; }
}
.taunt-crown_drop { animation: taunt-crown_drop 1500ms cubic-bezier(.3,1.6,.5,1) 1 both; }
@keyframes taunt-crown_drop {
  0% { transform: translateY(-160%); opacity: 0; }
  45% { transform: translateY(0); opacity: 1; }
  65% { transform: translateY(-25%); }
  100% { transform: translateY(0); opacity: 1; }
}
.taunt-mushroom_cloud { animation: taunt-mushroom_cloud 2000ms ease-out 1 both; }
@keyframes taunt-mushroom_cloud {
  0% { transform: translateY(40%) scale(0.4); opacity: 0; }
  50% { transform: translateY(-10%) scale(1.2); opacity: 1; }
  100% { transform: translateY(0) scale(1); opacity: 0.8; }
}
.taunt-flag_plant { animation: taunt-flag_plant 1800ms ease-out 1 both; transform-origin: bottom left; }
@keyframes taunt-flag_plant {
  0% { transform: translateY(-120%); opacity: 0; }
  30% { transform: translateY(0) rotate(0deg); opacity: 1; }
  50% { transform: rotate(-10deg); }
  65% { transform: rotate(6deg); }
  80% { transform: rotate(-6deg); }
  100% { transform: rotate(0deg); opacity: 1; }
}
.taunt-trophy { animation: taunt-trophy 1500ms ease-out 1 both; }
@keyframes taunt-trophy {
  0% { transform: scale(0.3) rotateY(0deg); opacity: 0; }
  60% { transform: scale(1.15) rotateY(360deg); opacity: 1; }
  100% { transform: scale(1) rotateY(360deg); opacity: 1; }
}
.taunt-nuke_flash { animation: taunt-nuke_flash 1200ms ease-out 1 both; }
@keyframes taunt-nuke_flash {
  0% { transform: translateX(-100%); opacity: 0.9; }
  60% { transform: translateX(100%); opacity: 0.7; }
  100% { transform: translateX(100%); opacity: 0; }
}
.taunt-shockwave { animation: taunt-shockwave 1200ms ease-out 1 both; }
@keyframes taunt-shockwave {
  0% { transform: scale(0.2); opacity: 0.9; }
  100% { transform: scale(6); opacity: 0; }
}
.taunt-tremor { animation: taunt-tremor 600ms linear 1 both; }
@keyframes taunt-tremor {
  0% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
  100% { transform: translateX(0); }
}
.taunt-territory_sweep { animation: taunt-territory_sweep 1500ms ease-in-out 1 both; }
@keyframes taunt-territory_sweep {
  0% { transform: scaleX(0); opacity: 0.8; }
  50% { transform: scaleX(1); opacity: 0.6; }
  100% { transform: scaleX(1); opacity: 0; }
}
.taunt-badge_pulse { animation: taunt-badge_pulse 1000ms ease-out 1 both; }
@keyframes taunt-badge_pulse {
  0% { transform: scale(1); opacity: 0.9; }
  40% { transform: scale(1.25); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}
`;

let injected = false;
export function ensureTauntStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = TAUNT_CSS;
  document.head.appendChild(style);
}

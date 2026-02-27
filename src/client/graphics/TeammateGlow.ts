const TWO_PI = Math.PI * 2;

export type TeammateGlowOptions = {
  outerRadius: number;
  pulsePhase?: number;
};

export function drawTeammateGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  options: TeammateGlowOptions,
): void {
  const outerRadius = Math.max(1, options.outerRadius);
  const phase = options.pulsePhase ?? 0;

  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!Number.isFinite(outerRadius) || outerRadius <= 0) return;

  // Pulse between 0.5 and 1.0 opacity (brighter)
  const pulse = 0.75 + 0.25 * Math.sin(phase);
  const goldAlpha = pulse;
  const whiteAlpha = 1 - pulse;

  ctx.save();
  ctx.translate(x, y);

  // White background layer (visible when gold fades)
  const whiteGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, outerRadius);
  whiteGradient.addColorStop(0, `rgba(255, 255, 255, ${whiteAlpha})`);
  whiteGradient.addColorStop(0.6, `rgba(255, 255, 255, ${whiteAlpha * 0.6})`);
  whiteGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.beginPath();
  ctx.arc(0, 0, outerRadius, 0, TWO_PI);
  ctx.fillStyle = whiteGradient;
  ctx.fill();

  // Gold overlay layer (pulses in) - brighter colors
  const goldGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, outerRadius);
  goldGradient.addColorStop(0, `rgba(255, 215, 0, ${goldAlpha})`);
  goldGradient.addColorStop(0.4, `rgba(255, 200, 50, ${goldAlpha * 0.85})`);
  goldGradient.addColorStop(0.75, `rgba(255, 180, 30, ${goldAlpha * 0.5})`);
  goldGradient.addColorStop(1, "rgba(255, 165, 0, 0)");
  ctx.beginPath();
  ctx.arc(0, 0, outerRadius, 0, TWO_PI);
  ctx.fillStyle = goldGradient;
  ctx.fill();

  ctx.restore();
}

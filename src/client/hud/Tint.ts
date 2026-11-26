// A light fade of a tone's colour, set with a text colour class, strongest at
// the end of its positioned parent and gone before the text. A child, so the
// parent's hover and content draw over it; it does not fade with the HUD
// opacity, as it is content. It is drawn twice as strong at half opacity, so
// it can land at full strength and settle by fading opacity alone.
export const TINT =
  "pointer-events-none absolute inset-0 bg-linear-to-l from-current/40 via-current/10 via-55% to-transparent opacity-50 animate-event-arrive motion-reduce:animate-none";

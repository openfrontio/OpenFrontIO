import type { SlotRenderEndedEvent } from "./GoogleTag";

const GAM_IFRAME_PREFIX = "google_ads_iframe_";
const MAX_RENDERS = 30;
// Every unit we load: gutter rails, header, bottom rail, the three in-game
// units and the corner video.
const UNITS_IN_REPORT = 8;
// Measured on screen, so it must catch a 320x50 unit half off the edge
// (8,000) while skipping the 1px strips bidder and ID-sync scripts leave
// across the viewport (3,840 on a 4K screen).
const MIN_FRAME_AREA = 7_000;

interface RenderedCreative {
  slotElementId: string;
  // GPT's per-render id on the creative's iframe. Iframe ids are not unique
  // to a render: a later load of the same unit can reuse them.
  containerId: string;
  adUnitPath: string;
  size: string;
  creativeId: string;
  lineItemId: string;
  advertiserId: string;
  campaignId: string;
  bidder: string;
  bidId: string;
  advertiserDomain: string;
}

// Every render, for matching a frame from an earlier load still on screen.
const renders: RenderedCreative[] = [];
// The newest render of each unit, in order of render. Kept apart from the
// bounded history, which the in-game units' refreshes cycle through within
// minutes.
const newestByUnit = new Map<string, RenderedCreative>();
let tracking = false;

/**
 * Records every creative GPT renders. A destroyed slot takes its creative
 * details with it, so they have to be kept from render time to be reported
 * once the ad turns up where it should not be.
 */
export function trackAdCreatives(): void {
  if (tracking) return;
  tracking = true;
  try {
    window.googletag ??= { cmd: [] };
    window.googletag.cmd.push(() => {
      window.googletag
        ?.pubads?.()
        .addEventListener("slotRenderEnded", recordRender);
    });
  } catch (e) {
    console.warn("Failed to track ad creatives:", e);
  }
}

function recordRender(event: SlotRenderEndedEvent): void {
  if (event.isEmpty) return;
  try {
    const { slot } = event;
    const targeting = (key: string) => slot.getTargeting(key)[0] ?? "";
    const render: RenderedCreative = {
      slotElementId: slot.getSlotElementId(),
      containerId:
        document
          .getElementById(slot.getSlotElementId())
          ?.querySelector(`iframe[id^="${GAM_IFRAME_PREFIX}"]`)
          ?.getAttribute("data-google-container-id") ?? "",
      adUnitPath: slot.getAdUnitPath(),
      size: Array.isArray(event.size)
        ? event.size.join("x")
        : (event.size ?? ""),
      // The source-agnostic ids also cover backfill, where GAM's are null.
      creativeId: idString(event.sourceAgnosticCreativeId ?? event.creativeId),
      lineItemId: idString(event.sourceAgnosticLineItemId ?? event.lineItemId),
      advertiserId: idString(event.advertiserId),
      campaignId: idString(event.campaignId),
      // Every header-bidding win renders through the same Prebid line item,
      // so only the bid itself can name the creative.
      bidder: targeting("hb_bidder"),
      bidId: targeting("hb_adid"),
      advertiserDomain: targeting("hb_adomain"),
    };
    renders.push(render);
    if (renders.length > MAX_RENDERS) renders.shift();
    newestByUnit.delete(render.adUnitPath);
    newestByUnit.set(render.adUnitPath, render);
  } catch (e) {
    console.warn("Failed to record an ad render:", e);
  }
}

function idString(id: number | null | undefined): string {
  return id === null || id === undefined ? "" : String(id);
}

function renderedIn(
  el: Element,
): { render: RenderedCreative; match: "frame" | "path" | "slot" } | null {
  const frames = [
    ...(el.matches("iframe") ? [el] : []),
    ...el.querySelectorAll(`iframe[id^="${GAM_IFRAME_PREFIX}"]`),
  ];
  const containerIds = new Set(
    frames.map((frame) => frame.getAttribute("data-google-container-id")),
  );
  for (let i = renders.length - 1; i >= 0; i--) {
    if (
      renders[i].containerId !== "" &&
      containerIds.has(renders[i].containerId)
    ) {
      return { render: renders[i], match: "frame" };
    }
  }
  const newest = newestRenders();
  // The newest render of the unit, which may not be the one in this frame.
  for (const render of newest) {
    const framePrefix = `${GAM_IFRAME_PREFIX}${render.adUnitPath}_`;
    // The rest must be the frame counter alone, so /foo cannot claim /foo_bar.
    const isUnitFrame = (frame: Element) =>
      frame.id.startsWith(framePrefix) &&
      /^\d+$/.test(frame.id.slice(framePrefix.length));
    if (frames.some(isUnitFrame)) return { render, match: "path" };
  }
  // Playwire reuses a unit's element (#pw-oop-bottom_rail) for every load,
  // so the newest render into it may be an earlier load's.
  for (const render of newest) {
    const slotElement = document.getElementById(render.slotElementId);
    if (slotElement !== null && el.contains(slotElement)) {
      return { render, match: "slot" };
    }
  }
  return null;
}

function newestRenders(): RenderedCreative[] {
  return [...newestByUnit.values()].reverse();
}

/**
 * Faro attributes for the creative that rendered inside `el`. Failing that,
 * the newest creative of an ad unit whose path contains `adUnit`. Only a
 * "frame" match is certain to be the creative on screen; `creativeMatch`
 * says how it was found.
 */
export function creativeAttributes(
  el: Element,
  adUnit?: string,
): Record<string, string> {
  const found = renderedIn(el);
  let match: string = found?.match ?? "none";
  let render = found?.render ?? null;
  if (render === null && adUnit !== undefined) {
    match = "unit";
    render = newestRenders().find((r) => r.adUnitPath.includes(adUnit)) ?? null;
  }
  return {
    creativeMatch: render === null ? "none" : match,
    creativeId: render?.creativeId ?? "",
    lineItemId: render?.lineItemId ?? "",
    advertiserId: render?.advertiserId ?? "",
    campaignId: render?.campaignId ?? "",
    bidder: render?.bidder ?? "",
    bidId: render?.bidId ?? "",
    advertiserDomain: render?.advertiserDomain ?? "",
  };
}

// The newest render of each unit, not the newest renders overall: the
// in-game units render as the bottom rail goes, and would push it out.
function recentCreatives(): string {
  return newestRenders()
    .slice(0, UNITS_IN_REPORT)
    .map((r) =>
      [
        r.adUnitPath,
        r.size,
        r.creativeId,
        r.lineItemId,
        r.advertiserId,
        r.bidder,
        r.bidId,
        r.advertiserDomain,
      ].join("|"),
    )
    .join(";");
}

export interface StrayAdFrame {
  root: HTMLElement;
  attributes: Record<string, string>;
}

/**
 * Visible, ad-sized iframes outside our own UI (Lit custom elements) and
 * outside Playwire's containers (a pw- id or class; the bottom rail has its
 * own guard).
 * A creative that breaks out of its slot and draws on the page itself shows
 * up here, which the slot-based checks cannot see.
 */
export function findStrayAdFrames(): StrayAdFrame[] {
  const found = new Map<HTMLElement, StrayAdFrame>();
  for (const frame of document.querySelectorAll("iframe")) {
    const root = unownedRoot(frame);
    if (root === null || found.has(root)) continue;
    const rect = frame.getBoundingClientRect();
    if (visibleArea(rect) < MIN_FRAME_AREA) continue;
    if (
      frame.checkVisibility?.({
        opacityProperty: true,
        visibilityProperty: true,
      }) === false
    ) {
      continue;
    }
    const style = getComputedStyle(root);
    found.set(root, {
      root,
      attributes: {
        element: root.localName,
        elementId: root.id,
        elementClass: root.className.slice(0, 200),
        position: style.position,
        zIndex: style.zIndex,
        frameId: frame.id.slice(0, 200),
        frameOrigin: frameOrigin(frame),
        frameRect: [rect.left, rect.top, rect.width, rect.height]
          .map(Math.round)
          .join(","),
        ...creativeAttributes(root),
        recentCreatives: recentCreatives(),
      },
    });
  }
  return [...found.values()];
}

// The body-level element holding `frame`, or null when that subtree is ours
// or Playwire's.
function unownedRoot(frame: HTMLIFrameElement): HTMLElement | null {
  let el: HTMLElement = frame;
  for (;;) {
    if (customElements.get(el.localName) !== undefined) return null;
    if (el.id.startsWith("pw-")) return null;
    // The corner video's container has a class and no id.
    for (const name of el.classList) if (name.startsWith("pw-")) return null;
    const parent = el.parentElement;
    if (parent === null) return null;
    if (parent === document.body || parent === document.documentElement) {
      return el;
    }
    el = parent;
  }
}

function visibleArea(rect: DOMRect): number {
  const width =
    Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
  const height =
    Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return Math.max(0, width) * Math.max(0, height);
}

function frameOrigin(frame: HTMLIFrameElement): string {
  if (frame.src === "") return "";
  try {
    return new URL(frame.src, location.href).origin;
  } catch {
    return "";
  }
}

export function resetAdForensics(): void {
  renders.length = 0;
  newestByUnit.clear();
  tracking = false;
}

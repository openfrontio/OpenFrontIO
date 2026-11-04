// The parts of Google Publisher Tag that Playwire's ramp.js loads and we read.

export interface GptSlot {
  getSlotElementId(): string;
  getAdUnitPath(): string;
  getTargeting(key: string): string[];
}

export interface SlotRenderEndedEvent {
  slot: GptSlot;
  isEmpty: boolean;
  size: number[] | string | null;
  advertiserId?: number | null;
  campaignId?: number | null;
  creativeId: number | null;
  lineItemId: number | null;
  sourceAgnosticCreativeId?: number | null;
  sourceAgnosticLineItemId?: number | null;
}

export interface PubAdsService {
  setTargeting(key: string, value: string): void;
  addEventListener(
    type: "slotRenderEnded",
    listener: (event: SlotRenderEndedEvent) => void,
  ): void;
}

export interface GoogleTag {
  cmd: Array<() => void>;
  pubads?: () => PubAdsService;
}

declare global {
  interface Window {
    googletag?: GoogleTag;
  }
}

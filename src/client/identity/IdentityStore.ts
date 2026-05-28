import { sanitizeClanTag } from "../../core/Util";
import {
  validateClanTag,
  validateUsername,
} from "../../core/validations/username";
import { getUserMe } from "../Api";
import { fetchClanExists } from "../ClanApi";

const CLAN_OWNERSHIP_DEBOUNCE_MS = 400;
const CLAN_TAG_KEY = "clanTag";
const USERNAME_KEY = "username";

export type IdentityField<T> = {
  value: T;
  valid: boolean;
  error: string;
};

export type IdentityState = {
  username: IdentityField<string>;
  clanTag: IdentityField<string>;
  clanTagChecking: boolean;
  ready: boolean;
};

type Listener = (state: IdentityState) => void;

const listeners = new Set<Listener>();

const state: IdentityState = {
  username: { value: "", valid: false, error: "" },
  clanTag: { value: "", valid: true, error: "" },
  clanTagChecking: false,
  ready: false,
};

let lastInput = { username: "", clanTag: "" };

function emit() {
  // Play is gated until the username is valid AND the clan tag is proven OK
  // (owned or fictional). While a check is in flight, nothing is proven yet.
  state.ready =
    state.username.valid && state.clanTag.valid && !state.clanTagChecking;
  for (const listener of listeners) listener(state);
}

export function subscribeIdentity(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function getIdentityState(): IdentityState {
  return state;
}

export function getUsernameForSubmit(): string {
  return state.username.value;
}

export function getClanTagForSubmit(): string | null {
  if (state.clanTagChecking) return null;
  const { value, valid } = state.clanTag;
  return valid && value.length > 0 ? value : null;
}

export function setUsername(raw: string) {
  lastInput.username = raw;
  const trimmed = raw.trim();
  const result = validateUsername(trimmed);
  state.username = {
    value: trimmed,
    valid: result.isValid,
    error: result.isValid ? "" : (result.error ?? ""),
  };
  if (result.isValid) localStorage.setItem(USERNAME_KEY, trimmed);
  emit();
}

let clanCheckCounter = 0;
let clanCheckTimer: ReturnType<typeof setTimeout> | null = null;
let resolveDebounce: (() => void) | null = null;
let currentCheck: Promise<void> = Promise.resolve();

export function setClanTag(raw: string, options: { immediate?: boolean } = {}) {
  lastInput.clanTag = raw;
  const tag = sanitizeClanTag(raw);
  const result = validateClanTag(tag);

  // A new value supersedes any pending/in-flight check and unblocks
  // awaitIdentityReady() callers waiting on the prior one.
  if (clanCheckTimer !== null) clearTimeout(clanCheckTimer);
  clanCheckTimer = null;
  clanCheckCounter++;
  resolveDebounce?.();
  resolveDebounce = null;

  state.clanTag = {
    value: tag,
    valid: result.isValid,
    error: result.isValid ? "" : (result.error ?? ""),
  };

  if (!result.isValid || tag.length === 0) {
    state.clanTagChecking = false;
    localStorage.setItem(CLAN_TAG_KEY, "");
    currentCheck = Promise.resolve();
    emit();
    return;
  }

  // Well-formed tag: nothing is proven until the ownership check resolves.
  state.clanTagChecking = true;
  emit();

  const generation = clanCheckCounter;
  const run = () =>
    generation === clanCheckCounter
      ? runOwnershipCheck(tag, generation)
      : Promise.resolve();
  if (options.immediate) {
    currentCheck = run();
  } else {
    const debounce = new Promise<void>((resolve) => {
      resolveDebounce = resolve;
    });
    clanCheckTimer = setTimeout(() => {
      clanCheckTimer = null;
      const r = resolveDebounce;
      resolveDebounce = null;
      r?.();
    }, CLAN_OWNERSHIP_DEBOUNCE_MS);
    currentCheck = debounce.then(run);
  }
}

// Members are always accepted. A non-member keeps a tag only if the clan is
// fictional; a real clan they don't belong to, or anything we can't verify,
// is rejected so play stays gated until the tag is proven.
async function runOwnershipCheck(tag: string, generation: number) {
  const stillCurrent = () =>
    generation === clanCheckCounter && state.clanTag.value === tag;

  const me = await getUserMe();
  if (!stillCurrent()) return;
  const myTags = me
    ? (me.player.clans ?? []).map((c) => c.tag.toUpperCase())
    : [];
  if (myTags.includes(tag.toUpperCase())) {
    acceptTag(tag);
    return;
  }

  const exists = await fetchClanExists(tag);
  if (!stillCurrent()) return;
  if (exists === false) acceptTag(tag);
  else if (exists === true) rejectTag(tag, "username.tag_not_member");
  else rejectTag(tag, "username.tag_check_failed");
}

function acceptTag(tag: string) {
  state.clanTag = { value: tag, valid: true, error: "" };
  state.clanTagChecking = false;
  localStorage.setItem(CLAN_TAG_KEY, tag);
  emit();
}

function rejectTag(tag: string, error: string) {
  state.clanTag = { value: tag, valid: false, error };
  state.clanTagChecking = false;
  localStorage.removeItem(CLAN_TAG_KEY);
  emit();
}

// Resolves once any in-flight clan check settles; returns the final ready state.
export async function awaitIdentityReady(): Promise<boolean> {
  let last: Promise<void> | undefined;
  while (currentCheck !== last) {
    last = currentCheck;
    await last;
  }
  return state.ready;
}

// Re-runs sync validation against the last raw input so error strings get
// re-translated on a language change. A confirmed ownership error (i18n key,
// format-valid) is preserved.
export function revalidateIdentityTranslations() {
  const trimmed = lastInput.username.trim();
  const u = validateUsername(trimmed);
  state.username = {
    value: trimmed,
    valid: u.isValid,
    error: u.isValid ? "" : (u.error ?? ""),
  };
  const tag = sanitizeClanTag(lastInput.clanTag);
  const t = validateClanTag(tag);
  if (!t.isValid) {
    state.clanTag = { value: tag, valid: false, error: t.error ?? "" };
  }
  emit();
}

let initialized = false;
export function initIdentityFromStorage() {
  if (initialized) return;
  initialized = true;
  setUsername(localStorage.getItem(USERNAME_KEY) ?? "");
  setClanTag(localStorage.getItem(CLAN_TAG_KEY) ?? "", { immediate: true });
}

// Test-only reset for the singleton module state.
export function __resetIdentityStoreForTests() {
  initialized = false;
  listeners.clear();
  state.username = { value: "", valid: false, error: "" };
  state.clanTag = { value: "", valid: true, error: "" };
  state.clanTagChecking = false;
  state.ready = false;
  lastInput = { username: "", clanTag: "" };
  if (clanCheckTimer !== null) clearTimeout(clanCheckTimer);
  clanCheckTimer = null;
  clanCheckCounter = 0;
  resolveDebounce = null;
  currentCheck = Promise.resolve();
}

import { sanitizeClanTag } from "../../core/Util";
import {
  MAX_CLAN_TAG_LENGTH,
  MIN_CLAN_TAG_LENGTH,
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

let lastInput: { username: string; clanTag: string } = {
  username: "",
  clanTag: "",
};

function recomputeReady() {
  state.ready =
    state.username.valid && state.clanTag.valid && !state.clanTagChecking;
}

function emit() {
  recomputeReady();
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

// Mirrors the legacy ClanTagInput.getValue contract: only emit a non-null
// value when the tag is valid AND meets length AND format. Empty / pending /
// failed states submit as null so the server falls back to "no tag".
export function getClanTagForSubmit(): string | null {
  // Don't submit a tag while the ownership check is in flight — callers
  // either gate on `state.ready` first or await `awaitIdentityReady()`.
  if (state.clanTagChecking) return null;
  const { value, valid } = state.clanTag;
  if (!valid) return null;
  if (value.length < MIN_CLAN_TAG_LENGTH) return null;
  if (value.length > MAX_CLAN_TAG_LENGTH) return null;
  if (!validateClanTag(value).isValid) return null;
  return value;
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
  if (result.isValid) {
    localStorage.setItem(USERNAME_KEY, trimmed);
  }
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

  // Cancel any pending/in-flight ownership work. checkCounter++ marks stale
  // chains; resolving the prior debounce lets awaitReady() callers unblock.
  if (clanCheckTimer !== null) clearTimeout(clanCheckTimer);
  clanCheckTimer = null;
  clanCheckCounter++;
  if (resolveDebounce) resolveDebounce();
  resolveDebounce = null;

  state.clanTag = {
    value: tag,
    valid: result.isValid,
    error: result.isValid ? "" : (result.error ?? ""),
  };

  if (!result.isValid || tag.length === 0) {
    // Nothing to ask the server about. Wipe the stored tag so a reload
    // doesn't restore a stale value that no longer matches input.
    state.clanTagChecking = false;
    localStorage.setItem(CLAN_TAG_KEY, "");
    currentCheck = Promise.resolve();
    emit();
    return;
  }

  state.clanTagChecking = true;
  emit();

  const generation = clanCheckCounter;
  const run = (): Promise<void> => {
    if (generation !== clanCheckCounter) return Promise.resolve();
    return runOwnershipCheck(tag, generation);
  };

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

async function runOwnershipCheck(tag: string, generation: number) {
  const stillCurrent = () =>
    generation === clanCheckCounter && state.clanTag.value === tag;

  const me = await getUserMe();
  if (!stillCurrent()) return;
  const myTags = me
    ? (me.player.clans ?? []).map((c) => c.tag.toUpperCase())
    : [];

  if (!myTags.includes(tag.toUpperCase())) {
    const exists = await fetchClanExists(tag);
    if (!stillCurrent()) return;
    if (exists !== false) {
      rejectTag(tag);
      return;
    }
  }
  acceptTag(tag);
}

function acceptTag(tag: string) {
  state.clanTag = { value: tag, valid: true, error: "" };
  state.clanTagChecking = false;
  localStorage.setItem(CLAN_TAG_KEY, tag);
  emit();
}

function rejectTag(tag: string) {
  state.clanTag = {
    value: tag,
    valid: false,
    error: "username.tag_not_member",
  };
  state.clanTagChecking = false;
  localStorage.removeItem(CLAN_TAG_KEY);
  emit();
}

// Resolves once any in-flight async clan check settles. Returns the final
// ready state so callers can branch without a second read.
export async function awaitIdentityReady(): Promise<boolean> {
  let last: Promise<void> | undefined;
  while (currentCheck !== last) {
    last = currentCheck;
    await last;
  }
  return state.ready;
}

// Re-runs sync validation against the last raw input so error messages get
// re-translated when the active language changes. Does NOT re-trigger the
// async ownership check (the cached result is still correct).
export function revalidateIdentityTranslations() {
  const trimmed = lastInput.username.trim();
  const usernameResult = validateUsername(trimmed);
  state.username = {
    value: trimmed,
    valid: usernameResult.isValid,
    error: usernameResult.isValid ? "" : (usernameResult.error ?? ""),
  };

  const tag = sanitizeClanTag(lastInput.clanTag);
  const tagResult = validateClanTag(tag);
  // Preserve any existing ownership error (it's already an i18n key); only
  // refresh the format-level error so language changes pick up new strings.
  if (!tagResult.isValid) {
    state.clanTag = {
      value: tag,
      valid: false,
      error: tagResult.error ?? "",
    };
  }
  emit();
}

let initialized = false;
export function initIdentityFromStorage() {
  if (initialized) return;
  initialized = true;
  const storedUsername = localStorage.getItem(USERNAME_KEY) ?? "";
  setUsername(storedUsername);
  const storedClanTag = localStorage.getItem(CLAN_TAG_KEY) ?? "";
  if (storedClanTag.length > 0) {
    setClanTag(storedClanTag, { immediate: true });
  } else {
    setClanTag("", { immediate: true });
  }
}

// Test-only reset; not part of the public surface but exported so unit tests
// can wipe singleton state between cases.
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

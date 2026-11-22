import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestTurnstileToken,
  resolveTurnstileToken,
  TURNSTILE_CANCELLED_CODE,
  TURNSTILE_INTERACTIVE_TIMEOUT_CODE,
  TURNSTILE_PREFETCH_INTERACTIVE_CODE,
  TurnstileError,
  type TurnstileApi,
  type TurnstileRenderOptions,
} from "../../src/client/TurnstileToken";

function makeFake() {
  let opts: TurnstileRenderOptions | undefined;
  const api: TurnstileApi = {
    render: vi.fn((_c, o) => {
      opts = o;
      return "w1";
    }),
    execute: vi.fn(),
    remove: vi.fn(),
  };
  return { api, opts: () => opts as TurnstileRenderOptions };
}

describe("Managed Turnstile", () => {
  let container: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    vi.useRealTimers();
    container.remove();
  });

  it("extends to the interactive timeout, then re-arms the silent one", async () => {
    const f = makeFake();
    const p = requestTurnstileToken(f.api, { sitekey: "k", container });
    f.opts()["before-interactive-callback"]!();
    expect(container.dataset.interactive).toBe("true");
    expect(container.style.pointerEvents).toBe("auto");

    await vi.advanceTimersByTimeAsync(20_000); // past silent 15s
    f.opts()["after-interactive-callback"]!();
    expect(container.style.pointerEvents).toBe("none");

    const assertion = expect(p).rejects.toMatchObject({
      code: TURNSTILE_INTERACTIVE_TIMEOUT_CODE,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("reports an interactive timeout after 60s with a distinct code", async () => {
    const f = makeFake();
    const p = requestTurnstileToken(f.api, { sitekey: "k", container });
    f.opts()["before-interactive-callback"]!();
    const assertion = expect(p).rejects.toMatchObject({
      code: TURNSTILE_INTERACTIVE_TIMEOUT_CODE,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(container.style.pointerEvents).toBe("none");
  });

  it("does not retry after an interactive timeout", async () => {
    const requestFresh = vi
      .fn()
      .mockRejectedValue(
        new TurnstileError(TURNSTILE_INTERACTIVE_TIMEOUT_CODE),
      );
    const onError = vi.fn();
    await expect(
      resolveTurnstileToken({ requestFresh, onError }),
    ).rejects.toBeInstanceOf(TurnstileError);
    expect(requestFresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(TURNSTILE_INTERACTIVE_TIMEOUT_CODE);
  });

  it("drops a boot prefetch that turns interactive, and the join fetches fresh", async () => {
    const f = makeFake();
    const prefetch = requestTurnstileToken(f.api, {
      sitekey: "k",
      container,
      abortOnInteractive: true,
    });
    f.opts()["before-interactive-callback"]!();
    await expect(prefetch).rejects.toMatchObject({
      code: TURNSTILE_PREFETCH_INTERACTIVE_CODE,
    });
    expect(container.dataset.interactive).toBeUndefined();

    const requestFresh = vi
      .fn()
      .mockResolvedValue({ token: "fresh", createdAt: Date.now() });
    prefetch.catch(() => undefined);
    const token = await resolveTurnstileToken({ prefetch, requestFresh });
    expect(token).toBe("fresh");
    expect(requestFresh).toHaveBeenCalledTimes(1);
  });

  it("cancels cleanly on backdrop click", async () => {
    const f = makeFake();
    const onCancel = vi.fn();
    const p = requestTurnstileToken(f.api, {
      sitekey: "k",
      container,
      onCancel,
    });
    f.opts()["before-interactive-callback"]!();
    container.click();
    await expect(p).rejects.toMatchObject({ code: TURNSTILE_CANCELLED_CODE });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(f.api.remove).toHaveBeenCalledWith("w1");
    expect(container.style.pointerEvents).toBe("none");
  });

  it("ignores clicks inside the widget host", async () => {
    const f = makeFake();
    const onCancel = vi.fn();
    const p = requestTurnstileToken(f.api, {
      sitekey: "k",
      container,
      onCancel,
    });
    f.opts()["before-interactive-callback"]!();
    (container.firstElementChild as HTMLElement).click();
    expect(onCancel).not.toHaveBeenCalled();
    f.opts().callback!("tok");
    await expect(p).resolves.toMatchObject({ token: "tok" });
  });

  it("Escape cancels and does not reach other Escape listeners", async () => {
    const f = makeFake();
    const modalEscape = vi.fn();
    document.addEventListener("keydown", modalEscape);
    const p = requestTurnstileToken(f.api, { sitekey: "k", container });
    f.opts()["before-interactive-callback"]!();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(p).rejects.toMatchObject({ code: TURNSTILE_CANCELLED_CODE });
    expect(modalEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", modalEscape);
  });

  it("a cancelled fresh request rejects with cancelled code and no error modal", async () => {
    const requestFresh = vi
      .fn()
      .mockRejectedValue(new TurnstileError(TURNSTILE_CANCELLED_CODE));
    const onError = vi.fn();
    await expect(
      resolveTurnstileToken({ requestFresh, onError }),
    ).rejects.toMatchObject({ code: TURNSTILE_CANCELLED_CODE });
    expect(onError).not.toHaveBeenCalled();
    expect(requestFresh).toHaveBeenCalledTimes(1);
  });

  it("removes the backdrop when the signal aborts mid-challenge", async () => {
    const f = makeFake();
    const ac = new AbortController();
    const p = requestTurnstileToken(f.api, {
      sitekey: "k",
      container,
      signal: ac.signal,
    });
    f.opts()["before-interactive-callback"]!();
    ac.abort();
    await expect(p).rejects.toBeDefined();
    expect(container.style.pointerEvents).toBe("none");
    expect(container.dataset.interactive).toBeUndefined();
  });

  it("a settling request does not strip another request's backdrop", async () => {
    const a = makeFake();
    const b = makeFake();
    const pa = requestTurnstileToken(a.api, { sitekey: "k", container });
    const pb = requestTurnstileToken(b.api, { sitekey: "k", container });
    b.opts()["before-interactive-callback"]!();
    a.opts().callback!("tok");
    await pa;
    expect(container.dataset.interactive).toBe("true");
    expect(container.style.pointerEvents).toBe("auto");
    b.opts().callback!("tok2");
    await pb;
    expect(container.style.pointerEvents).toBe("none");
  });

  it("never styles document.body when used as the fallback container", async () => {
    const f = makeFake();
    const p = requestTurnstileToken(f.api, {
      sitekey: "k",
      container: document.body,
    });
    f.opts()["before-interactive-callback"]!();
    expect(document.body.style.pointerEvents).toBe("");
    f.opts().callback!("tok");
    await p;
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("shows a labelled Cancel button only while interactive; it cancels", async () => {
    const f = makeFake();
    const onCancel = vi.fn();
    const p = requestTurnstileToken(f.api, {
      sitekey: "k",
      container,
      onCancel,
      cancelLabel: "Nope",
      dialogLabel: "Verify",
    });
    expect(container.querySelector("button")).toBeNull();
    f.opts()["before-interactive-callback"]!();
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("Nope");
    expect(container.getAttribute("role")).toBe("dialog");
    expect(container.getAttribute("aria-label")).toBe("Verify");
    button.click();
    await expect(p).rejects.toMatchObject({ code: TURNSTILE_CANCELLED_CODE });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector("button")).toBeNull();
    expect(container.getAttribute("role")).toBeNull();
  });

  it("removes the Cancel button after the challenge is solved", async () => {
    const f = makeFake();
    const p = requestTurnstileToken(f.api, { sitekey: "k", container });
    f.opts()["before-interactive-callback"]!();
    f.opts()["after-interactive-callback"]!();
    expect(container.querySelector("button")).toBeNull();
    f.opts().callback!("tok");
    await p;
  });

  it("moves focus inside the modal on open, traps external focus, and restores previous focus on close", async () => {
    const triggerButton = document.createElement("button");
    document.body.appendChild(triggerButton);
    triggerButton.focus();
    expect(document.activeElement).toBe(triggerButton);

    const f = makeFake();
    const p = requestTurnstileToken(f.api, { sitekey: "k", container });
    f.opts()["before-interactive-callback"]!();

    const cancelButton = container.querySelector("button")!;
    expect(document.activeElement).toBe(cancelButton);

    // Focus escaping to an element outside the dialog container is redirected back inside
    triggerButton.focus();
    triggerButton.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.activeElement).toBe(cancelButton);

    f.opts()["after-interactive-callback"]!();
    expect(document.activeElement).toBe(triggerButton);

    f.opts().callback!("tok");
    await p;
    triggerButton.remove();
  });
});

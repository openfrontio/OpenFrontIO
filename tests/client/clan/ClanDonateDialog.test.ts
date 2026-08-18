import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMe = vi.fn();
const donateToClan = vi.fn();

vi.mock("../../../src/client/Api", () => ({
  getUserMe: (...args: unknown[]) => getUserMe(...args),
}));
vi.mock("../../../src/client/ClanApi", () => ({
  donateToClan: (...args: unknown[]) => donateToClan(...args),
}));
vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn(
    (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  ),
}));

import "../../../src/client/components/clan/ClanDonateDialog";
import type { ClanDonateDialog } from "../../../src/client/components/clan/ClanDonateDialog";

const flush = async (
  el: HTMLElement & { updateComplete: Promise<boolean> },
) => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

// The dialog renders through a body-level portal, so query the document.
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
const donateButton = () =>
  q<HTMLButtonElement>('button[data-action="donate"]')!;
const amountInput = () => q<HTMLInputElement>("#clan-donate-amount")!;
const currencyButton = (type: "soft" | "hard") =>
  q<HTMLButtonElement>(`button[data-currency="${type}"]`)!;
const alertText = () => q('[role="alert"]')?.textContent?.trim() ?? null;

const typeAmount = async (dialog: ClanDonateDialog, value: string) => {
  amountInput().value = value;
  amountInput().dispatchEvent(new Event("input"));
  await flush(dialog);
};

describe("clan-donate-dialog", () => {
  let dialog: ClanDonateDialog;

  beforeEach(async () => {
    getUserMe.mockResolvedValue({
      user: { email: "me@test" },
      player: { publicId: "me", currency: { soft: 1000, hard: 25 } },
    });
    donateToClan.mockReset();
    dialog = document.createElement("clan-donate-dialog") as ClanDonateDialog;
    dialog.clanTag = "TST";
    document.body.appendChild(dialog);
    await flush(dialog);
  });

  afterEach(() => {
    dialog.remove();
  });

  it("removes its overlay from the document when detached", () => {
    expect(q("#clan-donate-amount")).toBeTruthy();
    dialog.remove();
    expect(q("#clan-donate-amount")).toBeNull();
  });

  it("shows the player's balance for each currency, soft selected by default", () => {
    expect(currencyButton("soft").getAttribute("aria-checked")).toBe("true");
    expect(currencyButton("hard").getAttribute("aria-checked")).toBe("false");
    expect(currencyButton("soft").textContent).toContain(
      'clan_modal.donate_your_balance:{"balance":"1,000"}',
    );
    expect(currencyButton("hard").textContent).toContain(
      'clan_modal.donate_your_balance:{"balance":"25"}',
    );
  });

  it("always states that donations are irreversible", () => {
    expect(document.body.textContent).toContain(
      "clan_modal.donate_irreversible",
    );
    expect(document.body.textContent).not.toContain(
      "clan_modal.donate_irreversible_hard",
    );
  });

  it("adds the stronger warning when hard currency is selected", async () => {
    currencyButton("hard").click();
    await flush(dialog);
    expect(currencyButton("hard").getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain(
      "clan_modal.donate_irreversible_hard",
    );
  });

  it("disables Donate until a valid amount is entered", async () => {
    expect(donateButton().disabled).toBe(true);
    expect(alertText()).toBeNull();

    await typeAmount(dialog, "0");
    expect(donateButton().disabled).toBe(true);
    expect(alertText()).toBe("clan_modal.donate_invalid_amount");

    await typeAmount(dialog, "1.5");
    expect(donateButton().disabled).toBe(true);
    expect(alertText()).toBe("clan_modal.donate_invalid_amount");

    await typeAmount(dialog, "-3");
    expect(donateButton().disabled).toBe(true);

    await typeAmount(dialog, "300");
    expect(donateButton().disabled).toBe(false);
    expect(alertText()).toBeNull();
  });

  it("rejects an amount above the selected currency's balance", async () => {
    await typeAmount(dialog, "1001");
    expect(donateButton().disabled).toBe(true);
    expect(alertText()).toBe(
      'clan_modal.donate_insufficient:{"currency":"cosmetics.soft"}',
    );

    // Same amount against the other wallet re-validates.
    currencyButton("hard").click();
    await flush(dialog);
    expect(alertText()).toBe(
      'clan_modal.donate_insufficient:{"currency":"cosmetics.hard"}',
    );

    await typeAmount(dialog, "25");
    expect(donateButton().disabled).toBe(false);
  });

  it("submits the amount as a string with one stable idempotency key, disables while in flight, and emits donated", async () => {
    let resolve!: (v: true) => void;
    donateToClan.mockImplementation(
      () => new Promise<true>((r) => (resolve = r)),
    );
    const donated = vi.fn();
    dialog.addEventListener("donated", donated);

    currencyButton("hard").click();
    await typeAmount(dialog, "20");
    donateButton().click();
    await flush(dialog);

    expect(donateToClan).toHaveBeenCalledTimes(1);
    const [tag, type, amount, key] = donateToClan.mock.calls[0];
    expect(tag).toBe("TST");
    expect(type).toBe("hard");
    expect(amount).toBe("20");
    expect(typeof key).toBe("string");
    expect((key as string).length).toBeGreaterThanOrEqual(8);
    expect((key as string).length).toBeLessThanOrEqual(64);

    // In flight: nothing is clickable, and a second click is a no-op.
    expect(donateButton().disabled).toBe(true);
    expect(amountInput().disabled).toBe(true);
    expect(currencyButton("soft").disabled).toBe(true);
    donateButton().click();
    await flush(dialog);
    expect(donateToClan).toHaveBeenCalledTimes(1);

    resolve(true);
    await flush(dialog);
    expect(donated).toHaveBeenCalledTimes(1);
    expect(donated.mock.calls[0][0].detail).toEqual({
      currencyType: "hard",
      amount: "20",
    });
  });

  it("shows the server error, stays open, and reuses the key on retry", async () => {
    donateToClan
      .mockResolvedValueOnce({ error: "clan_modal.error_network" })
      .mockResolvedValueOnce(true);
    const donated = vi.fn();
    dialog.addEventListener("donated", donated);

    await typeAmount(dialog, "300");
    donateButton().click();
    await flush(dialog);

    expect(donated).not.toHaveBeenCalled();
    expect(alertText()).toBe(
      'clan_modal.error_network:{"currency":"cosmetics.soft"}',
    );
    expect(donateButton().disabled).toBe(false);

    donateButton().click();
    await flush(dialog);
    expect(donateToClan).toHaveBeenCalledTimes(2);
    expect(donateToClan.mock.calls[0][3]).toBe(donateToClan.mock.calls[1][3]);
    expect(donated).toHaveBeenCalledTimes(1);
  });

  it("emits cancel from the Cancel button and the backdrop", async () => {
    const cancel = vi.fn();
    dialog.addEventListener("cancel", cancel);
    const cancelButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "common.cancel",
    )!;
    cancelButton.click();
    expect(cancel).toHaveBeenCalledTimes(1);

    q<HTMLElement>(".fixed.inset-0")!.click();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("still allows a donation when the wallet balance is unknown", async () => {
    dialog.remove();
    getUserMe.mockResolvedValue(false);
    dialog = document.createElement("clan-donate-dialog") as ClanDonateDialog;
    dialog.clanTag = "TST";
    document.body.appendChild(dialog);
    await flush(dialog);

    await typeAmount(dialog, "999999");
    expect(donateButton().disabled).toBe(false);
    expect(alertText()).toBeNull();
  });
});

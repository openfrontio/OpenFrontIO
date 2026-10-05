import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/AccountSettingsModal";
import type { AccountSettingsModal } from "../../src/client/AccountSettingsModal";
import { getIdentityTokenAudiences, getUserMe } from "../../src/client/Api";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
  getIdentityTokenAudiences: vi.fn(),
}));

const userMe = {
  user: {},
  player: { publicId: "test-player" },
} as unknown as UserMeResponse;

describe("AccountSettingsModal — identity token sites", () => {
  let modal: AccountSettingsModal;

  beforeEach(async () => {
    vi.mocked(getUserMe).mockResolvedValue(userMe);
    vi.mocked(getIdentityTokenAudiences).mockResolvedValue(["ofstats.io"]);
    modal = document.createElement(
      "account-settings-modal",
    ) as AccountSettingsModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    modal.remove();
    vi.clearAllMocks();
  });

  // The modal is in the page from load; the site list is only fetched once a
  // player actually opens account settings.
  it("does not fetch the site list until the modal is opened", async () => {
    expect(getIdentityTokenAudiences).not.toHaveBeenCalled();

    modal.open();

    await vi.waitFor(() =>
      expect(modal.querySelector("identity-token-card select")).not.toBeNull(),
    );
    expect(getIdentityTokenAudiences).toHaveBeenCalledTimes(1);
  });
});

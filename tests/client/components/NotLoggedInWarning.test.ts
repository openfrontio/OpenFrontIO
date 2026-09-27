import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotLoggedInWarning } from "../../../src/client/components/NotLoggedInWarning";
import type { UserMeResponse } from "../../../src/core/ApiSchemas";

function fireUserMe(detail: UserMeResponse | false) {
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
}

const steamOnly = {
  user: { steam: { id: "76561198000000000" } },
  player: { publicId: "p" },
} as unknown as UserMeResponse;

// A session with no linked identity at all: /users/@me answered, but the
// account is anonymous. This is the one case the warning exists for.
const anonymous = {
  user: {},
  player: { publicId: "p" },
} as unknown as UserMeResponse;

describe("not-logged-in-warning", () => {
  let el: NotLoggedInWarning;

  beforeEach(async () => {
    // The @customElement define() side-effect doesn't run under the test
    // transform, so register explicitly (as other client component tests do).
    if (!customElements.get("not-logged-in-warning")) {
      customElements.define("not-logged-in-warning", NotLoggedInWarning);
    }
    el = document.createElement("not-logged-in-warning") as NotLoggedInWarning;
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
  });

  async function button(): Promise<HTMLButtonElement | null> {
    await el.updateComplete;
    return el.querySelector("button");
  }

  it("renders nothing while auth is still pending (OPE-338)", async () => {
    // No userMeResponse has been broadcast yet: Main is still waiting on
    // userAuth(). Nothing is known, so nothing may be claimed.
    expect(await button()).toBeNull();
  });

  it("warns once auth settles with no session", async () => {
    fireUserMe(false);
    expect(await button()).not.toBeNull();
  });

  it("warns once auth settles on an account with no linked identity", async () => {
    fireUserMe(anonymous);
    expect(await button()).not.toBeNull();
  });

  it("renders nothing once auth settles on a linked account", async () => {
    fireUserMe(steamOnly);
    expect(await button()).toBeNull();
  });

  it("never shows the warning at any point for a player who is logged in", async () => {
    // The post-purchase reload sequence: mount (pending) -> auth resolves.
    expect(await button()).toBeNull();
    fireUserMe(steamOnly);
    expect(await button()).toBeNull();
  });

  it("warns when a linked session is later cleared", async () => {
    fireUserMe(steamOnly);
    expect(await button()).toBeNull();
    // session-cleared routes through Main's onUserMe(false).
    fireUserMe(false);
    expect(await button()).not.toBeNull();
  });
});

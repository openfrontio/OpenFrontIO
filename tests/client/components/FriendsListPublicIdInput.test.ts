import { describe, expect, it } from "vitest";
import { extractPublicIdFromUrl } from "../../../src/client/components/FriendsList";

describe("extractPublicIdFromUrl", () => {
  it("keeps only the id from a pasted profile share link", () => {
    expect(
      extractPublicIdFromUrl(
        "http://localhost:9000/#modal=profile&publicID=95UoOPh3",
      ),
    ).toBe("95UoOPh3");
  });

  it("handles https links and other hash params in any order", () => {
    expect(
      extractPublicIdFromUrl(
        "https://openfront.io/#publicID=95UoOPh3&modal=profile&tab=games",
      ),
    ).toBe("95UoOPh3");
  });

  it("decodes percent-encoded ids", () => {
    expect(
      extractPublicIdFromUrl(
        "https://openfront.io/#modal=profile&publicID=a%2Bb",
      ),
    ).toBe("a+b");
  });

  it("leaves a bare public id untouched", () => {
    expect(extractPublicIdFromUrl("95UoOPh3")).toBe("95UoOPh3");
  });

  it("leaves a username with a discriminator untouched", () => {
    expect(extractPublicIdFromUrl("wonder #5005")).toBe("wonder #5005");
  });

  it("returns the input when the url carries no publicID", () => {
    const url = "https://openfront.io/#modal=leaderboard";
    expect(extractPublicIdFromUrl(url)).toBe(url);
  });

  it("returns the input for an unparseable url-ish string", () => {
    expect(extractPublicIdFromUrl("http://")).toBe("http://");
  });
});

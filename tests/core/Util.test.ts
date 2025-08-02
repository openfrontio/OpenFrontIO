import { renderNumber, renderTroops } from "../../src/core/Util";

describe("Util", () => {
  describe("renderNumber", () => {
    it.each([
      [-6, "0"],
      [0, "0"],
      [6, "6"],
      [66, "66"],
      [666, "666"],
      [1000, "1.00K"],
      [6_666, "6.66K"],
      [66_666, "66.6K"],
      [666_666, "666K"],
      [1_000_000, "1.00M"],
      [6_666_666, "6.66M"],
      [10_000_000, "10.0M"],
      [66_666_666, "66.6M"],
      [1000n, "1.00K"],
    ])('should render number %i as string "%s"', (number, str) => {
      expect(renderNumber(number)).toBe(str);
    });
  });

  describe("renderTroops", () => {
    it("should render correct value of troops", () => {
      expect(renderTroops(66_666)).toBe("6.66K");
    });
  });
});

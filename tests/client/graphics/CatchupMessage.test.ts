/**
 * @jest-environment jsdom
 */
import { CatchupMessage } from "../../../src/client/graphics/layers/CatchupMessage";
import { translateText } from "../../../src/client/Utils";

// Mock translateText function
jest.mock("../../../src/client/Utils", () => ({
  translateText: jest.fn((key) => `translated_${key}`),
}));

describe("CatchupMessage", () => {
  let catchupMessage: CatchupMessage;
  let element: HTMLDivElement;

  beforeEach(() => {
    // Clear any previous elements
    document.body.innerHTML = "";
    catchupMessage = new CatchupMessage();
    element = document.getElementById("catchup-message") as HTMLDivElement;
  });

  test("creates element with correct initial styles", () => {
    expect(element).toBeTruthy();
    expect(element.style.position).toBe("fixed");
    expect(element.style.top).toBe("50%");
    expect(element.style.left).toBe("50%");
    expect(element.style.transform).toBe("translate(-50%, -50%)");
    expect(element.style.backgroundColor).toBe("rgba(255, 200, 0, 0.7)");
    expect(element.style.padding).toBe("10px 20px");
    expect(element.style.borderRadius).toBe("5px");
    expect(element.style.zIndex).toBe("1000");
    expect(element.style.display).toBe("none");
  });

  test("shows message with progress", () => {
    catchupMessage.show(50);
    expect(element.style.display).toBe("block");
    expect(element.textContent).toBe("translated_catchup_overlay.catchup_notice");
    expect(translateText).toHaveBeenCalledWith("catchup_overlay.catchup_notice", { progress: 50 });
  });

  test("progress is updated by subsequent calls to show", () => {
    catchupMessage.show(50);
    expect(element.textContent).toBe("translated_catchup_overlay.catchup_notice");
    catchupMessage.show(75);
    expect(element.textContent).toBe("translated_catchup_overlay.catchup_notice");
  });

  test("hides message", () => {
    catchupMessage.show(50);
    catchupMessage.hide();
    expect(element.style.display).toBe("none");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});

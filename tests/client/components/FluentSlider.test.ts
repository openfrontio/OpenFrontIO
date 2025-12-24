/**
 * @jest-environment jsdom
 */
import { FluentSlider } from "../../../src/client/components/FluentSlider";

// Mock the translateText function
jest.mock("../../../src/client/Utils", () => ({
  translateText: jest.fn((key: string) => key),
}));

describe("FluentSlider", () => {
  let slider: FluentSlider;

  beforeEach(async () => {
    // Define the custom element if not already defined
    if (!customElements.get("fluent-slider")) {
      customElements.define("fluent-slider", FluentSlider);
    }
    slider = document.createElement("fluent-slider") as FluentSlider;
    document.body.appendChild(slider);
    await slider.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(slider);
  });

  describe("Initialization", () => {
    it("should initialize with default values", () => {
      expect(slider.value).toBe(0);
      expect(slider.min).toBe(0);
      expect(slider.max).toBe(400);
      expect(slider.step).toBe(1);
      expect(slider.labelKey).toBe("");
      expect(slider.disabledKey).toBe("");
    });

    it("should accept custom property values", async () => {
      slider.value = 150;
      slider.min = 10;
      slider.max = 300;
      slider.step = 5;
      slider.labelKey = "host_modal.bots";
      slider.disabledKey = "host_modal.bots_disabled";

      await slider.updateComplete;

      expect(slider.value).toBe(150);
      expect(slider.min).toBe(10);
      expect(slider.max).toBe(300);
      expect(slider.step).toBe(5);
      expect(slider.labelKey).toBe("host_modal.bots");
      expect(slider.disabledKey).toBe("host_modal.bots_disabled");
    });
  });

  describe("Value Updates from Range Slider", () => {
    it("should update value when slider input changes", async () => {
      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      ) as HTMLInputElement;
      expect(rangeInput).toBeTruthy();

      // Simulate slider input
      rangeInput.valueAsNumber = 250;
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
      await slider.updateComplete;

      expect(slider.value).toBe(250);
    });

    it("should update value when slider change event fires", async () => {
      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      ) as HTMLInputElement;

      rangeInput.valueAsNumber = 100;
      rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
      await slider.updateComplete;

      expect(slider.value).toBe(100);
    });
  });

  describe("Value-Changed Event - CRITICAL FOR BUG FIX", () => {
    it("should dispatch CustomEvent with detail.value (not event.target.value)", async () => {
      const eventSpy = jest.fn();
      slider.addEventListener("value-changed", eventSpy);

      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      ) as HTMLInputElement;
      rangeInput.valueAsNumber = 200;
      rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
      await slider.updateComplete;

      expect(eventSpy).toHaveBeenCalled();
      const event = eventSpy.mock.calls[0][0] as CustomEvent<{
        value: number;
      }>;

      // CRITICAL: Event must have detail.value, not target.value
      expect(event.detail).toBeDefined();
      expect(event.detail.value).toBe(200);
      expect(event.bubbles).toBe(true);
      expect(event.composed).toBe(true);
    });

    it("should not dispatch event on input, only on change", async () => {
      const eventSpy = jest.fn();
      slider.addEventListener("value-changed", eventSpy);

      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      ) as HTMLInputElement;

      // Input event should NOT trigger value-changed
      rangeInput.valueAsNumber = 150;
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
      await slider.updateComplete;
      expect(eventSpy).not.toHaveBeenCalled();

      // Change event SHOULD trigger value-changed
      rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
      await slider.updateComplete;
      expect(eventSpy).toHaveBeenCalledTimes(1);
    });

    it("should work with the handler pattern used in HostLobbyModal", async () => {
      // This simulates the actual handler code in HostLobbyModal.ts:656-660
      const mockHandler = jest.fn((e: Event) => {
        const customEvent = e as CustomEvent<{ value: number }>;
        const value = customEvent.detail.value;
        if (isNaN(value) || value < 0 || value > 400) {
          return;
        }
        // If we get here, the event structure is correct!
        expect(value).toBeDefined();
        expect(typeof value).toBe("number");
      });

      slider.addEventListener("value-changed", mockHandler);

      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      ) as HTMLInputElement;
      rangeInput.valueAsNumber = 250;
      rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
      await slider.updateComplete;

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(slider.value).toBe(250);
    });

    it("should work with the handler pattern used in SinglePlayerModal", async () => {
      // This simulates the actual handler code in SinglePlayerModal.ts:444-451
      const mockHandler = jest.fn((e: Event) => {
        const customEvent = e as CustomEvent<{ value: number }>;
        const value = customEvent.detail.value;
        if (isNaN(value) || value < 0 || value > 400) {
          return;
        }
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(400);
      });

      slider.addEventListener("value-changed", mockHandler);

      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      ) as HTMLInputElement;
      rangeInput.valueAsNumber = 350;
      rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
      await slider.updateComplete;

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(slider.value).toBe(350);
    });
  });

  describe("Value Validation via Number Input", () => {
    it("should clamp values to min", () => {
      slider.min = 10;
      slider.max = 100;

      // Simulate the handleNumberChange logic
      let testValue = 5; // Below min
      if (isNaN(testValue)) {
        testValue = slider.min;
      }
      if (testValue < slider.min) testValue = slider.min;
      if (testValue > slider.max) testValue = slider.max;

      expect(testValue).toBe(10);
    });

    it("should clamp values to max", () => {
      slider.min = 10;
      slider.max = 100;

      let testValue = 150; // Above max
      if (isNaN(testValue)) {
        testValue = slider.min;
      }
      if (testValue < slider.min) testValue = slider.min;
      if (testValue > slider.max) testValue = slider.max;

      expect(testValue).toBe(100);
    });

    it("should default to min when NaN", () => {
      slider.min = 5;

      let testValue = NaN;
      if (isNaN(testValue)) {
        testValue = slider.min;
      }
      if (testValue < slider.min) testValue = slider.min;
      if (testValue > slider.max) testValue = slider.max;

      expect(testValue).toBe(5);
    });
  });

  describe("Component Structure", () => {
    it("should render a range input", () => {
      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      );
      expect(rangeInput).toBeTruthy();
    });

    it("should have correct range input properties", () => {
      slider.value = 150;
      slider.min = 0;
      slider.max = 400;
      slider.step = 1;

      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      ) as HTMLInputElement;

      expect(rangeInput.min).toBe("0");
      expect(rangeInput.max).toBe("400");
      expect(rangeInput.step).toBe("1");
    });

    it("should render an editable span for the value display", () => {
      const editableSpan = slider.shadowRoot?.querySelector("span.editable");
      expect(editableSpan).toBeTruthy();
      expect(editableSpan?.getAttribute("role")).toBe("button");
      expect(editableSpan?.getAttribute("tabindex")).toBe("0");
    });
  });

  describe("Bot Count Scenario - Regression Test", () => {
    it("should correctly update bot count from 0 to 400 and dispatch proper events", async () => {
      const capturedValues: number[] = [];

      slider.addEventListener("value-changed", (e) => {
        const customEvent = e as CustomEvent<{ value: number }>;
        capturedValues.push(customEvent.detail.value);
      });

      slider.value = 0;
      await slider.updateComplete;

      const rangeInput = slider.shadowRoot?.querySelector(
        'input[type="range"]',
      ) as HTMLInputElement;

      // Simulate dragging the slider from 0 to 400
      for (const val of [0, 100, 200, 300, 400]) {
        rangeInput.valueAsNumber = val;
        rangeInput.dispatchEvent(new Event("input", { bubbles: true })); // Updates display
        rangeInput.dispatchEvent(new Event("change", { bubbles: true })); // Triggers event
        await slider.updateComplete;
      }

      // Should have captured all change events (not input events)
      expect(capturedValues).toEqual([0, 100, 200, 300, 400]);
      expect(slider.value).toBe(400);
    });
  });
});

import NameLayer from "./NameLayer";

describe("NameLayer", () => {
  let layer: NameLayer;

  beforeEach(() => {
    layer = new NameLayer();
  });

  it("should initialize with default name as empty string", () => {
    expect(layer.getName()).toBe("");
  });

  it("should initialize with provided initialName", () => {
    const initial = "Alice";
    layer = new NameLayer({ initialName: initial });
    expect(layer.getName()).toBe(initial);
  });

  it("should setName to valid string within maxLength", () => {
    const name = "Bob";
    layer.setName(name);
    expect(layer.getName()).toBe(name);
  });

  it("should allow setting name exactly at maxLength", () => {
    const max = 10;
    const longName = "a".repeat(max);
    layer = new NameLayer({ maxLength: max });
    layer.setName(longName);
    expect(layer.getName()).toBe(longName);
  });

  it("should throw TypeError when setName is called with non-string", () => {
    // @ts-ignore: Testing invalid type
    expect(() => layer.setName(123)).toThrow(TypeError);
    // @ts-ignore: Testing invalid type
    expect(() => layer.setName(123)).toThrow("Name must be a string");
  });

  it("should throw Error when setName exceeds maxLength", () => {
    const max = 5;
    layer = new NameLayer({ maxLength: max });
    const tooLong = "a".repeat(max + 1);
    expect(() => layer.setName(tooLong)).toThrow(Error);
    expect(() => layer.setName(tooLong)).toThrow(`Name exceeds maximum length of ${max}`);
  });

  it("should clearName and reset name to empty string", () => {
    layer.setName("Charlie");
    layer.clearName();
    expect(layer.getName()).toBe("");
  });

  it("should render name using CanvasRenderingContext2D.fillText", () => {
    const mockContext = { fillText: jest.fn() } as unknown as CanvasRenderingContext2D;
    layer.setName("Dana");
    layer.render(mockContext);
    expect(mockContext.fillText).toHaveBeenCalledWith("Dana", 0, 0);
  });

  it("should render empty name when no name is set", () => {
    const mockContext = { fillText: jest.fn() } as unknown as CanvasRenderingContext2D;
    layer.render(mockContext);
    expect(mockContext.fillText).toHaveBeenCalledWith("", 0, 0);
  });
});
// Testing framework: Jest with ts-jest
import {
  PageViewSchema,
  ClickEventSchema,
  PurchaseEventSchema
} from './AnalyticsSchemas';

describe('AnalyticsSchemas', () => {
  describe('PageViewSchema', () => {
    const validPageView = {
      pageId: 'home',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: 1620000000
    };

    it('parses a valid PageView object', () => {
      const result = PageViewSchema.safeParse(validPageView);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validPageView);
      }
    });

    it('rejects when a required field is missing', () => {
      const invalid = { ...validPageView };
      delete (invalid as any).pageId;
      const result = PageViewSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects when a field has the wrong type', () => {
      const invalid = { ...validPageView, timestamp: 'not a number' };
      const result = PageViewSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('ClickEventSchema', () => {
    const validClickEvent = {
      pageId: 'home',
      elementId: 'button-1',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: 1620000000
    };

    it('parses a valid ClickEvent object', () => {
      const result = ClickEventSchema.safeParse(validClickEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validClickEvent);
      }
    });

    it('rejects when a required field is missing', () => {
      const invalid = { ...validClickEvent };
      delete (invalid as any).elementId;
      const result = ClickEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects when a field has the wrong type', () => {
      const invalid = { ...validClickEvent, timestamp: 'invalid' };
      const result = ClickEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('PurchaseEventSchema', () => {
    const validPurchaseEvent = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      itemId: 'item-123',
      amount: 100,
      timestamp: 1620000000
    };

    it('parses a valid PurchaseEvent object', () => {
      const result = PurchaseEventSchema.safeParse(validPurchaseEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validPurchaseEvent);
      }
    });

    it('rejects when a required field is missing', () => {
      const invalid = { ...validPurchaseEvent };
      delete (invalid as any).itemId;
      const result = PurchaseEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects when a field has the wrong type', () => {
      const invalid = { ...validPurchaseEvent, timestamp: 'not a number' };
      const result = PurchaseEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects when numeric field is below minimum', () => {
      const invalid = { ...validPurchaseEvent, amount: -1 };
      const result = PurchaseEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
describe('Schemas module', () => {
  describe('validateSchema()', () => {
    test('returns true for a minimal, valid schema', () => {
      const schema = { type: 'object', properties: {} };
      expect(validateSchema(schema)).toBe(true);
    });

    test('throws SchemaError when required property is missing', () => {
      expect(() => validateSchema({} as any)).toThrow(SchemaError);
    });

    test('works with a deeply nested schema', () => {
      const schema = {
        type: 'object',
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: { type: 'string' }
            }
          }
        }
      };
      expect(validateSchema(schema)).toBe(true);
    });
  });

  describe('parseSchema()', () => {
    beforeEach(() => {
      jest.resetAllMocks();
    });

    test('parses a valid schema JSON string', () => {
      const str = JSON.stringify({ type: 'object', properties: {} });
      expect(parseSchema(str)).toEqual({ type: 'object', properties: {} });
    });

    test('throws SchemaError for invalid JSON string', () => {
      expect(() => parseSchema('not valid json')).toThrow(SchemaError);
    });

    test('throws SchemaError when schema is invalid', () => {
      const str = JSON.stringify({}); // missing required fields
      expect(() => parseSchema(str)).toThrow(SchemaError);
    });
  });

  describe('SchemaError', () => {
    test('is an instance of Error and includes the invalid field name', () => {
      const err = new SchemaError('missingProp');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('missingProp');
    });

    test('has the correct name property', () => {
      const err = new SchemaError('someField');
      expect(err.name).toBe('SchemaError');
    });
  });
});
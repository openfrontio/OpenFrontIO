import { GoogleUser, GoogleUserSchema } from "../src/core/ApiSchemas";

describe("GoogleUserSchema", () => {
  it("accepts a valid email", () => {
    const result = GoogleUserSchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("rejects a missing email", () => {
    expect(GoogleUserSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-string email", () => {
    expect(GoogleUserSchema.safeParse({ email: 123 }).success).toBe(false);
  });

  it("infers the GoogleUser type from the schema", () => {
    // Compile-time check that GoogleUser is derived from the schema.
    const user: GoogleUser = { email: "typed@example.com" };
    expect(user.email).toBe("typed@example.com");
  });
});

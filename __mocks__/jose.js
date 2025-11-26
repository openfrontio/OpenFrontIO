// Minimal mock of jose for tests
export const base64url = {
  encode: (input) => Buffer.from(String(input)).toString("base64url"),
  decode: (input) => Buffer.from(String(input), "base64url").toString("utf8"),
};
export const jwtVerify = async () => ({ payload: {}, protectedHeader: {} });
export const decodeJwt = () => ({ sub: "test" });
export const JWK = {};

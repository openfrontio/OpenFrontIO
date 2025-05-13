import { jwtVerify } from "jose";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { ServerConfig } from "../core/configuration/Config";

type TokenVerificationResult = {
  persistentId: string;
  claims: TokenPayload | null;
};

export async function verifyClientToken(
  token: string,
  config: ServerConfig,
): Promise<TokenVerificationResult> {
  if (token.length === 36) {
    return { persistentId: token, claims: null };
  }
  const issuer = config.jwtIssuer();
  const audience = config.jwtAudience();
  const key = await config.jwkPublicKey();
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    algorithms: ["EdDSA"],
    issuer,
    audience,
    maxTokenAge: "6 days",
  });
  const claims = TokenPayloadSchema.parse(payload);
  const persistentId = claims.sub;
  return { persistentId, claims };
}

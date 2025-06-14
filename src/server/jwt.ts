import { jwtVerify } from "jose";
import { z } from "zod/v4";
import {
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
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
  const result = TokenPayloadSchema.safeParse(payload);
  if (!result.success) {
    const error = z.prettifyError(result.error);
    console.warn("Error parsing token payload", error);
    throw new Error("Invalid payload");
  }
  const claims = result.data;
  const persistentId = claims.sub;
  return { persistentId, claims };
}

export async function getUserMe(
  token: string,
  config: ServerConfig,
): Promise<UserMeResponse | false> {
  try {
    // Get the user object
    const response = await fetch(config.jwtIssuer() + "/users/@me", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status !== 200) return false;
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      console.error(
        "Invalid response",
        JSON.stringify(body),
        JSON.stringify(result.error),
      );
      return false;
    }
    return result.data;
  } catch (e) {
    return false;
  }
}

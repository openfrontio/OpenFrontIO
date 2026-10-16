import {
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
import { GameEnv } from "@openfront/shared/configuration/Env";
import { PersistentIdSchema } from "@openfront/shared/WireSchemas";
import { jwtVerify } from "jose";
import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

type TokenVerificationResult =
  | {
      type: "success";
      persistentId: string;
      claims: TokenPayload | null;
    }
  | { type: "error"; message: string };

export async function verifyClientToken(
  token: string,
): Promise<TokenVerificationResult> {
  if (PersistentIdSchema.safeParse(token).success) {
    if (ServerEnv.env() === GameEnv.Dev) {
      return { type: "success", persistentId: token, claims: null };
    } else {
      return {
        type: "error",
        message: "persistent ID not allowed in production",
      };
    }
  }
  try {
    const issuer = ServerEnv.jwtIssuer();
    const audience = ServerEnv.jwtAudience();
    const key = await ServerEnv.jwkPublicKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer,
      audience,
    });
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      return {
        type: "error",
        message: z.prettifyError(result.error),
      };
    }
    const claims = result.data;
    const persistentId = claims.sub;
    return { type: "success", persistentId, claims };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "An unknown error occurred";

    return { type: "error", message };
  }
}

// status is the API's HTTP status; unset for network and parse failures.
export type UserMeError = { type: "error"; status?: number; message: string };

export async function getUserMe(
  token: string,
): Promise<{ type: "success"; response: UserMeResponse } | UserMeError> {
  try {
    // Get the user object
    const response = await fetch(ServerEnv.jwtIssuer() + "/users/@me", {
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (response.status !== 200) {
      return {
        type: "error",
        status: response.status,
        message: `Failed to fetch user me: ${response.statusText}`,
      };
    }
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      return {
        type: "error",
        message: `Invalid response: ${z.prettifyError(result.error)}`,
      };
    }
    return { type: "success", response: result.data };
  } catch (e) {
    return {
      type: "error",
      message: `Failed to fetch user me: ${e}`,
    };
  }
}

// How a join closes when /users/@me fails. A 401/403 is the API rejecting the
// session itself: retrying with the same token cannot succeed, so close with a
// terminal code and let the client send the player back to log in. Anything
// else (5xx, network, bad body) may be transient and stays retryable.
export function userMeFailureClose(error: UserMeError): {
  code: CloseCode;
  reason: CloseReason;
} {
  if (error.status === 401 || error.status === 403) {
    return { code: CloseCode.Unauthorized, reason: CloseReason.InvalidToken };
  }
  return {
    code: CloseCode.InternalError,
    reason: CloseReason.AccountLookupFailed,
  };
}

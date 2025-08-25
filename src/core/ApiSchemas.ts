// This file contains schemas for api.openfront.io

import { z } from "zod";
import { base64urlToUuid } from "./Base64";

export const RefreshResponseSchema = z.object({
  token: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const TokenPayloadSchema = z.object({
  aud: z.string(),
  exp: z.number(),
  iat: z.number(),
  iss: z.string(),
  jti: z.string(),
  sub: z
    .string()
    .refine(
      (val) => {
        const uuid = base64urlToUuid(val);
        return !!uuid;
      },
      {
        message: "Invalid base64-encoded UUID",
      },
    )
    .transform((val) => {
      const uuid = base64urlToUuid(val);
      if (!uuid) throw new Error("Invalid base64 UUID");
      return uuid;
    }),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const UserMeResponseSchema = z.object({
  player: z.object({
    flares: z.string().array().optional(),
    publicId: z.string(),
    roles: z.string().array().optional(),
  }),
  user: z.object({
    avatar: z.string().nullable(),
    discriminator: z.string(),
    global_name: z.string().nullable(),
    id: z.string(),
    locale: z.string().optional(),
    username: z.string(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;

export const StripeCreateCheckoutSessionResponseSchema = z.object({
  client_reference_id: z.string().optional(),
  customer: z.string().optional(),
  id: z.string(),
  metadata: z.partialRecord(z.string(), z.string()),
  object: z.literal("checkout.session"),
  payment_intent: z.string().optional(),
  payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
  status: z.enum(["open", "complete", "expired"]),
  subscription: z.string().optional(),
  url: z.string(),
});
export type StripeCreateCheckoutSessionResponse = z.infer<
  typeof StripeCreateCheckoutSessionResponseSchema
>;

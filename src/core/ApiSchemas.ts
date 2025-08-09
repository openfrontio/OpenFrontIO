// This file contains schemas for api.openfront.io
import { z } from "zod";
import { base64urlToUuid } from "./Base64";

export const RefreshResponseSchema = z.object({
  token: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

/* eslint-disable sort-keys */
export const TokenPayloadSchema = z.object({
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
  iat: z.number(),
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const UserMeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    avatar: z.string().nullable(),
    username: z.string(),
    global_name: z.string().nullable(),
    discriminator: z.string(),
    locale: z.string().optional(),
  }),
  player: z.object({
    publicId: z.string(),
    roles: z.string().array().optional(),
    flares: z.string().array().optional(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;

export const StripeCreateCheckoutSessionResponseSchema = z.object({
  id: z.string(),
  object: z.literal("checkout.session"),
  url: z.string(),
  payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
  status: z.enum(["open", "complete", "expired"]),
  client_reference_id: z.string().optional(),
  customer: z.string().optional(),
  payment_intent: z.string().optional(),
  subscription: z.string().optional(),
  metadata: z.partialRecord(z.string(), z.string()),
});
export type StripeCreateCheckoutSessionResponse = z.infer<
  typeof StripeCreateCheckoutSessionResponseSchema
>;

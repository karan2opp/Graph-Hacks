import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Use both letters and numbers");
const name = z.string().trim().min(2, "Enter your name").max(120);

/** Either start a new firm (`firmName`) or join one with an invite token. */
export const registerBody = z.union([
  z.object({ name, email, password, firmName: z.string().trim().min(2, "Enter your firm or chambers name").max(160) }),
  z.object({ name, email, password, inviteToken: z.string().min(20).max(200) }),
]);

export const loginBody = z.object({ email, password: z.string().min(1, "Enter your password").max(200) });

export const inviteBody = z.object({ email, role: z.enum(["owner", "member"]).default("member") });

export const inviteTokenParams = z.object({ token: z.string().min(20).max(200) });
export const userIdParams = z.object({ userId: z.string().uuid() });

export type RegisterInput = z.infer<typeof registerBody>;
export type LoginInput = z.infer<typeof loginBody>;
export type InviteInput = z.infer<typeof inviteBody>;

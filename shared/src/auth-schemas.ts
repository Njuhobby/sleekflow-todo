import { z } from "zod";

/** Auth shapes (T-7.1) — identity only; the TODO list stays shared (NFR #1). */

export const RegisterSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    name: z.string().trim().min(1).max(100),
    password: z.string().min(8).max(100),
  })
  .strict();
export type Register = z.infer<typeof RegisterSchema>;

export const LoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(1).max(100),
  })
  .strict();
export type Login = z.infer<typeof LoginSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
});
export type User = z.infer<typeof UserSchema>;

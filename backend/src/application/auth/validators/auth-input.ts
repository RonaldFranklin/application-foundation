import { z } from "zod";
export const normalize = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();
function validIdentifier(value: string) {
  return normalize(value).length > 0;
}
export const loginSchema = z
  .object({
    identifier: z.string().min(1).max(254).refine(validIdentifier),
    password: z.string().min(1).max(1024),
    turnstileToken: z.string().max(2048).optional(),
  })
  .strict();
export const passwordSchema = z
  .object({
    password: z
      .string()
      .min(15)
      .max(1024)
      .refine((value) => Array.from(value).length >= 15),
  })
  .strict();
export const codeSchema = z
  .object({ code: z.string().min(6).max(32) })
  .strict();
export const logoutSchema = z
  .object({ forgetDevice: z.boolean().optional() })
  .strict();

const reauthentication = {
  currentPassword: z.string().min(1).max(1024),
  code: z
    .string()
    .regex(/^[0-9]{6}$/)
    .optional(),
};
export const profileSchema = z
  .object({
    ...reauthentication,
    username: z.string().trim().min(1).max(100).refine(validIdentifier),
    email: z.email().max(254),
  })
  .strict();
export const changePasswordSchema = z
  .object({
    ...reauthentication,
    newPassword: passwordSchema.shape.password,
    confirmPassword: z.string().max(1024),
  })
  .strict()
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas devem coincidir.",
  });

export const initialCommonPasswordSchema = z
  .object({
    password: passwordSchema.shape.password,
    confirmPassword: z.string().max(1024),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
  });

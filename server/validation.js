import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128)
}).strict();

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string()
    .min(12, "La contraseña debe tener al menos 12 caracteres.")
    .max(128)
    .regex(/[a-z]/, "Debe incluir una letra minúscula.")
    .regex(/[A-Z]/, "Debe incluir una letra mayúscula.")
    .regex(/[0-9]/, "Debe incluir un número."),
  preferences: z.array(z.string().trim().min(2).max(100)).max(5).default([])
}).strict();

export const trackingSchema = z.object({
  bookId: z.string().trim().min(1).max(100),
  status: z.enum(["Leyendo", "Próximo a leer", "Leído"]),
  rating: z.number().int().min(0).max(5),
  comment: z.string().trim().max(2000),
  format: z.enum(["Físico", "Digital"]),
  startedAt: z.iso.date().nullable(),
  finishedAt: z.iso.date().nullable(),
  readingMinutes: z.number().int().min(0).max(1000000)
}).strict().superRefine((item, context) => {
  if (item.startedAt && item.finishedAt && item.finishedAt < item.startedAt) {
    context.addIssue({
      code: "custom",
      path: ["finishedAt"],
      message: "La fecha de finalización no puede ser anterior al inicio."
    });
  }
});

export function validate(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = new Error("Los datos enviados no son válidos.");
    error.status = 400;
    error.details = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    throw error;
  }
  return result.data;
}

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
  status: z.enum(["Leyendo", "Próximo a leer", "En pausa", "Abandonado", "Leído"]),
  rating: z.number().int().min(0).max(5),
  comment: z.string().trim().max(2000),
  format: z.enum(["Físico", "Digital", "Ambos"]),
  startedAt: z.iso.date().nullable(),
  finishedAt: z.iso.date().nullable(),
  readingProvider: z.enum([
    "Kindle", "Apple Books", "Google Books", "Webtoons", "Otro"
  ]).nullable(),
  currentPage: z.number().int().min(1).max(1000000).nullable()
}).strict().superRefine((item, context) => {
  if (item.startedAt && item.finishedAt && item.finishedAt < item.startedAt) {
    context.addIssue({
      code: "custom",
      path: ["finishedAt"],
      message: "La fecha de finalización no puede ser anterior al inicio."
    });
  }
});

const strongPassword = z.string()
  .min(12, "La contraseña debe tener al menos 12 caracteres.")
  .max(128)
  .regex(/[a-z]/, "Debe incluir una letra minúscula.")
  .regex(/[A-Z]/, "Debe incluir una letra mayúscula.")
  .regex(/[0-9]/, "Debe incluir un número.");

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  avatarUrl: z.union([
    z.url().max(2000).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "La foto debe ser una URL http o https."
    }),
    z.string().max(1_600_000).regex(/^data:image\/(png|jpeg|webp);base64,/),
    z.literal("")
  ]).nullable()
    .transform((value) => value || null),
  language: z.enum(["es", "en", "fr", "de", "it", "pt"]).default("es"),
  preferences: z.array(z.string().trim().min(2).max(100)).max(20).default([]),
  favoriteAuthors: z.array(z.string().trim().min(2).max(180)).max(20).default([]),
  spotifyPlaylistUrl: z.union([
    z.url().max(2000).refine((value) => value.startsWith("https://open.spotify.com/playlist/"), {
      message: "Usa un enlace de playlist de Spotify."
    }),
    z.literal("")
  ]).nullable().optional().default(null).transform((value) => value || null),
  currentPassword: z.string().max(128).optional().default(""),
  newPassword: z.union([strongPassword, z.literal("")]).optional().default("")
}).strict().superRefine((item, context) => {
  if (item.newPassword && !item.currentPassword) {
    context.addIssue({
      code: "custom",
      path: ["currentPassword"],
      message: "Ingresa tu contraseña actual para cambiarla."
    });
  }
});

export const catalogSearchSchema = z.object({
  q: z.string().trim().min(2).max(150),
  language: z.enum(["es", "en", "fr", "de", "it", "pt"]).optional(),
  source: z.enum(["books", "anilist", "all"]).default("all")
}).strict();

export const recommendationSchema = z.object({
  category: z.string().trim().min(2).max(100).optional(),
  language: z.enum(["es", "en", "fr", "de", "it", "pt"]).optional()
}).strict();

export const rankingSchema = z.object({
  source: z.enum(["openlibrary", "nyt"]).default("openlibrary"),
  author: z.string().trim().max(180).optional(),
  category: z.string().trim().max(100).optional(),
  minRating: z.coerce.number().min(0).max(5).default(0),
  year: z.coerce.number().int().min(1931).max(new Date().getFullYear()).optional(),
  language: z.enum(["es", "en", "fr", "de", "it", "pt"]).optional()
}).strict();

export const deleteProfileSchema = z.object({
  password: z.string().min(8).max(128)
}).strict();

export const catalogImportSchema = z.object({
  sourceId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/).max(100),
  source: z.enum(["openlibrary", "anilist"]).default("openlibrary")
}).strict();

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase())
}).strict();

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(200),
  password: strongPassword
}).strict();

export const dashboardFilterSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  format: z.enum(["Físico", "Digital", "Ambos"]).optional(),
  provider: z.enum([
    "Kindle", "Apple Books", "Google Books", "Webtoons", "Otro"
  ]).optional(),
  status: z.enum([
    "Leyendo", "Próximo a leer", "En pausa", "Abandonado", "Leído"
  ]).optional()
}).strict().superRefine((item, context) => {
  if (item.from && item.to && item.to < item.from) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "La fecha final no puede ser anterior a la inicial."
    });
  }
});

export const supportReportSchema = z.object({
  category: z.enum(["Error", "Sugerencia", "Cuenta", "Otro"]),
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(5000),
  steps: z.string().trim().max(3000).optional().default(""),
  page: z.string().trim().max(500).optional().default("")
}).strict();

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

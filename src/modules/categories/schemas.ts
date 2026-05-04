import { z } from "zod";

const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers and hyphens");

const categoryStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const createCategorySchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  icon: z.string().min(1).max(120).optional(),
  status: categoryStatusSchema.optional()
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const patchCategorySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    icon: z.string().min(1).max(120).nullable().optional(),
    status: categoryStatusSchema.optional()
  })
  .refine(
    (o) =>
      o.name !== undefined ||
      o.slug !== undefined ||
      o.icon !== undefined ||
      o.status !== undefined,
    { message: "At least one field is required" }
  );

export type PatchCategoryInput = z.infer<typeof patchCategorySchema>;

export type CategoryStatus = z.infer<typeof categoryStatusSchema>;

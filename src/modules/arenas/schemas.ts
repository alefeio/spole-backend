import { z } from "zod";

const addressSchema = z.object({
  zipCode: z.string().min(1).max(20),
  street: z.string().min(1).max(300),
  number: z.string().min(1).max(80),
  district: z.string().min(1).max(200),
  city: z.string().min(1).max(200),
  state: z.string().min(2).max(2)
});

const policySchema = z.object({
  allowRecurring: z.boolean(),
  minAdvanceHours: z.number().int().min(0).max(24 * 365),
  minReservationPaymentPercent: z.number().int().min(0).max(100)
});

export const createArenaSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  phone: z.string().min(8).max(40),
  email: z.string().email().max(320),
  document: z.string().min(1).max(32),
  address: addressSchema,
  policy: policySchema
});

export type CreateArenaInput = z.infer<typeof createArenaSchema>;

export const patchArenaSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(8000).nullable().optional(),
    phone: z.string().min(8).max(40).optional(),
    email: z.string().email().max(320).optional(),
    document: z.string().min(1).max(32).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    address: addressSchema.partial().optional(),
    policy: policySchema.partial().optional()
  })
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field is required" });

export type PatchArenaInput = z.infer<typeof patchArenaSchema>;

const qEmpty = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

export const listMyArenasQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.preprocess(qEmpty, z.enum(["ACTIVE", "INACTIVE"])).optional(),
  city: z.preprocess(qEmpty, z.string().trim().min(1).max(200)).optional(),
  q: z.preprocess(qEmpty, z.string().trim().min(1).max(200)).optional(),
  sort: z
    .preprocess(qEmpty, z.enum(["name", "createdAt", "updatedAt"]))
    .optional()
    .default("updatedAt"),
  order: z.preprocess(qEmpty, z.enum(["asc", "desc"])).optional().default("desc")
});

export type ListMyArenasQuery = z.infer<typeof listMyArenasQuerySchema>;

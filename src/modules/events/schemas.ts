import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const createEventSchema = z
  .object({
    categoryId: z.string().uuid(),
    title: z.string().min(1).max(300),
    description: z.string().max(8000).optional(),
    type: z.enum(["FREE", "PAID"]),
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    sourceType: z.literal("FREE_LOCATION"),
    status: z.enum(["DRAFT", "PUBLISHED"]),
    startAt: isoDateTime,
    endAt: isoDateTime,
    addressName: z.string().min(1).max(300),
    street: z.string().min(1).max(300),
    number: z.string().min(1).max(80),
    district: z.string().min(1).max(200),
    city: z.string().min(1).max(200),
    state: z.string().min(2).max(2),
    capacity: z.number().int().positive(),
    pricePerPerson: z.number().positive().optional().nullable()
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startAt);
    const end = new Date(data.endAt);
    if (!(end > start)) {
      ctx.addIssue({ code: "custom", path: ["endAt"], message: "endAt must be after startAt" });
    }
    if (data.type === "PAID") {
      if (data.pricePerPerson == null || data.pricePerPerson <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["pricePerPerson"],
          message: "Paid events require pricePerPerson > 0"
        });
      }
    } else if (data.pricePerPerson != null && data.pricePerPerson > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["pricePerPerson"],
        message: "Free events must not set a positive price"
      });
    }
  });

export type CreateEventInput = z.infer<typeof createEventSchema>;

export const patchEventSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(8000).nullable().optional(),
    type: z.enum(["FREE", "PAID"]).optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    startAt: isoDateTime.optional(),
    endAt: isoDateTime.optional(),
    addressName: z.string().min(1).max(300).optional(),
    street: z.string().min(1).max(300).optional(),
    number: z.string().min(1).max(80).optional(),
    district: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(200).optional(),
    state: z.string().min(2).max(2).optional(),
    capacity: z.number().int().positive().optional(),
    pricePerPerson: z.number().nonnegative().nullable().optional()
  })
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field is required" });

export type PatchEventInput = z.infer<typeof patchEventSchema>;

const qEmpty = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

export const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  category: z.preprocess(qEmpty, z.string().uuid()).optional(),
  city: z.preprocess(qEmpty, z.string().min(1).max(200)).optional(),
  dateFrom: z.preprocess(qEmpty, isoDateTime).optional(),
  dateTo: z.preprocess(qEmpty, isoDateTime).optional(),
  type: z.preprocess(qEmpty, z.enum(["FREE", "PAID"])).optional()
});

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

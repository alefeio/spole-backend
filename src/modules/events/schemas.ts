import type { ZodError } from "zod";
import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

const privateCodeSchema = z.string().min(8).max(128);

const priceAndPrivateRefine = (data: { type: string; pricePerPerson?: unknown; visibility: string; privateCode?: unknown }, ctx: z.RefinementCtx) => {
  if (data.type === "PAID") {
    if (data.pricePerPerson == null || Number(data.pricePerPerson) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["pricePerPerson"],
        message: "Paid events require pricePerPerson > 0"
      });
    }
  } else if (data.pricePerPerson != null && Number(data.pricePerPerson) > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["pricePerPerson"],
      message: "Free events must not set a positive price"
    });
  }
  if (data.visibility === "PUBLIC" && data.privateCode != null && String(data.privateCode).trim() !== "") {
    ctx.addIssue({
      code: "custom",
      path: ["privateCode"],
      message: "privateCode must not be set for public events"
    });
  }
};

export const createEventFreeLocationSchema = z
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
    pricePerPerson: z.number().positive().optional().nullable(),
    privateCode: privateCodeSchema.optional()
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startAt);
    const end = new Date(data.endAt);
    if (!(end > start)) {
      ctx.addIssue({ code: "custom", path: ["endAt"], message: "endAt must be after startAt" });
    }
    priceAndPrivateRefine(data, ctx);
  });

export const createEventArenaReservationSchema = z
  .object({
    categoryId: z.string().uuid(),
    reservationId: z.string().uuid(),
    title: z.string().min(1).max(300),
    description: z.string().max(8000).optional(),
    type: z.enum(["FREE", "PAID"]),
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    sourceType: z.literal("ARENA_RESERVATION"),
    status: z.enum(["DRAFT", "PUBLISHED"]),
    capacity: z.number().int().positive(),
    pricePerPerson: z.number().positive().optional().nullable(),
    privateCode: privateCodeSchema.optional()
  })
  .superRefine((data, ctx) => {
    priceAndPrivateRefine(data, ctx);
  });

export type CreateEventFreeLocationInput = z.infer<typeof createEventFreeLocationSchema>;
export type CreateEventArenaReservationInput = z.infer<typeof createEventArenaReservationSchema>;
export type CreateEventInput = CreateEventFreeLocationInput | CreateEventArenaReservationInput;

/** @deprecated use createEventFreeLocationSchema */
export const createEventSchema = createEventFreeLocationSchema;

export function parseCreateEventBody(
  body: unknown
):
  | { success: true; data: CreateEventInput }
  | { success: false; error: ZodError } {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (rec.sourceType === "ARENA_RESERVATION") {
    const r = createEventArenaReservationSchema.safeParse(body);
    return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
  }
  const r = createEventFreeLocationSchema.safeParse(body);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

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
    pricePerPerson: z.number().nonnegative().nullable().optional(),
    privateCode: privateCodeSchema.optional()
  })
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field is required" })
  .superRefine((data, ctx) => {
    if (data.visibility === "PUBLIC" && data.privateCode != null && String(data.privateCode).trim() !== "") {
      ctx.addIssue({
        code: "custom",
        path: ["privateCode"],
        message: "privateCode must not be set when visibility is public"
      });
    }
  });

export type PatchEventInput = z.infer<typeof patchEventSchema>;

const qEmpty = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

export const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  category: z.preprocess(qEmpty, z.string().uuid()).optional(),
  city: z.preprocess(qEmpty, z.string().min(1).max(200)).optional(),
  dateFrom: z.preprocess(qEmpty, isoDateTime).optional(),
  dateTo: z.preprocess(qEmpty, isoDateTime).optional(),
  type: z.preprocess(qEmpty, z.enum(["FREE", "PAID"])).optional(),
  sort: z.preprocess(qEmpty, z.enum(["startAt"])).optional().default("startAt"),
  order: z.preprocess(qEmpty, z.enum(["asc", "desc"])).optional().default("asc")
});

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

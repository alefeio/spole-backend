import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const createSlotSchema = z
  .object({
    startAt: isoDateTime,
    endAt: isoDateTime,
    price: z.number().nonnegative(),
    allowsRecurring: z.boolean(),
    notes: z.string().max(2000).optional()
  })
  .superRefine((data, ctx) => {
    if (new Date(data.endAt) <= new Date(data.startAt)) {
      ctx.addIssue({ code: "custom", path: ["endAt"], message: "endAt must be after startAt" });
    }
  });

export type CreateSlotInput = z.infer<typeof createSlotSchema>;

const qEmpty = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

export const listSlotsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  dateFrom: z.preprocess(qEmpty, isoDateTime).optional(),
  dateTo: z.preprocess(qEmpty, isoDateTime).optional()
});

export type ListSlotsQuery = z.infer<typeof listSlotsQuerySchema>;

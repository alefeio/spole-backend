import { z } from "zod";
import { paginationQuerySchema } from "../../shared/http/pagination";

const qEmpty = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

export const listEventPaymentsQuerySchema = paginationQuerySchema.extend({
  status: z.preprocess(qEmpty, z.enum(["PENDING", "PAID", "FAILED", "CANCELLED"])).optional(),
  sort: z.preprocess(qEmpty, z.enum(["createdAt", "paidAt"])).optional().default("createdAt"),
  order: z.preprocess(qEmpty, z.enum(["asc", "desc"])).optional().default("desc")
});

export type ListEventPaymentsQuery = z.infer<typeof listEventPaymentsQuerySchema>;

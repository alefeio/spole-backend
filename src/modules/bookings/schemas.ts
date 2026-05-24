import { z } from "zod";
import { paginationQuerySchema } from "../../shared/http/pagination";

const qEmpty = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

export const listEventBookingsQuerySchema = paginationQuerySchema.extend({
  status: z.preprocess(qEmpty, z.enum(["RESERVED", "EXPIRED", "CANCELLED", "COMPLETED"])).optional(),
  sort: z.preprocess(qEmpty, z.enum(["reservedAt", "createdAt"])).optional().default("reservedAt"),
  order: z.preprocess(qEmpty, z.enum(["asc", "desc"])).optional().default("desc")
});

export type ListEventBookingsQuery = z.infer<typeof listEventBookingsQuerySchema>;

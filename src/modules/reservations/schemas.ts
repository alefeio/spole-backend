import { z } from "zod";

export const createReservationSchema = z.object({
  slotId: z.string().uuid(),
  type: z.enum(["SINGLE", "RECURRING"])
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

import { z } from "zod";

export const createReservationSchema = z.object({
  slotId: z.string().uuid(),
  type: z.literal("SINGLE")
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export function bookingRedisKey(bookingId: string) {
  return `spole:booking:${bookingId}`;
}

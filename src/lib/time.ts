/**
 * Time zones without a library: scheduling happens in the business's zone
 * (Africa/Casablanca by default, which follows Morocco's own clock changes);
 * the database stores UTC instants.
 */
export const DEFAULT_TIMEZONE = 'Africa/Casablanca';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` at `instant`, in milliseconds (local wall time minus UTC). */
function offsetAt(instant: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-11-10" + "19:00" in `tz` -> the UTC instant. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t || !isValidTimeZone(tz)) throw new Error('Invalid date, time or time zone');
  const [year, month, day, hour, minute] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (hour > 23 || minute > 59 || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new Error('Invalid date or time');
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall - offsetAt(new Date(wall), tz);
  instant = wall - offsetAt(new Date(instant), tz); // second pass across a clock change
  return new Date(instant);
}

export function formatInZone(instant: Date | string | null | undefined, tz: string, withTime = true): string {
  if (!instant) return '—';
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  }).format(value);
}

/** Date and time inputs' values for an instant shown in `tz`. */
export function inputValuesInZone(instant: Date, tz: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** An instant `hours` from now (default schedule suggestion). */
export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}

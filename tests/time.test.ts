import { describe, expect, it } from 'vitest';

import { formatInZone, inputValuesInZone, zonedToUtc } from '@/lib/time';

describe('scheduling time zones', () => {
  it('converts a Casablanca wall time to UTC and back', () => {
    // Morocco is UTC+1 outside Ramadan.
    const instant = zonedToUtc('2026-11-10', '19:00', 'Africa/Casablanca');
    expect(instant.toISOString()).toBe('2026-11-10T18:00:00.000Z');
    expect(inputValuesInZone(instant, 'Africa/Casablanca')).toEqual({ date: '2026-11-10', time: '19:00' });
    expect(formatInZone(instant, 'Africa/Casablanca')).toContain('19:00');
  });

  it('follows the zone it is given', () => {
    expect(zonedToUtc('2026-07-01', '09:30', 'UTC').toISOString()).toBe('2026-07-01T09:30:00.000Z');
    expect(zonedToUtc('2026-07-01', '09:30', 'Europe/Paris').toISOString()).toBe('2026-07-01T07:30:00.000Z');
    expect(() => zonedToUtc('2026-07-01', '25:99', 'UTC')).toThrow();
    expect(() => zonedToUtc('2026-07-01', '10:00', 'Mars/Olympus')).toThrow();
  });
});

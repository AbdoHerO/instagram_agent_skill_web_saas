import { sql } from 'drizzle-orm';

import { getDb } from '@/server/db';

export const dynamic = 'force-dynamic';

/** Liveness and database check for the host (no configuration details). */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}

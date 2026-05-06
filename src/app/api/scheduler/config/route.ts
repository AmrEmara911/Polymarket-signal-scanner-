import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import type { IntervalHours } from '@/lib/scheduler';

const VALID_INTERVALS: IntervalHours[] = [1, 3, 6, 12, 24];

async function readConfig() {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('config')
    .select('key, value')
    .in('key', ['scheduler_interval_hours', 'scheduler_enabled']);

  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  const intervalHours = map.scheduler_interval_hours
    ? (Number(map.scheduler_interval_hours) as IntervalHours)
    : 6;
  const enabled = map.scheduler_enabled !== 'false';
  return { intervalHours, enabled };
}

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json({ success: true, ...config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    // Generic key/value upsert — used for arbitrary config (e.g. filter_sensitivity)
    if (typeof body.key === 'string' && body.value !== undefined) {
      await supabase
        .from('config')
        .upsert({ key: body.key, value: String(body.value), updated_at: now }, { onConflict: 'key' });
      return NextResponse.json({ success: true, key: body.key, value: body.value });
    }

    // Scheduler-specific config
    const intervalHours: IntervalHours = VALID_INTERVALS.includes(body.intervalHours)
      ? body.intervalHours
      : 6;
    const enabled: boolean = body.enabled !== false;

    await supabase.from('config').upsert(
      [
        { key: 'scheduler_interval_hours', value: String(intervalHours), updated_at: now },
        { key: 'scheduler_enabled', value: String(enabled), updated_at: now },
      ],
      { onConflict: 'key' }
    );

    // Restart the in-process scheduler with the new config immediately
    const { restartScheduler } = await import('@/lib/scheduler');
    restartScheduler(intervalHours, enabled);

    return NextResponse.json({ success: true, intervalHours, enabled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

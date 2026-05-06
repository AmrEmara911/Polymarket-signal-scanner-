import { NextResponse } from 'next/server';
import { getSchedulerState } from '@/lib/scheduler';

export async function GET() {
  const state = getSchedulerState();
  return NextResponse.json({
    status: state.enabled ? 'running' : 'paused',
    intervalHours: state.intervalHours,
    schedule: state.enabled
      ? `Every ${state.intervalHours} hour${state.intervalHours === 1 ? '' : 's'}`
      : 'Manual only',
    next_run: state.nextRunAt,
    last_run: state.lastRunAt,
    message: 'Pipeline runs automatically: ingest → analyze → report',
  });
}

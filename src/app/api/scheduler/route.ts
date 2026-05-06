import { NextResponse } from 'next/server';

function getNextRunTime(): string {
  const now = new Date();
  const next = new Date(now);
  const currentHour = now.getUTCHours();
  const nextHour = Math.ceil((currentHour + 1) / 6) * 6;

  if (nextHour >= 24) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
  } else {
    next.setUTCHours(nextHour, 0, 0, 0);
  }

  return next.toISOString();
}

export async function GET() {
  return NextResponse.json({
    status: 'running',
    schedule: 'every 6 hours at 00:00, 06:00, 12:00, 18:00 UTC',
    next_run: getNextRunTime(),
    message: 'Pipeline runs automatically: ingest → analyze → report',
  });
}

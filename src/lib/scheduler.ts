import cron from 'node-cron';

export const INTERVAL_OPTIONS = [1, 3, 6, 12, 24] as const;
export type IntervalHours = (typeof INTERVAL_OPTIONS)[number];

const CRON_EXPRESSIONS: Record<IntervalHours, string> = {
  1:  '0 * * * *',
  3:  '0 */3 * * *',
  6:  '0 */6 * * *',
  12: '0 */12 * * *',
  24: '0 0 * * *',
};

let currentTask: ReturnType<typeof cron.schedule> | null = null;
let currentIntervalHours: IntervalHours = 6;
let schedulerEnabled = true;
let isInitialized = false;
let lastRunAt: string | null = null;

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

async function runPipeline() {
  lastRunAt = new Date().toISOString();
  console.log('[Scheduler] Running pipeline at', lastRunAt);
  const base = getBaseUrl();

  try {
    const pipelineRes = await fetch(`${base}/api/pipeline`, { method: 'POST', cache: 'no-store' });
    const pipelineData = await pipelineRes.json();
    if (!pipelineData.success) {
      throw new Error(pipelineData.error ?? 'Pipeline failed');
    }
    console.log(
      '[Scheduler] Pipeline complete:',
      pipelineData.markets_ingested,
      'ingested,',
      pipelineData.markets_analyzed,
      'analyzed,',
      pipelineData.relevant_signals,
      'relevant, report:',
      pipelineData.report_id ?? '(none)'
    );
  } catch (error) {
    console.error('[Scheduler] Pipeline error:', error);
  }
}

export function calcNextRun(intervalHours: IntervalHours): Date {
  const now = new Date();
  const msPerHour = 60 * 60 * 1000;
  const intervalMs = intervalHours * msPerHour;
  // Align to interval boundaries from UTC midnight
  const msSinceMidnight = now.getTime() % (24 * msPerHour);
  const intervalsSinceMidnight = Math.floor(msSinceMidnight / intervalMs);
  const nextIntervalMs = (intervalsSinceMidnight + 1) * intervalMs;
  const todayMidnight = new Date(now);
  todayMidnight.setUTCHours(0, 0, 0, 0);
  return new Date(todayMidnight.getTime() + nextIntervalMs);
}

export function getSchedulerState() {
  return {
    intervalHours: currentIntervalHours,
    enabled: schedulerEnabled,
    lastRunAt,
    nextRunAt: schedulerEnabled ? calcNextRun(currentIntervalHours).toISOString() : null,
  };
}

export function restartScheduler(intervalHours: IntervalHours, enabled: boolean) {
  currentIntervalHours = intervalHours;
  schedulerEnabled = enabled;

  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  if (!enabled) {
    console.log('[Scheduler] Auto-run disabled — manual only');
    return;
  }

  const expression = CRON_EXPRESSIONS[intervalHours];
  console.log(`[Scheduler] Running every ${intervalHours}h (${expression})`);
  currentTask = cron.schedule(expression, runPipeline);
}

export async function startScheduler() {
  if (isInitialized) return;
  isInitialized = true;

  console.log('[Scheduler] Initializing...');

  try {
    const res = await fetch(`${getBaseUrl()}/api/scheduler/config`);
    if (res.ok) {
      const data = await res.json();
      currentIntervalHours = (data.intervalHours as IntervalHours) ?? 6;
      schedulerEnabled = data.enabled ?? true;
    }
  } catch {
    console.log('[Scheduler] Could not read config, using defaults (6h, enabled)');
  }

  restartScheduler(currentIntervalHours, schedulerEnabled);
  console.log(`[Scheduler] Started — every ${currentIntervalHours}h, enabled: ${schedulerEnabled}`);
}

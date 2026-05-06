import cron from 'node-cron';

let isSchedulerRunning = false;

export function startScheduler() {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;

  console.log('[Scheduler] Starting — runs every 6 hours');

  // Run every 6 hours: at 00:00, 06:00, 12:00, 18:00
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Scheduler] Running pipeline at', new Date().toISOString());

    try {
      // Step 1: Ingest new markets
      const ingestRes = await fetch('http://localhost:3000/api/ingest');
      const ingestData = await ingestRes.json();
      console.log('[Scheduler] Ingested:', ingestData.count, 'markets');

      // Step 2: Analyze with LLM
      const analyzeRes = await fetch('http://localhost:3000/api/analyze');
      const analyzeData = await analyzeRes.json();
      console.log('[Scheduler] Analyzed:', analyzeData.analyzed, 'markets,', analyzeData.relevant, 'relevant');

      // Step 3: Generate report if there are relevant signals
      if (analyzeData.relevant > 0) {
        const reportRes = await fetch('http://localhost:3000/api/report');
        const reportData = await reportRes.json();
        console.log('[Scheduler] Report generated:', reportData.id);
      }
    } catch (error) {
      console.error('[Scheduler] Pipeline error:', error);
    }
  });

  console.log('[Scheduler] Next run at next 6-hour mark (00/06/12/18 UTC)');
}

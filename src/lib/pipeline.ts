import { analyzeMarkets } from './filter';
import { fetchAndStoreMarkets } from './polymarket';
import { generateSignalReport } from './reports';
import { getSupabaseClient } from './supabase';

export interface PipelineResult {
  run_id: string | null;
  markets_ingested: number;
  markets_analyzed: number;
  relevant_signals: number;
  report_id: string | null;
  warning?: string;
}

export async function runPipeline(): Promise<PipelineResult> {
  const supabase = getSupabaseClient();
  const startedAt = new Date().toISOString();

  const { data: run, error: runError } = await supabase
    .from('pipeline_runs')
    .insert({
      kind: 'scheduled',
      status: 'running',
      started_at: startedAt,
    })
    .select('id')
    .single();

  const warning = runError
    ? `Pipeline run history was skipped: ${runError.message}`
    : undefined;

  try {
    const marketsIngested = await fetchAndStoreMarkets();
    const analysis = await analyzeMarkets(100);
    const report = await generateSignalReport();

    if (run?.id) {
      await supabase
        .from('pipeline_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          markets_ingested: marketsIngested,
          markets_analyzed: analysis.analyzed,
          relevant_signals: analysis.relevant,
          report_id: report?.id ?? null,
        })
        .eq('id', run.id);
    }

    return {
      run_id: run?.id ?? null,
      markets_ingested: marketsIngested,
      markets_analyzed: analysis.analyzed,
      relevant_signals: analysis.relevant,
      report_id: report?.id ?? null,
      warning,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown pipeline error';

    if (run?.id) {
      await supabase
        .from('pipeline_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: message,
        })
        .eq('id', run.id);
    }

    throw error;
  }
}

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Calls record_cron_heartbeat in Postgres. Safe to call from any cron-driven
// edge function — never throws; logs and swallows errors so a heartbeat write
// failure can't break the actual job. Heartbeat rows must already exist in
// cron_job_runs (seeded in the migration); calling with an unknown jobName
// silently no-ops, which is intentional.
export async function recordHeartbeat(
  supabase: SupabaseClient,
  jobName: string,
  status: 'ok' | 'error',
  errorMessage?: string,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_cron_heartbeat', {
      p_job: jobName,
      p_status: status,
      p_error: errorMessage ?? null,
    });
    if (error) {
      console.warn(`[heartbeat] ${jobName} ${status} write failed:`, error.message);
    }
  } catch (err) {
    console.warn(`[heartbeat] ${jobName} ${status} write threw:`, err);
  }
}

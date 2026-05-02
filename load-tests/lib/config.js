// Centralized config for k6 load tests.
// Required env vars (pass via -e KEY=val or K6_KEY env):
//   SUPABASE_URL, ANON_KEY
// Optional:
//   SB_SECRET_KEY (required for live-scoring publisher VUs)

const required = (name) => {
  const v = __ENV[name];
  if (!v) throw new Error(`Missing required env var: ${name}. Pass via -e ${name}=...`);
  return v;
};

export const SUPABASE_URL = required('SUPABASE_URL');
export const ANON_KEY = required('ANON_KEY');
export const SB_SECRET_KEY = __ENV.SB_SECRET_KEY ?? null;

export const PROJECT_HOST = SUPABASE_URL.replace(/^https?:\/\//, '');
export const WSS_URL = `wss://${PROJECT_HOST}/realtime/v1/websocket?apikey=${ANON_KEY}&vsn=1.0.0`;

export const TEST_LEAGUE_NAME = '__TEST__ Franchise Mutations';
export const WATCHER_EMAIL = 'jjspoels@gmail.com';
export const BOT_PASSWORD = 'TestBot!Mutations2026';
export const BOT_EMAILS = [
  'bot1@test.franchise.local',
  'bot2@test.franchise.local',
  'bot3@test.franchise.local',
  'bot4@test.franchise.local',
];

export const LOADTEST_MARKER = '__loadtest__';

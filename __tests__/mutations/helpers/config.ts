import fs from 'node:fs';
import path from 'node:path';

function loadDotEnvLocal() {
  const envPath = path.resolve(__dirname, '../../../.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

loadDotEnvLocal();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}. Check .env.local.`);
  return v;
}

export const SUPABASE_URL = required('EXPO_PUBLIC_SUPABASE_URL');
export const PUBLISHABLE_KEY = required('EXPO_PUBLIC_SB_PUBLISHABLE_KEY');
export const SECRET_KEY = required('SB_SECRET_KEY');

export const TEST_LEAGUE_NAME = '__TEST__ Franchise Mutations';
export const TEST_LEAGUE_SEASON = '2026-27';
export const WATCHER_EMAIL = 'jjspoels@gmail.com';
export const BOT_PASSWORD = 'TestBot!Mutations2026';
export const BOT_COUNT = 4;
export const BOT_EMAIL = (n: number) => `bot${n}@test.franchise.local`;
export const BOT_TEAM_NAME = (n: number) => `Test Bot ${n}`;
export const WATCHER_TEAM_NAME = 'Joe (watcher)';

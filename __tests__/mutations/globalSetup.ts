import { bootstrapTestLeague } from './helpers/bootstrap';

export default async function globalSetup() {
  const result = await bootstrapTestLeague();
  // Stash handle on a module-level var so individual tests can re-load it via helpers.
  // (Jest workers don't share memory, so we rely on each test calling bootstrap again —
  // which is cheap once the league exists because bootstrap is idempotent.)
  console.log(`[mutations] Test league ready: ${result.leagueId} (${result.teams.length} teams)`);
}

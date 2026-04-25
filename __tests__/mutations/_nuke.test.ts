import { nukeTestLeague } from './helpers/cleanup';
import { nukeLifecycleLeague } from './helpers/lifecycle';

// Runs via `npm run test:integration:nuke` (uses jest.nuke.config.js which bypasses globalSetup).
// Excluded from the normal integration suite by testPathIgnorePatterns.
test('nuke test league', async () => {
  await nukeTestLeague();
}, 60_000);

test('nuke lifecycle leagues', async () => {
  await nukeLifecycleLeague('dynasty');
  await nukeLifecycleLeague('keeper');
  await nukeLifecycleLeague('redraft');
}, 90_000);

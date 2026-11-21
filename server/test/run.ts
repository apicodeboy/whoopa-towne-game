// the game server under test: economy in memory, test payments on
process.env.ECONOMY_DB = ':memory:';
process.env.ECONOMY_TEST_PAYMENTS = '1';
// (the tests never ask the real scores feed)
process.env.SCORES = 'off';
await import('./scores.test.ts');
await import('./economy.test.ts');
await import('./net.test.ts');
import { runAll } from '../../shared/test/harness.ts';

await runAll(process.argv[2]);
process.exit(0);

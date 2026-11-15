import './movement.test';
import './combat.test';
import './bots.test';
import { runAll } from './harness';

await runAll(process.argv[2]);

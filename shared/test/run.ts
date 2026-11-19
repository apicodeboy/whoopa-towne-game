import './movement.test';
import './moves.test';
import './combat.test';
import './bots.test';
import './appearance.test';
import './porch.test';
import './ajs.test';
import './buildings.test';
import { runAll } from './harness';

await runAll(process.argv[2]);

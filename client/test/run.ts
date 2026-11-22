import './governor.test';
import './bindings.test';
import { runAll } from '../../shared/test/harness';

await runAll(process.argv[2]);

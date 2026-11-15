import './net.test.ts';
import { runAll } from '../../shared/test/harness.ts';

await runAll(process.argv[2]);
process.exit(0);

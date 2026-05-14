import { runJsonDbDoctor } from '../../doctor.js';
import { printDoctorResult } from '../output.js';

export async function runDoctor(config, args) {
  const result = await runJsonDbDoctor(config);

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printDoctorResult(result);
  }

  if (result.summary.error > 0 || (args.includes('--strict') && result.summary.warn > 0)) {
    process.exitCode = 1;
  }
}

// Every scenario must end by asking RotorHazard, not Grid, whether the write landed (#31):
// a call on the `rh` page objects or a readback through the rig's API.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('./specs/', import.meta.url).pathname;
const AGREES =
  /\brh\.\w+\(|\brig\.(pilots|heats|classes|formats|options|frequencies|race|rounds|status)\(/;
let bad = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.spec.ts'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  if (!AGREES.test(src)) {
    console.error(`${f}: no RotorHazard-agrees step (rh.* or a rig readback)`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log('every spec has a RotorHazard-agrees step');

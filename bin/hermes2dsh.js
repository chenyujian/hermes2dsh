#!/usr/bin/env node
import { run } from '../src/cli.js';

run(process.argv.slice(2)).catch((err) => {
  console.error(`hermes2dsh: ${err.message || err}`);
  process.exit(1);
});

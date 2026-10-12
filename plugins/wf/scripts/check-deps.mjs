#!/usr/bin/env node
/**
 * Report which wf dependencies are present and how to install the ones that are not.
 * Run before designing a workflow: a missing tool changes what the workflow can contain,
 * and finding out at generation time is cheaper than finding out at run time.
 * Usage: node check-deps.mjs
 * Exit:  0 all required present · 1 a required dependency is missing
 */
import { probe } from './design/deps-file.mjs';
import { report } from './design/deps.mjs';

const { lines, missingRequired } = report(probe());
process.stdout.write(`${lines.join('\n')}\n`);
process.exitCode = missingRequired > 0 ? 1 : 0;

#!/usr/bin/env node
/**
 * PreToolUse(Bash|PowerShell): before `bd close`, verify the documents that declare each ticket being
 * closed — axis coverage, the preview's existence, and the project's invariants.
 * A ticket no document declares passes.
 * Stdin: the hook payload. Exit: 0 pass · 2 a check failed, the close is blocked.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { preClose, runHook } from './lib/hooks.mjs';

runHook(preClose, resolve(dirname(fileURLToPath(import.meta.url)), '..'));

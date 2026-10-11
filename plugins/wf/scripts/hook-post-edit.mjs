#!/usr/bin/env node
/**
 * PostToolUse(Write|Edit): after a document under a stage's `artifact.dirs` is written, verify
 * its citations (exit 2, reported back to the model) and flag unproven absence claims and a
 * missing frontmatter declaration (advisory, in additionalContext).
 * Stdin: the hook payload. Exit: 0 pass · 2 an unverifiable citation.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { postEdit, runHook } from './lib/hooks.mjs';

runHook(postEdit, resolve(dirname(fileURLToPath(import.meta.url)), '..'));

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseReport } from './report-parse.js';

/**
 * oc-delegate.sh 경로를 받아 runWorker(spec, sessionDir) 를 만든다.
 * child exit = 완료 신호, stdout = 7줄 리포트 (report.txt 로 저장).
 */
export function makeRunWorker(delegatePath, timeout) {
  return (spec, sessionDir) =>
    new Promise((resolve) => {
      mkdirSync(sessionDir, { recursive: true });
      const args = ['--dir', spec.dir, '--prompt-file', spec.prompt_file,
                    '--session-dir', sessionDir, '--title', spec.id];
      if (timeout) args.push('--timeout', String(timeout));
      const child = spawn(delegatePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => {
        writeFileSync(`${sessionDir}/report.txt`, out);
        resolve({ ...parseReport(out), exit_code: code });
      });
      child.on('error', (err) => {
        resolve({ status: 'error', session: sessionDir,
                  notes: `spawn failed: ${err.message}`, exit_code: -1 });
      });
    });
}

#!/usr/bin/env node
/**
 * 지연 후 orca 탭 하나를 닫는다. `cli.mjs` 의 `scheduleSelfClose` 가 분리 실행으로 띄운다.
 *
 * 부모(인계를 보낸 claude 세션)와 같은 프로세스 트리 안에서 돌면 자기를 죽이는 명령을 자기가
 * 기다리는 꼴이 되므로, 이 파일은 **반드시 분리된 프로세스로** 돈다. 그래서 부모가 사라진 뒤에도
 * 살아 있어야 하고, 부모의 stdout 에 아무것도 쓰지 않는다 — 결과는 로그 파일에만 남는다.
 *
 * 사용법: node close-tab.mjs --terminal <handle> --delay-ms <n>
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './cli.mjs';
import { stateRoot } from './state-root.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const handle = flags.terminal && String(flags.terminal);
const delayMs = Number(flags['delay-ms']);

if (!handle || !Number.isFinite(delayMs)) {
  console.error('사용법: node close-tab.mjs --terminal <handle> --delay-ms <n>');
  process.exit(2);
}

/**
 * 탭이 안 닫히는 실패는 조용하다 — 탭이 그대로 남아 있을 뿐이라 이유를 되짚을 단서가 없다.
 * 부모가 죽은 뒤에 일어나는 일이므로 stderr 도 받을 곳이 없어, 파일이 유일한 기록이다.
 */
function log(line) {
  const dir = path.join(stateRoot(), 'session-handoff');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'close-tab.log'), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // 로그를 못 남기는 것이 탭 닫기를 막을 이유는 안 된다.
  }
}

setTimeout(() => {
  try {
    execFileSync('orca', ['terminal', 'close', '--terminal', handle, '--tab', '--json'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    log(`closed ${handle}`);
  } catch (e) {
    const detail = [e.stdout, e.stderr].filter(Boolean).join(' ').trim() || e.message;
    log(`FAILED ${handle}: ${detail.replace(/\s+/g, ' ').slice(0, 300)}`);
    process.exit(5);
  }
}, delayMs);

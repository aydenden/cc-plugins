/**
 * @module render
 * ANSI 기반 workflow 상태 렌더러. 의존성 없음 (순수 Node.js).
 * TTY 환경: alternate screen + 커서 숨김. 비-TTY: 평문 출력.
 */

const ESC = '\x1b[';
const C = {
  reset: ESC + '0m', bold: ESC + '1m', dim: ESC + '2m',
  green: ESC + '32m', yellow: ESC + '33m', cyan: ESC + '36m',
};

/**
 * 진행 바 문자열을 반환한다. done+failed 비율만큼 채운다.
 * @param {number} done - 완료된 작업 수
 * @param {number} failed - 실패한 작업 수
 * @param {number} total - 전체 작업 수
 * @param {number} [width=20] - 바 너비 (문자 단위)
 * @returns {string} 진행 바 문자열
 */
export function bar(done, failed, total, width = 20) {
  const filled = total ? Math.round(((done + failed) / total) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

/**
 * 단일 phase 상태를 한 줄 ANSI 문자열로 만든다.
 * @param {{phaseId:string, done:number, failed:number, total:number, running:number, queued:number}} p
 * @returns {string}
 */
function phaseLine(p) {
  const color = p.failed ? C.yellow : p.done === p.total ? C.green : C.cyan;
  return `${color}${String(p.phaseId).padEnd(12)} ${bar(p.done, p.failed, p.total)} `
    + `${p.running} run · ${p.queued} queue · ${p.done} done · ${p.failed} fail${C.reset}`;
}

/**
 * 현재 상태를 한 프레임(여러 줄 문자열)으로 만든다. 순수 함수.
 * @param {{phases: Array<{phaseId:string, total:number, done:number, failed:number, running:number, queued:number}>, narrator?: string}} s
 * @returns {string} 렌더링된 프레임 문자열
 */
export function frame(s) {
  const lines = [`${C.bold}OC cmux Workflow${C.reset}`];
  for (const p of s.phases) lines.push(phaseLine(p));
  lines.push(`${C.dim}${s.narrator || ''}${C.reset}`);
  return lines.join('\n');
}

/**
 * getState 를 주기적으로 읽어 화면을 다시 그린다. 입력은 받지 않는다.
 * TTY 면 alternate screen + 커서 숨김, unmount 시 복원. 비-TTY 면 평문 출력.
 * @param {() => {phases:Array, narrator?:string}} getState - 현재 상태 반환 함수
 * @param {{interval?: number, stream?: NodeJS.WriteStream}} [opts]
 * @returns {() => void} unmount — 렌더 중지 + 터미널 복원
 */
export function startRender(getState, { interval = 120, stream = process.stdout } = {}) {
  const tty = Boolean(stream.isTTY);
  if (tty) stream.write(ESC + '?1049h' + ESC + '?25l'); // alt screen + hide cursor
  const draw = () => {
    const text = frame(getState());
    if (tty) stream.write(ESC + 'H' + ESC + '2J' + text); // home + clear + frame
    else stream.write(text + '\n');
  };
  draw();
  const id = setInterval(draw, interval);
  return () => {
    clearInterval(id);
    draw(); // 최종 상태 1회
    if (tty) stream.write('\n' + ESC + '?25h' + ESC + '?1049l'); // restore
  };
}

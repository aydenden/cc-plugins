/**
 * 환경·커스텀 위젯 — 작업 디렉터리, 터미널 폭, 메모리, 사용자가 적은 글자·명령·링크.
 *
 * `separator` 와 `flex-separator` 는 위젯이 아니라 배치 규칙이라 `layout.mjs` 가 직접 다룬다.
 */

import { formatGigabytes, tildePath } from '../format.mjs';

/** @type {Record<string, import('./index.mjs').Widget>} */
export const ENV_WIDGETS = {
  'current-working-dir': {
    category: 'env',
    needs: ['session'],
    render: (snap) => (snap.session?.cwd ? { label: 'cwd: ', value: tildePath(snap.session.cwd, snap.home) } : null),
  },
  'terminal-width': {
    category: 'env',
    needs: [],
    render: (snap) => (snap.columns ? { label: 'Width: ', value: String(snap.columns) } : null),
  },
  'free-memory': {
    category: 'env',
    needs: ['memory'],
    render: (snap) => {
      const memory = snap.memory;
      if (!memory) return null;
      return { label: 'Mem: ', value: `${formatGigabytes(memory.usedBytes)}/${formatGigabytes(memory.totalBytes)}` };
    },
  },
  'custom-text': {
    category: 'custom',
    needs: [],
    render: (snap, item) => (item.text ? { label: '', value: item.text } : null),
  },
  'custom-symbol': {
    category: 'custom',
    needs: [],
    render: (snap, item) => (item.symbol ? { label: '', value: item.symbol } : null),
  },
  'custom-command': {
    category: 'custom',
    needs: ['custom'],
    render: (snap, item) => {
      const output = item.id ? snap.custom?.[item.id] : undefined;
      return output ? { label: '', value: output } : null;
    },
  },
  link: {
    category: 'custom',
    needs: [],
    render: (snap, item) => (item.url ? { label: '', value: item.text ?? item.url, url: item.url } : null),
  },
};

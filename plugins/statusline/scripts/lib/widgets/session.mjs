/**
 * Claude·세션 위젯 — 모델, 버전, 세션 id·이름, 노력 수준, 출력 스타일, 비용, 경과 시간 등.
 *
 * 위젯은 `(snap, item) => { label, value } | null` 이다. null 은 «보일 값이 없다» 이고 그 칸은 그리지 않는다.
 */

import { formatDuration, formatMoney, prettyModel } from '../format.mjs';

const onOff = (flag) => (flag ? 'on' : 'off');

/** @type {Record<string, import('./index.mjs').Widget>} */
export const SESSION_WIDGETS = {
  model: {
    category: 'session',
    needs: ['session'],
    render: (snap) => (snap.session?.model ? { label: 'Model: ', value: prettyModel(snap.session.model) } : null),
  },
  version: {
    category: 'session',
    needs: ['session'],
    render: (snap) => (snap.session?.version ? { label: 'Version: ', value: snap.session.version } : null),
  },
  'claude-session-id': {
    category: 'session',
    needs: ['session'],
    render: (snap) => (snap.session?.id ? { label: 'Session ID: ', value: snap.session.id } : null),
  },
  'session-name': {
    category: 'session',
    needs: ['transcript'],
    render: (snap) => {
      const name = snap.session?.name ?? snap.transcript?.customTitle ?? snap.transcript?.aiTitle;
      return name ? { label: 'Session: ', value: name } : null;
    },
  },
  'claude-account-email': {
    category: 'session',
    needs: ['account'],
    render: (snap) => (snap.account?.email ? { label: 'Account: ', value: snap.account.email } : null),
  },
  'claude-status': {
    category: 'session',
    needs: ['status'],
    render: (snap) => {
      const indicator = snap.status?.indicator;
      if (!indicator) return null;
      return { label: 'Claude: ', value: indicator === 'none' ? 'ok' : indicator };
    },
  },
  'thinking-effort': {
    category: 'session',
    needs: ['settings'],
    render: (snap) => {
      const effort = snap.session?.effort ?? snap.transcript?.effort ?? snap.settings?.effortLevel;
      return effort ? { label: 'Effort: ', value: String(effort) } : null;
    },
  },
  'output-style': {
    category: 'session',
    needs: ['configRows'],
    render: (snap, item) => {
      const style = snap.configRows?.outputStyle;
      if (style === undefined || style === null) return null;
      if (style === 'default' && !item.showZero) return null;
      return { label: 'Style: ', value: String(style) };
    },
  },
  // 실시간 INSERT/NORMAL 은 mod 가 읽을 곳이 없다. 편집기 모드 설정(normal/vim)만 보인다.
  'vim-mode': {
    category: 'session',
    needs: ['configRows'],
    render: (snap) => {
      const editor = snap.configRows?.editor;
      return editor && editor !== 'normal' ? { label: 'Editor: ', value: String(editor) } : null;
    },
  },
  'voice-status': {
    category: 'session',
    needs: ['settings'],
    render: (snap) => (snap.settings ? { label: 'voice ', value: onOff(snap.settings.voice?.enabled === true) } : null),
  },
  'sandbox-status': {
    category: 'session',
    needs: ['settings'],
    render: (snap) => (snap.settings ? { label: 'SB: ', value: snap.settings.sandbox?.enabled === true ? 'ON' : 'OFF' } : null),
  },
  'remote-control-status': {
    category: 'session',
    needs: ['configRows'],
    render: (snap) => {
      const remote = snap.configRows?.remoteControl;
      if (remote === undefined || remote === null) return null;
      return { label: 'RC: ', value: typeof remote === 'boolean' ? onOff(remote) : String(remote) };
    },
  },
  skills: {
    category: 'session',
    needs: [],
    render: (snap) => {
      const skills = snap.skills;
      if (!skills || skills.count === 0) return null;
      return { label: 'Skill: ', value: skills.count > 1 ? `${skills.last} ×${skills.count}` : skills.last };
    },
  },
  'session-clock': {
    category: 'session',
    needs: ['usage', 'clock'],
    render: (snap, item) => {
      const startedAt = snap.usage?.startedAt;
      if (!startedAt || !snap.now) return null;
      const elapsed = snap.now - startedAt;
      if (elapsed < 60_000 && !item.showZero) return null;
      return { label: 'Session: ', value: formatDuration(elapsed) };
    },
  },
  'session-cost': {
    category: 'session',
    needs: ['usage'],
    render: (snap, item) => {
      const usd = snap.usage?.cost?.usd;
      if (typeof usd !== 'number') return null;
      if (usd === 0 && !item.showZero) return null;
      return { label: 'Cost: ', value: formatMoney(usd) };
    },
  },
};

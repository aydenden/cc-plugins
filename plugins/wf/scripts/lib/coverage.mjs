/**
 * Verifies that a definition document addresses every axis of its stage. The other checks
 * validate what was produced; this one catches what was never considered. Pure.
 *
 * Two things are enforced, and they fail differently:
 *   UNADDRESSED  the axis has no row at all — nobody looked at it
 *   INCOMPLETE   the row exists but carries no source, or claims "해당 없음" with no reason
 * A row is a table row whose first cell is the axis id. A mention anywhere else is not a row:
 * ids like `state` or `scope` are ordinary words, and one use in prose would pass the axis.
 * The rule is owned by `references/axis-patterns.md`.
 *
 * Copied into every generated plugin, so it uses `node:` builtins only.
 */
import { RESERVED_AXIS_ID } from './spec.mjs';

/** Cells of a table row, or null when the line is not one. Emphasis around a cell is dropped. */
function tableCells(line) {
  if (!/^\s*\|/.test(line)) return null;
  const cells = line.trim().split(/(?<!\\)\|/).slice(1);
  // Drop only the field after the closing pipe, so an empty last cell stays visible.
  if (line.trimEnd().endsWith('|')) cells.pop();
  return cells.map((cell) => cell.trim().replace(/^[*`_]+|[*`_]+$/g, '').trim());
}

/** Why a row does not close its axis, or null when it does. `rest` are the cells after the id. */
function rowDefect(rest) {
  if (rest.length === 0) return '판정 칸이 없다 — 정의와 출처를 적는다';
  if (rest.some((cell) => cell === '')) return '빈 칸이 있다 — 출처 없는 판정은 미결이다';
  const joined = rest.join(' ');
  if (/해당 ?없음/.test(joined)) {
    const reason = joined.replace(/해당 ?없음/g, '').replace(/[-—–:.,()/\s*`_]/g, '');
    if (reason === '') return '"해당 없음"에 사유가 없다 — 찾아본 결과를 적는다';
  }
  return null;
}

/**
 * Axes a document fails to address. The built-in `unlisted` axis is always asked in addition to
 * the listed ones.
 *
 * @param {string[]} axisIds ids of the stage's axes, from the spec
 * @param {string} text the document
 * @returns {{axis: string, verdict: 'UNADDRESSED'|'INCOMPLETE', detail: string}[]} in axis order
 */
export function coverageFindings(axisIds, text) {
  const rows = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const cells = tableCells(line);
    if (cells && cells.length > 0 && !rows.has(cells[0])) rows.set(cells[0], cells.slice(1));
  }
  const findings = [];
  for (const axis of [...axisIds, RESERVED_AXIS_ID]) {
    const rest = rows.get(axis);
    if (rest === undefined) {
      findings.push({ axis, verdict: 'UNADDRESSED', detail: '' });
      continue;
    }
    const defect = rowDefect(rest);
    if (defect) findings.push({ axis, verdict: 'INCOMPLETE', detail: defect });
  }
  return findings;
}

/**
 * The lines a coverage run prints and whether it blocks.
 *
 * @param {{artifact: string, axisIds: string[], findings: {axis: string, verdict: string, detail: string}[], bypassed?: string[]}} args
 *   `artifact` is the document path as shown to the reader; `bypassed` are axis ids a bypass let through
 * @returns {{lines: string[], failed: boolean}}
 */
export function coverageReport({ artifact, axisIds, findings, bypassed = [] }) {
  const skipped = new Set(bypassed);
  const open = findings.filter((finding) => !skipped.has(finding.axis));
  const total = axisIds.length + 1;
  const lines = open.map(({ axis, verdict, detail }) => (detail ? `${verdict} ${axis} — ${detail}` : `${verdict} ${axis}`));
  lines.push(`check-coverage: ${total - open.length}/${total} axes addressed in ${artifact}`);
  if (open.length > 0) {
    lines.push('An axis with no row is an axis nobody looked at; a row with no source is a verdict nobody can check.');
    lines.push('Add the row, or mark it 해당 없음 with what was searched and not found.');
  }
  return { lines, failed: open.length > 0 };
}

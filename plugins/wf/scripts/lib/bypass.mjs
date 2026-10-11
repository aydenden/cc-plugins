/**
 * Decides which failing targets of a check a bypass marker lets through. Pure — the marker and
 * the log are read and written by `bypass-file.mjs`.
 *
 * A bypass is per target: the marker line `<target>: <why>, <ticket>` passes only the axis id or
 * cited path it names. The rule is owned by `references/evidence-patterns.md`.
 *
 * Copied into every generated plugin, so it uses `node:` builtins only.
 */

/** Marker path, relative to the project root. */
export const MARKER_PATH = '.claude/wf-skip-checks';

const MARKER_FORMAT = '<target>: <why>, <ticket>';

/**
 * Splits marker text into bypass lines.
 *
 * @param {string} text marker file content
 * @returns {{entries: {target: string, line: string}[], malformed: string[]}}
 *   `entries` name a target and give a reason; `malformed` are non-blank lines that do not
 */
export function parseMarker(text) {
  const entries = [];
  const malformed = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    // The separator is a colon followed by a space, so a cited path may itself contain a colon.
    const match = /^(.+?):\s+(\S.*)$/.exec(line);
    if (match) entries.push({ target: match[1].trim(), line });
    else malformed.push(line);
  }
  return { entries, malformed };
}

/**
 * Matches marker lines against the targets a check is about to fail on.
 *
 * @param {{targets: string[], markerText: string|null}} args
 *   `targets` are the failing axis ids or cited paths; `markerText` is null when there is no marker
 * @returns {{granted: {target: string, line: string}[], unmatched: string[], malformed: string[], empty: boolean}}
 *   `granted` pass, `unmatched` name a target this check is not failing on, `empty` is a marker
 *   with nothing in it
 */
export function decideBypass({ targets, markerText }) {
  const none = { granted: [], unmatched: [], malformed: [], empty: false };
  if (markerText === null || targets.length === 0) return none;
  const { entries, malformed } = parseMarker(markerText);
  if (entries.length === 0 && malformed.length === 0) return { ...none, empty: true };
  const failing = new Set(targets);
  return {
    granted: entries.filter((entry) => failing.has(entry.target)),
    unmatched: entries.filter((entry) => !failing.has(entry.target)).map((entry) => entry.line),
    malformed,
    empty: false,
  };
}

/**
 * Log lines a set of granted bypasses still has to add. One line per day per reason: a hook
 * fires on every edit, a bypass is one decision.
 *
 * @param {{check: string, today: string, granted: {line: string}[], logText: string}} args
 *   `today` is `YYYY-MM-DD`; `logText` is the current log content
 * @returns {string[]} lines in the form `<date> <check>: <marker line>`, without duplicates
 */
export function logLinesToAdd({ check, today, granted, logText }) {
  const recorded = new Set(String(logText ?? '').split(/\r?\n/));
  const lines = [];
  for (const { line } of granted) {
    const entry = `${today} ${check}: ${line}`;
    if (recorded.has(entry)) continue;
    recorded.add(entry);
    lines.push(entry);
  }
  return lines;
}

/**
 * Applies a bypass: decides, records, and only then grants.
 *
 * @param {{check: string, targets: string[], today: string}} request
 * @param {{readMarker: () => string|null, readLog: () => string, appendLog: (text: string) => void, logPath: string}} io
 *   `appendLog` throws when the log cannot be written
 * @returns {{bypassed: string[], notices: string[]}}
 *   `bypassed` are the targets to let through; `notices` are lines for the check to print
 */
export function applyBypass({ check, targets, today }, io) {
  const decision = decideBypass({ targets, markerText: io.readMarker() });
  const notices = [];
  if (decision.empty) {
    notices.push(`${check}: ${MARKER_PATH} has no reason in it, so nothing is bypassed. Write one line: ${MARKER_FORMAT}`);
  }
  for (const line of decision.malformed) {
    notices.push(`${check}: bypasses nothing — not in the form ${MARKER_FORMAT}: ${line}`);
  }
  for (const line of decision.unmatched) {
    notices.push(`${check}: bypasses nothing here — its target is not one this check is failing on: ${line}`);
  }
  if (decision.granted.length === 0) return { bypassed: [], notices };

  const lines = logLinesToAdd({ check, today, granted: decision.granted, logText: io.readLog() });
  if (lines.length > 0) {
    try {
      io.appendLog(`${lines.join('\n')}\n`);
    } catch (error) {
      notices.push(`${check}: could not record the bypass in ${io.logPath} (${error.message}), so nothing is bypassed.`);
      return { bypassed: [], notices };
    }
  }
  for (const { line } of decision.granted) notices.push(`${check}: bypass: ${line}`);
  return { bypassed: [...new Set(decision.granted.map((entry) => entry.target))], notices };
}

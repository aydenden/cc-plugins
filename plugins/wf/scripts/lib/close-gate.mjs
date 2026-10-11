/**
 * The gate in front of `bd close`: the documents that declare a ticket must pass coverage, have
 * their preview, and satisfy the project's invariants before the ticket closes. Pure — files,
 * processes and the bypass marker are behind `io`, provided by `hooks.mjs`.
 *
 * A ticket no document declares passes: not every ticket produces one.
 *
 * Copied into every generated plugin, so it uses `node:` builtins only.
 */
import { declared } from './artifact.mjs';
import { coverageFindings, coverageReport } from './coverage.mjs';
import { axisIds } from './spec.mjs';

/** Flags of `bd` and `bd close` that consume the next word. */
const VALUE_FLAGS = new Set(['-r', '--reason', '--reason-file', '--session', '--actor', '--database', '--db', '-C', '--directory', '--dolt-auto-commit']);

const SEPARATOR = Symbol('separator');

/** Shell words of a command line, with `;`, `&`, `|`, parentheses and newlines as separators. */
function shellWords(command) {
  const words = [];
  let word = null;
  let quote = null;
  const flush = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && i + 1 < command.length) word += command[(i += 1)];
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      word ??= '';
    } else if (char === '\\' && i + 1 < command.length) {
      word = (word ?? '') + command[(i += 1)];
    } else if (';&|()\n'.includes(char)) {
      flush();
      words.push(SEPARATOR);
    } else if (/\s/.test(char)) {
      flush();
    } else {
      word = (word ?? '') + char;
    }
  }
  flush();
  return words;
}

/**
 * Ticket ids a command line closes: the positional arguments of every `bd close` in it.
 * Text inside a `--reason` is not an id, and neither is a `bd close` that is only quoted.
 *
 * @param {string} command a shell command line
 * @returns {string[]} ids, without duplicates
 */
export function closedTickets(command) {
  const tickets = new Set();
  const words = shellWords(String(command ?? ''));
  for (let start = 0; start < words.length; start += 1) {
    if (start > 0 && words[start - 1] !== SEPARATOR) continue;
    if (words[start] !== 'bd') continue;
    let closing = false;
    for (let i = start + 1; i < words.length && words[i] !== SEPARATOR; i += 1) {
      const word = words[i];
      if (word.startsWith('-')) {
        if (VALUE_FLAGS.has(word)) i += 1;
      } else if (!closing) {
        if (word !== 'close' && word !== 'done') break;
        closing = true;
      } else {
        tickets.add(word);
      }
    }
  }
  return [...tickets];
}

/**
 * Runs the close-time checks for every ticket a command closes.
 *
 * @param {{command: string, spec: object, io: {
 *   markdownIn: (dirs: string[]) => string[],
 *   read: (path: string) => string,
 *   exists: (path: string) => boolean,
 *   runInvariant: (run: string[], docPath: string) => {ok: boolean, output: string},
 *   bypass: (request: {check: string, targets: string[]}) => {bypassed: string[], notices: string[]},
 * }}} args paths are root-relative and `/`-separated
 * @returns {{blocked: boolean, lines: string[]}} `lines` is the report for stderr when blocked
 */
export function closeGate({ command, spec, io }) {
  const lines = [];
  let blocked = false;

  /** Applies the bypass to the failing targets of one check and returns the ones still open. */
  const stillFailing = (check, targets) => {
    if (targets.length === 0) return [];
    const { bypassed, notices } = io.bypass({ check, targets });
    lines.push(...notices);
    return targets.filter((target) => !bypassed.includes(target));
  };

  for (const ticket of closedTickets(command)) {
    for (const stage of spec.stages.filter((candidate) => candidate.artifact)) {
      for (const docPath of io.markdownIn(stage.artifact.dirs)) {
        const text = io.read(docPath);
        const meta = declared(text);
        if (meta.type !== stage.artifact.type || meta.ticket !== ticket) continue;
        const label = `${ticket} ${docPath}`;

        if (stage.checks?.includes('coverage')) {
          const ids = axisIds(spec, stage.axes);
          const findings = coverageFindings(ids, text);
          const open = stillFailing('check-coverage', findings.map((finding) => finding.axis));
          const report = coverageReport({ artifact: docPath, axisIds: ids, findings: findings.filter((f) => open.includes(f.axis)) });
          if (report.failed) {
            blocked = true;
            lines.push(`[${label} coverage(${stage.axes})]`, ...report.lines);
          }
        }

        if (stage.preview) {
          const preview = stage.preview.replaceAll('<ticket>', ticket);
          if (!io.exists(preview) && stillFailing('check-preview', [preview]).length > 0) {
            blocked = true;
            lines.push(`[${label} preview]`, `MISSING ${preview}`);
          }
        }

        for (const invariant of stage.invariants ?? []) {
          const result = io.runInvariant(invariant.run, docPath);
          if (!result.ok && stillFailing('check-invariant', [invariant.name]).length > 0) {
            blocked = true;
            lines.push(`[${label} invariant(${invariant.name})]`, result.output.trimEnd());
          }
        }
      }
    }
  }
  return { blocked, lines };
}

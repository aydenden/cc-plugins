/**
 * The check after a document is written: its citations must resolve (reported back as a failure),
 * absence claims the edit wrote must show a search (advisory), and a new document must declare
 * the ticket and type the close gate finds it by (advisory). Pure — the filesystem and the bypass
 * marker are behind `io`, provided by `hooks.mjs`.
 *
 * Copied into every generated plugin, so it uses `node:` builtins only.
 */
import { declared, watchingStages } from './artifact.mjs';
import { citationReport, missingCitations } from './citations.mjs';
import { negationReport, unprovenClaims } from './negation.mjs';

/**
 * @param {{tool: string, docPath: string, text: string, written: string, spec: object, io: {
 *   lookup: {exists: (path: string) => boolean, index: (roots: string[]) => string[]},
 *   bypass: (request: {check: string, targets: string[]}) => {bypassed: string[], notices: string[]},
 * }}} args `tool` is `Write` or `Edit`; `docPath` is root-relative and `/`-separated; `text` is the
 *   document after the edit and `written` is what the edit put there
 * @returns {{failed: boolean, lines: string[], warnings: string[]}} `lines` is the citation report
 *   when failed; `warnings` never block
 */
export function editGate({ tool, docPath, text, written, spec, io }) {
  const quiet = { failed: false, lines: [], warnings: [] };
  if (!docPath.toLowerCase().endsWith('.md')) return quiet;
  const watching = watchingStages(spec, docPath);
  if (watching.length === 0) return quiet;

  // A document belongs to the stage whose artifact type it declares. Until it declares one, every
  // stage watching the folder applies: an undeclared document must not escape the checks.
  const meta = declared(text);
  const owners = watching.filter((stage) => stage.artifact.type === meta.type);
  const stages = owners.length > 0 ? owners : watching;
  const runs = (check) => stages.some((stage) => stage.checks?.includes(check));

  const warnings = [];
  if (tool === 'Write' && (owners.length === 0 || meta.ticket === null)) {
    const types = watching.map((stage) => stage.artifact.type).join('|');
    warnings.push(`${docPath}  frontmatter declares no type (${types}) and ticket — the bd close gate finds a document by those two lines and will not see this one`);
  }
  if (runs('negation') && spec.negation) {
    warnings.push(...negationReport({ docPath, claims: unprovenClaims({ text, written, negation: spec.negation }) }));
  }

  if (!runs('citation')) return { failed: false, lines: [], warnings };
  const missing = missingCitations({ text, docPath, citations: spec.citations, lookup: io.lookup });
  if (missing.length === 0) return { failed: false, lines: [], warnings };
  const { bypassed, notices } = io.bypass({ check: 'check-citations', targets: missing });
  const report = citationReport({ docPath, missing, bypassed });
  return { failed: report.failed, lines: [...notices, ...report.lines], warnings };
}

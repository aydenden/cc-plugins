/**
 * Flags a claim that something was not found when no trace of a search sits next to it.
 * "I did not look" and "I looked and it is not there" are different facts; only one is evidence.
 * Advisory: it never blocks and cannot be bypassed. Pure.
 *
 * The claim and proof patterns come from the spec's `negation` — there is no default, because a
 * broad one (없다, 없음) fires on ordinary prose. Only lines the current edit wrote are flagged.
 *
 * Copied into every generated plugin, so it uses `node:` builtins only.
 */

/** How many lines above and below a claim may hold the search that backs it. */
const PROOF_WINDOW = 6;

/**
 * Whether `line` of the document was written by this edit: the edit wrote the whole line, or it
 * wrote a fragment of it that is itself the claim.
 */
function writtenByEdit(line, writtenLines, claim) {
  const text = line.trim();
  return writtenLines.some((written) => written.includes(text) || (text.includes(written) && claim.test(written)));
}

/**
 * Absence claims in the text an edit wrote that show no search nearby.
 *
 * @param {{text: string, written: string, negation: {claim: string, proof: string}}} args
 *   `text` is the document after the edit; `written` is what the edit put there (the Write
 *   content or the Edit replacement)
 * @returns {{line: number, text: string}[]} 1-based line numbers with the claiming line
 */
export function unprovenClaims({ text, written, negation }) {
  const claim = new RegExp(negation.claim);
  const proof = new RegExp(negation.proof);
  const writtenLines = String(written ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (writtenLines.length === 0) return [];
  const lines = String(text ?? '').split(/\r?\n/);
  const found = [];
  lines.forEach((line, i) => {
    if (line.trim() === '' || !claim.test(line) || !writtenByEdit(line, writtenLines, claim)) return;
    const nearby = lines.slice(Math.max(0, i - PROOF_WINDOW), i + PROOF_WINDOW + 1);
    if (!nearby.some((candidate) => proof.test(candidate))) found.push({ line: i + 1, text: line.trim() });
  });
  return found;
}

/**
 * The lines a negation run reports. Never blocks.
 *
 * @param {{docPath: string, claims: {line: number, text: string}[]}} args
 * @returns {string[]}
 */
export function negationReport({ docPath, claims }) {
  if (claims.length === 0) return [];
  return [
    ...claims.map(({ line, text }) => `UNPROVEN ${docPath}:${line}  ${text.slice(0, 120)}`),
    `check-negation: ${claims.length} absence claim(s) with no search nearby. Record what was searched — zero hits is not "does not exist".`,
  ];
}

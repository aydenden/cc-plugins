/**
 * Reading the domain axis store: which files are domains, and how `extends` merges. Pure.
 *
 * Design-time only — not copied into generated plugins, which is why it is not under `lib/`.
 */

/** Whether a file in the store's `axes/` folder is a domain. `_schema.json` is not. */
export function isDomainFile(name) {
  return name.endsWith('.json') && !name.startsWith('_');
}

/** Entries keyed by id in first-seen order; a later entry with the same id replaces the earlier one in place. */
function mergeById(entries) {
  const byId = new Map();
  entries.forEach((entry) => byId.set(entry.id, entry));
  return [...byId.values()];
}

/**
 * A domain with `extends` merged in, one level. Parent axes keep their position and a child
 * redefinition of the same id replaces the parent's entry in place.
 *
 * @param {object} child the domain as stored
 * @param {object[]} parents the domains it extends, in `extends` order
 * @returns {{schema: number, domain: string, description: string|null, axes: object[], retired: object[]}}
 */
export function resolveDomain(child, parents) {
  const all = [...parents, child];
  const missing = all.find((domain) => !Array.isArray(domain.axes));
  if (missing) throw new TypeError(`domain ${missing.domain ?? '(unnamed)'} has no axes array`);
  return {
    schema: child.schema ?? 1,
    domain: child.domain ?? null,
    description: child.description ?? null,
    axes: mergeById(all.flatMap((domain) => domain.axes)),
    retired: mergeById(all.flatMap((domain) => domain.retired ?? [])),
  };
}

/** One line of `list`: the domain name and what kind of work it applies to. */
export function listLine(name, description) {
  return `  ${name.padEnd(18)} ${description ?? ''}`;
}

/** Lines of `retired`: an axis dropped once for a reason should not quietly return. */
export function retiredLines(resolved) {
  return resolved.retired.map((entry) => `  ${entry.id} — ${entry.retired_by}`);
}

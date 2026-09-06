# CLAUDE.md

Only what is true *here*. General plugin knowledge belongs to the `plugin-dev`
skills — restating it just creates a copy that drifts.

`.claude-plugin/marketplace.json` is the authoritative list of what exists.

## Invariants

**1. Never introduce a runtime dependency.** Scripts are `.mjs` using only `node:`
builtins, or bash. If something seems to need an npm package, stop and ask. llm-wiki
discarded a finished search-backend design (Orama · bge-m3 · onnxruntime) over this.
No `package.json`, no lockfile — that is the correct state.

**2. A version lives in three places; bump all three.** `plugin.json`,
`marketplace.json`, and the plugin's card heading in the root `README.md`. Update one
and the rest drift silently — the README once sat at v0.6.0 against a v0.28.0 plugin.

**3. No `agents/` directory.** Research prompts live in commands, procedures in
skills. Ask before adding the first subagent.

**4. A description is written in four places.** `plugin.json`, `marketplace.json`,
the plugin's `README.md`, the root `README.md`. Discarded features have survived in
descriptions more than once (Orama, hermes, OpenCode).

## Source of truth

Each plugin's README declares its own. These two no search of this repo will reveal:

| What | Where |
|---|---|
| Vault schema — frontmatter, tags, page criteria | `SCHEMA.md` at the vault root, outside this repo. Edit it there, not in plugin docs |
| Domain review axes (wf) | git ref `refs/wf/axes`, cached at `~/.cache/wf/axis-store`. Not a branch; a plain clone skips it |

Before defining a term or constant, find its owner. If there is none, propose a home
rather than defining it inline.

## Tests

Two runners, both must pass:

```bash
node --test "plugins/**/*.test.mjs"
for f in $(find plugins -name '*.test.sh'); do bash "$f"; done
```

Decision logic never touches the filesystem; I/O lives in an adapter so pure
functions can be stubbed. Keep that split.

## Adding a plugin

`/plugin-dev:create-plugin` scaffolds and validates; `skill-creator` writes skills.
What they don't know:

1. Register in `marketplace.json` with `source: "./plugins/{name}"` — create-plugin
   assumes a standalone plugin.
2. Add a card to the root `README.md`: motivation, design judgment, components.
3. Match the version in all three places.

Use `commands/` only for direct human invocation with arguments
(`/llm-wiki:capture <url>`); skills for everything else.

## Ending a session

Run `bd dolt push` after committing, or issue sync falls behind.

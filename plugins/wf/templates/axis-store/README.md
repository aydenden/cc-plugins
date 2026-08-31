# Domain axis store

Axis sets for `wf`, one JSON file per domain under `axes/`.

An axis is an item on the list of *what must be defined* before implementation starts. Without
that list a definition stage can only be judged on the axes someone happened to look at; the ones
nobody looked at are not even known to be missing, and they surface as rework after the code is
written.

## Where this lives

Under the custom ref `refs/wf/axes` on the plugin repository — outside `refs/heads` and
`refs/tags`. It is not a branch and not a tag: it is absent from the web branch list, from
`ls-remote --heads`, and from a default clone or fetch. `main` publishes the marketplace and is
read by every install; this ref is data that grows on its own schedule, and the two never meet.

The tradeoff is deliberate: nothing here can be browsed or fixed from the web UI, and a mirror
that uses the default refspec will not carry it. `axis-sync.sh` is the way in.

## Layout

```
axes/_schema.json        JSON Schema for a domain file
axes/<domain>.json       one domain's axis set
```

## Working with it

```bash
axis-sync.sh pull                  # create or fast-forward the local store
axis-sync.sh list                  # which domains exist
axis-sync.sh resolve frontend-vue  # one domain with `extends` merged in
axis-sync.sh ids frontend          # axis ids, one per line (feeds check-coverage.sh)
axis-sync.sh retired frontend      # what was dropped and why
axis-sync.sh push "add a11y axis"  # commit and publish
```

## What belongs here

A domain-general axis: one that would have caught the same omission in another project of the
same kind. A project-specific axis — this repository's module, this team's rule — stays in that
project's `.claude/<plugin>.local.md`. Put it here and it becomes a row that is permanently
"not applicable" everywhere else.

An axis carries its bar, not only its question. `closed_when` says what the artifact's row must
hold for the axis to count as closed; `excluded_when` says what must have been searched, and found
absent, before the row may read "not applicable". Leave them out and every project rebuilds the bar
from scratch — lower each time, and a verdict reached by not looking becomes indistinguishable from
one reached by looking.

Never clear `added_by`. Once the list is long it is the only way to tell an axis that came out of
real rework from one that was added because it sounded thorough — and a list of the latter stops
being read.

Dropping an axis means moving it to `retired` with a reason, not deleting it. Deleted axes live
only in the history, nobody greps the history, and the same plausible-looking axis comes back six
months later.

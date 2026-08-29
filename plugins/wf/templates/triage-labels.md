# Triage labels

Triage moves an incoming issue through five roles. In beads these are **custom statuses**, not labels, so that `bd ready` only surfaces work an agent can actually pick up.

Configure once:

```bash
bd config set status.custom "needs-triage,needs-info,ready-for-agent,ready-for-human,wontfix"
```

| Role | Status | Meaning |
|---|---|---|
| Needs evaluation | `needs-triage` | Arrived raw; a maintainer must judge it |
| Waiting on reporter | `needs-info` | Blocked on missing reproduction or detail |
| Agent-ready | `ready-for-agent` | Fully specified; an agent can start with no extra context |
| Human-ready | `ready-for-human` | Needs a person to implement or decide |
| Rejected | `wontfix` | Closed with a reason; not actioned |

Move an issue with `bd update <id> --status=<status>`.

Pair `ready-for-human` with `bd human <id>` so it also shows up in the human-decision queue.

Triage applies only to issues that arrived from outside — bug reports, feature requests, findings from QA sessions. Issues produced by `to-issues` or `wf:slice` are already agent-ready and must not be re-triaged.

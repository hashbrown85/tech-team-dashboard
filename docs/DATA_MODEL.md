# Data model

What the board stores. Written by reading `board.html`, because there is no schema
file anywhere — the shape of the data is whatever the code happens to write.

**Why this document exists:** if you change the shape of a record, every reader of
that record has to change too, and nothing will warn you. This is the closest thing
to a contract that exists.

There are **eight collections**, listed in `COLS` (board.html:1729), plus a ninth
(`counters`) that is written directly and never subscribed to.

A "collection" is a bag of documents. Each document has an `id`. Links between
collections are plain id strings — there is nothing enforcing that the thing on the
other end still exists, so **every reader has to cope with a dangling link.** That is
deliberate; see BUSINESS_RULES.md.

Field names below are exactly as spelled in the code. Fields marked *optional* are
absent (not null) when unset, because the code uses `delete` to unset them.

---

## `people` — the roster

| Field | Type | Notes |
|---|---|---|
| `id` | string | `uid()`, or a hand-set seed id |
| `name` | string | **Used as an identifier elsewhere.** See `actions.owner`. |
| `title` | string | Job title, display only |
| `home` | string | Which area they belong to, display only |
| `detailAreas` | string[] *optional* | Tab ids where this person may see Project Details |

`detailAreas` is the only permission-ish field in the data. It is checked by
`canSeeDetails` (board.html:516) against `ui.iam` — which the user picks from a
dropdown themselves. **It is not a security control**, it is a display preference.

## `tabs` — a recurring meeting

Called "tabs" throughout the code because they're the top-level navigation. Each one
is a meeting that recurs weekly.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `'tab-' + uid()`, or a seed id. The id `'techdir'` is special. |
| `name` | string | |
| `kind` | `'area'` \| `'internal'` | Labels from `KIND` (board.html:482) |
| `weekday` | 0–6 | Sunday = 0. Drives the next-meeting date. |
| `lengthMin` | number | Meeting length in minutes; the agenda timer divides this up. |
| `members` | string[] | Person ids — "Reporting" |
| `support` | string[] | Person ids — "Supporting" |
| `optional` | string[] | Person ids — "Optional" |

The three role arrays are mutually exclusive by convention, not by enforcement. A
person in none of them is "Not in meeting" (`ROLES`, board.html:483).

Defaults are applied on load, not on write (board.html:1739): missing role arrays
become `[]`, `weekday` becomes 1, `lengthMin` becomes 30, `kind` becomes `'internal'`.
**So a tab document in the store may legitimately be missing these fields.**

`id === 'techdir'` swaps two agenda segments (board.html:474-477). It is hardcoded.

## `entries` — the wins / losses / opportunities log

One row per person per meeting per thing they said. This is the fastest-growing
collection.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `uid()` |
| `tab` | string | → `tabs.id` |
| `meeting` | date string | `YYYY-MM-DD`, which meeting occurrence |
| `personId` | string | → `people.id` |
| `kind` | `'win'` \| `'loss'` \| `'opp'` | |
| `text` | string | What happened |
| `why` | string | Why it happened — required for losses |
| `change` | string *optional* | What we'll do differently. **Losses only.** |
| `projectId` | string *optional* | → `projects.id`. **Opportunities only** — the project created alongside. |

An opportunity entry and its project are created together in one handler
(`F.opp`, board.html:1577-1585) and can be deleted together (`H.delEntry`,
board.html:1384-1394) — but only if the project hasn't been worked on yet.

## `projects`

| Field | Type | Notes |
|---|---|---|
| `id` | string | `uid()` |
| `tab` | string | → `tabs.id` |
| `personId` | string | → `people.id`, the owner |
| `name` | string | |
| `status` | see below | |
| `due` | date string *optional* | |
| `start` | date string *optional* | Hidden from Current Projects until this date |
| `added` | date string | Meeting date it was created |
| `fromOpp` | string *optional* | → `entries.id` it originated from |
| `note` | string *optional* | The challenge / context text |
| `prevStatus` | string *optional* | Bookkeeping for the meeting summary |
| `statusMeeting` | date string *optional* | Bookkeeping for the meeting summary |
| `doneMeeting` | date string *optional* | Set while status is done/cancelled |
| `rank` | number *optional* | Queue position **while off-track only** |
| `estValue` | number *optional* | Project Details |
| `winPct` | number *optional* | Project Details |
| `winReason` | string *optional* | Project Details |
| `resources` | string[] *optional* | Project Details; values come from `settings/resources` |
| `chemistries` | string[] *optional* | Project Details; values come from `settings/chemistries` |

**Status values** (`PST` board.html:479, labels in `PSTL` board.html:616):

`'new'` → `'on'` | `'off'` | `'hold'` | `'cancelled'` | `'done'`

`ACTIVE` (board.html:480) counts `new`, `on`, `off`, `hold` as active. The transition
rules are non-obvious and live in BUSINESS_RULES.md.

The four Project Details fields are the sensitive ones. See the note under `people`.

## `issues` — things with no path yet

| Field | Type | Notes |
|---|---|---|
| `id` | string | `uid()` |
| `tab` | string | → `tabs.id` |
| `personId` | string | → `people.id`, who raised it |
| `text` | string | |
| `sev` | `'stopper'` \| `'risk'` | Labels in `SEV` (board.html:478) |
| `status` | `'open'` \| `'resolved'` | |
| `meeting` | date string | Meeting it was raised in |
| `rank` | number | Queue position. Fractional values are normal — see below. |
| `resolvedMeeting` | date string *optional* | |
| `autoResolved` | boolean *optional* | **Load-bearing.** See BUSINESS_RULES.md. |

`SEV` also defines `'offtrack'`, but no issue document ever carries it — off-track
*projects* are given that severity synthetically when they join the issue queue
(board.html:582). The import feature is the one path that could write `sev:'offtrack'`
onto a real issue.

`rank` is deliberately fractional. A new show-stopper is inserted at
`lastStopper.rank + 0.5` so it lands above the non-stoppers without renumbering
anything (board.html:1596).

## `actions` — the durable action register

The one collection that outlives the meeting it was created in.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `uid()` |
| `num` | number | From `counters/actions`. Displayed as `A-047`. |
| `tab` | string | → `tabs.id` |
| `text` | string | |
| `owner` | string | **A person's NAME, not an id.** See below. |
| `support` | string | **A person's NAME, not an id.** Optional in practice. |
| `due` | date string | |
| `status` | `'open'` \| `'done'` | |
| `doneOn` | date string *optional* | **Today's date**, not the meeting date |
| `parent` | object \| null | `{type: 'issue'\|'project', id}` — what this action resolves |
| `meeting` | date string | Meeting it was logged in |

**`owner` and `support` hold names, not ids.** Filtering compares name strings
(`personOk`, board.html:566), and renaming a person triggers a loop that rewrites
every matching action (`C.personName`, board.html:1674-1683). Two people with the
same name break this silently. Migrating to ids is planned.

**`parent` is polymorphic and nullable by design.** It points into either `issues` or
`projects`, and deleting that parent sets it to `null` rather than deleting the
action — committed work survives the thing that caused it. This is why the store
doesn't need real foreign keys.

`num` is sequential **with no gaps**, because people read action numbers aloud in
meetings. That's a real requirement, not an implementation detail.

## `meetings` — one occurrence of one tab

**The document id is a composite key:** `tabId + '@' + date`, built by `dbMeetingId`
(board.html:548). For example `techdir@2026-09-14`. In memory the same pair is keyed
with a `|` separator by `mkey`, so don't mix the two up.

| Field | Type | Notes |
|---|---|---|
| `ratings` | object | `{personId: 1..5}` |
| `note` | string | "One change for next time" |

Both writers replace the whole document (`H.setRating` board.html:1422-1428,
`C.meetingNote` board.html:1656-1659), so a rating and a note written at the same
moment can clobber each other.

## `settings` — a small key/value bucket

Two documents, each with a fixed id:

| Document id | Shape |
|---|---|
| `chemistries` | `{items: string[]}` |
| `resources` | `{items: string[]}` |

These are the pick-lists for the two Project Details multi-select fields. Read by
`chemList()` / `resourceList()` (board.html:514-515), which tolerate the documents
being absent.

## `counters` — not in `COLS`

One document, `counters/actions`, shape `{next: number}`. Read and written directly
(`nextActionNum`, board.html:650-656), never subscribed to.

It is a read-then-write with **no locking**, so two people creating an action in the
same second can both get the same number. Rare in practice because one person drives
the meeting, but it is a real race.

---

## What is NOT stored

Worth knowing, because people assume otherwise:

- **No creation timestamps on anything.** The nearest fields are `meeting` (the
  meeting date something was raised in) and `doneOn`. Questions like "how long did
  this action take to close" or "how long until that issue got an owner" cannot be
  answered, and **cannot be answered retroactively** either.
- **No history or audit trail.** Every write replaces what was there. `prevStatus`
  holds exactly one step of project-status history and only until the next meeting.
- **No user identity.** `ui.iam` is a dropdown the user sets themselves, stored in
  their own browser's sessionStorage. The store has no idea who wrote anything.
- **No per-tab permissions.** `contentMode` / `settingsMode` are single global flags
  for the whole board.

## Client-only state (never in the store)

The whole `ui` object (board.html:523) is persisted to **sessionStorage** under
`techops-board2:ui3` and rewritten on every render. It holds current view, per-tab
meeting-date overrides, per-tab agenda step, filters, the person scope, **the running
agenda timers**, which form is open, and the in-progress notes-import draft.

This is per-person, per-browser, and disposable. Don't move any of it into the store —
two people would fight over each other's navigation.

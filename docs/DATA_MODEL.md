# Data model

What the board stores. Written by reading `board.html`, because there is no schema
file anywhere — the shape of the data is whatever the code happens to write.

**Why this document exists:** if you change the shape of a record, every reader of
that record has to change too, and nothing will warn you. This is the closest thing
to a contract that exists.

There are **ten collections**, listed in `COLLECTIONS`
(`src/adapters/DataStore.js`), plus `counters`, which is written directly and never
loaded with the rest.

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
| `upn` | string *optional* | Work account, matched against the sign-in |

`upn` is how the board knows who you are: the signed-in account's username is
matched against it, case-insensitively. Somebody with no match still sees the
board; they are simply not a person record yet.

There is no longer a `detailAreas` field. Who may see project value is decided by
SharePoint permissions on the `projectDetails` list, not by a field here.

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
| `showTimer` | boolean *optional* | Show the agenda clock. Absent means off. |

The three role arrays are mutually exclusive by convention, not by enforcement. A
person in none of them is "Not in meeting" (`ROLES`, board.html:483).

Defaults are applied on load, not on write (board.html:1739): missing role arrays
become `[]`, `weekday` becomes 1, `lengthMin` becomes 30, `kind` becomes `'internal'`.
**So a tab document in the store may legitimately be missing these fields.**

`showTimer` is off unless a meeting deliberately turns it on. When off, the agenda
clock, the pacing hint and the per-segment badges are all absent — the group chooses
to work to time rather than having it imposed.

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
| `customer` | string *optional* | Visible to everyone who can see the project |
| `field` | string *optional* | Free text, column `ProjectField` |
| `projectType` | string *optional* | Free text, column `ProjectType` |
| `mission` | string *optional* | Free text: what this project is for |
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
| `priority` | number *optional* | Position in **its owner's** list, within this meeting |
| `winPct` | number *optional* | How likely we are to land it, 0-100 |
| `winReason` | string *optional* | Why it is ours to lose |
| `products` | string[] *optional* | values from `settings/products` |
| `confidence` | `{m,p}[]` *optional* | every value `winPct` has held |
| `resources` | string[] *optional* | values from `settings/resources` |
| `focus` | string[] *optional* | values from `settings/focus` |

The **dollar value** is not here. It is the one field that lives in
`projectDetails`, on its own permissioned list.

`products` names the products this project is proposing. It is picked from a
dropdown of what is not yet chosen, with each choice shown as a removable chip —
rather than a grid of togglable chips, which stops scaling the moment the list is
longer than a line. `focus` and `resources` use the same control.

`field` and `projectType` line the record up with a project sheet the team already
uses. They are **single strings**, not arrays like `products` and `focus` — which is
what lets the project page use a combo box rather than a chip picker, and keeps
`matchesValue` and `distinctValues` working on a plain value.

Both are picked from a **self-growing curated list** kept in `settings` under the same
key. Type something that is not on the list and it is added, so the next person is
offered it — governance without a roadblock mid-meeting. `canonicalValue` settles a
typed value against the list first, so "coatings" becomes the list's "Coatings" and
does **not** become a second entry; without that the list fragments into case variants
of itself and each one hides most of the rows behind the filter.

The suggestions are the **union** of the curated list and the values already in use.
Neither alone works: the list alone loses everything typed before it existed, and the
values alone make the settings screen decorative.

The column is `ProjectField`, not `Field` — both satisfy the single-word column rule,
but `Field` is too generic to want in a SharePoint list and reads worse beside
`ProjectType`.

**A project's title is `customer` and `name`, joined by a hyphen** — "Meridian
Coatings - Coating additive trial" (`projectTitle`). Internal work with no customer
is just its name rather than a title with a dangling hyphen. Both halves are free
text and both are editable at the top of the project page, because a project is
often entered mid-meeting against the wrong customer or under a placeholder name.

Renaming a project needs **no cascade**: actions point at it by id. That is the
difference between this and renaming a *person*, which has to rewrite every action
they own, because those store an owner's name as text.

**`confidence` is the history behind `winPct`**, as `[{m: meeting date, p: per
cent}]`, oldest first. A point is stamped with the **meeting date**, there is **one
point per meeting** (editing twice replaces it, which is what makes this survive a
field that writes on every keystroke), and **no point is added when the value did not
change**. Clearing `winPct` does not erase the history — the number was believed for
a while, and that happened. The project page and tile draw a trend line through it
once there are two points; one reading is a number, not a trend.

It lives on the project rather than in a collection of its own: it is small, only
ever read whole, and holding it here means deleting a project takes its history with
it and undo brings it back, with no cascade to write or forget.

**`priority` is not `rank`.** `rank` is the position in the off-track Issues queue,
and `statusChange` sets it when a project goes off track and deletes it when it comes
back — so reusing it would have meant a status change silently scrambled somebody's
priorities. Priority is per person per meeting: two people's lists are ordered
independently. Absent sorts last, so a newly added project lands at the bottom rather
than the top, and a board nobody has ordered still renders the same way twice.

`focus` is what the customer or project cares about most — Corrosion, Scale,
Pipeline, Rod Pumps — so a glance at a project row says whether we are pointed at
their actual problem. It replaced a `chemistries` field, which recorded what a
project was chemically made of; the rename happened before any SharePoint list
existed, so the column went with it.

The authoritative product list lives in **Dataverse**; nothing in the app can reach it yet, so the picker is fed
from a `products` row in `settings`, maintained by hand on the People & settings
screen. When Dataverse becomes reachable only the *source* of that list changes —
the project stores the chosen values either way, so no migration follows.

**Status values** (`PST` board.html:479, labels in `PSTL` board.html:616):

`'new'` → `'on'` | `'off'` | `'hold'` | `'cancelled'` | `'done'`

`ACTIVE` (board.html:480) counts `new`, `on`, `off`, `hold` as active. The transition
rules are non-obvious and live in BUSINESS_RULES.md.

## `projectDetails` — the money, and only the money

One record per project, keyed by **the project's own id**. Separate from `projects`
because it lives on its own SharePoint list with its own permissions, so somebody
without access never receives the figure at all.

| Field | Type | Notes |
|---|---|---|
| `id` | string | the project's id |
| `estValue` | number *optional* | Dollars per year |

**Do not add fields here because they feel sensitive.** This list exists so
SharePoint can refuse it, and everything in it disappears together for anyone
refused — so each extra field is something the team loses the ability to discuss.
`winPct`, `winReason`, `resources` and `focus` all started here and were moved
back onto the project for exactly that reason: the dollar figure was the only part
that needed protecting.

**Access is all-or-nothing.** SharePoint permissions are per list, so a person can
read every project's value or none. The per-area granularity the old `detailAreas`
field gave could not survive being a real control, and was retired with it.

Deleting a project deletes its details, and deleting a meeting deletes them for
every project under it — otherwise the figures would outlive what they described.

## `projectNotes` — commentary that belongs to the project

One record per note. Unlike `entries`, which belong to a single meeting, these
belong to the project for its whole life.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `uid()` |
| `projectId` | string | → `projects.id` |
| `text` | string | |
| `authorId` | string | → `people.id`, from the sign-in |
| `created` | ISO timestamp | **The first time-of-day stamp in the system** |
| `edited` | ISO timestamp *optional* | Set when the text is changed |

Timestamps are ISO 8601 in UTC, stored as text for the same reason dates are: a
real DateTime column round-trips through a timezone and can come back wrong.

**Only the author may edit or remove a note, and that is enforced in the browser
only.** SharePoint cannot express per-item authorship without item-level
permissions, so anyone with Contribute could still edit the list directly. It stops
people accidentally rewriting each other's notes; it is not a guarantee that a note
is unaltered.

Once a project is `done` or `cancelled` its notes lock — they stay as the record of
how it went, but nothing can be added or changed. Deleting a project deletes its
notes, and deleting a meeting deletes them for every project under it.

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
| `focus` | `{items: string[]}` |
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

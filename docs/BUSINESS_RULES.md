# Business rules

The rules the board enforces, in plain language. These exist **nowhere except the
code** — there was no specification, so this document was written by reading
`board.html` line by line.

**Read this before changing anything in `src/domain/`.** Several of these rules look
like bugs and are not. At least one asymmetry is deliberate and will be "fixed" by a
well-meaning contributor unless it's written down, which is the main reason this file
exists.

Each rule below names the code it came from and, where a test exists, the test that
guards it.

---

## 1. An issue "has a path" if an open action points at it

This is the core idea of the whole app, and it is the rule most likely to be broken by
accident.

**There is no "has an owner" flag on an issue.** Whether an issue appears in the
Issues queue is *computed*, every render, from whether any open action has
`parent.id` equal to that issue's id.

- `issueItems(tid)` (board.html:580-591) lists issues that are `status:'open'` **and**
  have zero open linked actions.
- `actionedItems(tid)` (board.html:595-598) lists issues that are `status:'open'`
  **and** have one or more open linked actions — these render as "moved, now tracked
  as actions".
- `openActsFor(id)` (board.html:592) is the count that decides it.

So:

| You do this | What happens to the issue |
|---|---|
| Create an action with `parent` = the issue | Leaves the queue immediately |
| Delete that action | **Comes back** into the queue |
| Close that action | Auto-resolves (rule 2) — leaves both lists |
| Reopen that action | Comes back as open (rule 2) |
| Create a *second* linked action, close one | Stays out of the queue, stays unresolved |

**Do not replace this with a boolean field.** The self-healing behaviour — delete the
action and the problem reappears in front of the team — is the point. A flag would let
an issue claim it has a path when the action is gone.

The same rule applies to **off-track projects**, which are injected into the same
queue with a synthetic severity of `'offtrack'` (board.html:582).

*Guarded by tests 1–5.*

## 2. Closing the last action auto-resolves the issue — but only if it was auto-resolved before

`C.actionDone` (board.html:1634-1648).

When you tick an action done:

1. The action is set `status:'done'`, `doneOn` = **today's date** (not the meeting
   date — this is inconsistent with everything else, and it is what the code does).
2. If that action's `parent.type === 'issue'`, and the issue is still `open`, and no
   *other* open action points at it, then the issue becomes
   `status:'resolved'`, `resolvedMeeting` = that issue's tab's current meeting date
   (falling back to today if the tab is gone), and **`autoResolved: true`**.

When you untick it:

3. The issue reopens **only if** `status === 'resolved'` **and** `autoResolved` is
   true. A manually-resolved issue stays resolved.

That `autoResolved` guard is why the flag exists. Without it, reopening an action
would silently undo a human's deliberate decision to close an issue.

### The deliberate asymmetry

**Off-track projects are never auto-resolved this way.** The check at board.html:1638
only fires for `parent.type === 'issue'`. Closing the last action on an off-track
project leaves the project off-track.

This is correct. An issue is resolved when someone commits to handling it; a project
is back on track only when a human says so, in the meeting, by clicking a status
button. Making these symmetrical would let projects quietly mark themselves healthy.

*Guarded by tests 6–9. Test 9 exists specifically to stop someone "fixing" the
asymmetry.*

## 3. Project status transitions record one step of history

`H.projStatus` (board.html:1360-1373). Four things happen on a status change, and the
order matters.

Nothing happens at all if the status isn't actually changing (board.html:1361).

**a) One step of history, scoped to the meeting.**

```
if (statusMeeting !== thisMeeting)  { prevStatus = oldStatus; statusMeeting = thisMeeting }
else if (prevStatus === newStatus)  { delete prevStatus; delete statusMeeting }
```

In words: the **first** change in a given meeting records what it changed *from*. A
later change in the same meeting leaves that record alone — so `on → off → hold`
still reports `prevStatus: 'on'`, which is what the team wants to hear. But changing
all the way *back* to where it started clears the record entirely, so a mistake
clicked and un-clicked doesn't show up in the summary as a change.

**b) `doneMeeting` tracks closure.** Entering `done` or `cancelled` sets it to the
current meeting date; any other status deletes it. It's what makes rule 4 work.

**c) Going off-track joins the issue queue at the bottom.** Entering `'off'` from
anything else sets `rank = maxRank + 1000`, where `maxRank` is scanned from
`issueItems(tid)` — note that's the **unpathed queue only**, not every off-track
project. Leaving `'off'` deletes `rank`.

**d) Leaving `off` for any other status deletes `rank`**, so the project drops out of
the queue ordering entirely.

*Guarded by tests 10–14.*

## 4. What shows up in a given week

`projVisible(x, tid, d)` (board.html:594). A project appears in a meeting's Current
Projects if **all three** hold:

1. It belongs to that tab, and
2. it has no `start` date, or `start` is on/before that meeting date, and
3. its status is active (`new`/`on`/`off`/`hold`) **or** it was closed
   (`done`/`cancelled`) on *exactly* that meeting date.

Consequence worth understanding: a project marked done in one meeting is visible in
that meeting forever (you can scroll back to it), but disappears the following week.
Closed work doesn't accumulate in the list.

## 5. An opportunity becomes a project next week, not this week

`F.opp` (board.html:1577-1585) creates two documents at once: the `entries` row and a
`projects` row with `status: 'new'`, `fromOpp` pointing back at the entry, and
**`start` = the meeting date + 7 days**.

Combined with rule 4, that means an opportunity raised today is *not* in Current
Projects today — it appears at the next meeting. Deliberate: you discuss it as a new
opportunity this week, then it becomes something you're accountable for.

`H.delEntry` (board.html:1384-1394) undoes both, but **only if** the linked project is
still `status:'new'` and has no actions. Once someone has worked on it, deleting the
entry leaves the project alone.

*Guarded by tests 15–16.*

## 6. Issue queue ordering

`issueItems` sorts by, in order (board.html:583-589):

1. `rank` ascending — a missing rank sorts as `1e9`, i.e. last
2. then show-stoppers before everything else
3. then oldest meeting date first

New issues are placed by `F.issue` (board.html:1596):

- a **show-stopper** goes in at `lastStopper.rank + 0.5`, or `0.5` if there are no
  stoppers yet — i.e. immediately below the existing stoppers, above everything else
- anything else goes in at `items.length + 1` — the bottom

Fractional ranks are therefore normal and expected. Don't "tidy" them into integers;
the whole point is inserting without renumbering.

`H.moveIssue` (board.html:1376-1383) reorders by **swapping the two rank values** of
adjacent items. `H.reopenIssue` (board.html:1375) sets `rank = 1e6`, sending a
reopened issue to the bottom of the queue.

> **Known rough edge, left as-is:** if the last show-stopper has no `rank` at all,
> `lastStopper.rank + 0.5` evaluates to `NaN`. Reachable only through data that
> predates the ranking logic or arrives via import. Documented rather than fixed,
> because the port is not the time to change behaviour.

*Guarded by tests 18–19.*

## 7. Deleting a parent keeps the work

`H.delProject` (board.html:1395-1404) and `H.delIssue` (board.html:1405-1414) set
their actions' `parent` to `null` instead of deleting them. The toast says so: *"Its
action items stay in the list."*

This is the reason the data model doesn't want real foreign keys — `parent` is a soft,
nullable, polymorphic pointer, and orphaning it is a feature. Someone committed to
doing a thing; deleting the project that prompted it doesn't release them.

`H.delTab` (board.html:1447-1470) is the big one: it deletes the tab **and** every
entry, project, issue, action and meeting belonging to it. Fifty-plus writes.

*Guarded by tests 20–22.*

## 8. Undo holds exactly one thing

There is a single module-level `lastUndo` slot. Destructive handlers overwrite it with
a closure that re-writes the deleted documents using **their original ids**, and
`toast(msg, true)` shows the Undo button for 7 seconds instead of the usual 4.2.

Two consequences for the port:

- **A store adapter must honour the id it is given on write.** If the backing store
  assigns its own ids, every undo closure in the app breaks.
- Undo is the only rollback that exists. There are no transactions, so a cascade that
  half-fails is repaired by the user clicking Undo, not by the store.

## 9. The agenda clock is advisory

`SEGS` (board.html:467-472) gives each of the five segments a fraction of the meeting:
0.15, 0.10, 0.15, **0.50**, 0.10. Half the meeting is meant to be spent on Issues.

`tick()` (board.html:1299-1317) multiplies those fractions by the tab's `lengthMin`,
works out which segment you *should* be on, highlights it, and warns once you're over
total. **It never changes the step for you and never writes anything.** Timer state
lives only in `ui.timers` in sessionStorage — so it's per-person, and reloading
mid-meeting keeps it, but nobody else sees your clock.

`id === 'techdir'` replaces segments 2 and 3 with "Business Project Review" and
"Tech-Projects" (board.html:474-477).

## 10. Meeting dates are derived, not stored

`tabDate(t)` (board.html:546) = the user's override in `ui.dates[tabId]`, or else the
**next occurrence** of that tab's `weekday` on or after today (`nextOn`,
board.html:499).

There is no "meetings" calendar to maintain. Prev/next shift the override by ±7 days
and "Upcoming" deletes it. A `meetings` document only comes into existence when
someone rates a meeting or writes a note.

## 12. A project note belongs to the project, not to a meeting

A win, a loss or an opportunity belongs to ONE meeting: it is what somebody said that
week, and next week's meeting starts clean. A **note** belongs to the project for its
whole life. "Supplier finally sent the data sheets" is not a thing you said in a
meeting; it is a fact about the project that is still true next month.

Notes are held in their own collection, `projectNotes`, keyed by `projectId`, and
shown newest-first on the project page. Newest-first because the page is glanced at
far more often than it is read.

Implemented in `src/domain/notes.js`.

### Who may change one

**Only the author**, and only while the project is still live.

Be clear about what that is: it is a **courtesy, not a control**. It stops people
accidentally rewriting each other's notes. It is enforced in the browser, and
SharePoint cannot express per-item authorship without item-level permissions — which
is a different and much heavier thing. Anyone with Contribute on the list could still
edit any note directly.

That is fine for working notes. It would not be fine for anything sensitive, which is
why sensitive numbers live in `projectDetails` instead, on their own permissioned
list. The distinction is the point.

Somebody not on the roster has no person id. They can still write a note — it is
stored with an empty `authorId` — but they can never edit one, because two such
people cannot be told apart.

### They lock when the project finishes

Once a project is `done` or `cancelled`, its notes stop accepting changes: nothing new
can be added and nothing existing edited or removed. They stay on the page as the
record of how it went, which is usually the most useful part of a finished project.

A project that is not there at all also reads as locked — writing a note against
something that does not exist cannot be right.

---

## 13. Only the dollar value is restricted, and the gate asks whether it arrived

**What is restricted is deliberately narrow: `estValue`, and nothing else.**
Confidence, why-we-win, product selection, chemistries and resources all live on the
project and are shown to everyone who can see the project at all.

They did not start that way — all of them were in `projectDetails` — and the reason
for moving them back is worth keeping: everything on that list disappears together
for anyone refused it, so each field held there is one the team loses the ability to
discuss. Confidence is a thing a meeting talks about. The dollar figure is the part
that needs protecting.

The value lives in `projectDetails`, on its own SharePoint list with its own
permissions. Somebody refused that list gets a **403**,
which `graphAdapter.load()` turns into an **empty collection plus an entry in
`snap.denied`** — the rest of the board loads normally.

So the test for "may this person see project value" is:

```js
(snap.denied || []).indexOf('projectDetails') < 0   // detailsArrived(snap)
```

**It must not be `Array.isArray(snap.projectDetails)`.** A refused reader still gets
an array — an empty one — so that test always passes. It shipped that way, and the
consequence was that the Project Details panel rendered for everybody, with writable
fields, on every project row. The panel looked empty, which is exactly why nobody
noticed.

The difference this encodes: a panel that is absent **because nothing was sent**, not
one the browser merely chose not to draw. Client-side hiding is never a control.

The same gate governs the value in **Copy summary** on the project page. Otherwise
the button would hand out in plain text precisely what the page withheld. The rest of
the commercial section travels with the summary either way, because it is not
restricted.

A refused reader sees the Commercial panel with a line saying the value is kept to
the people who have access to it, rather than a row that is silently missing. That
reveals only that projects have values, which is not a secret, and it is better than
a gap nobody can account for.

---

## 11. What is not actually enforced

Be honest about these — three of them look like controls and aren't:

- ~~**Project Details visibility is cosmetic.**~~ **Fixed.** Those fields now live in
  `projectDetails`, on their own permissioned SharePoint list. Somebody without
  access receives an empty collection, so the figures are absent from the page
  rather than merely undrawn. Identity comes from the Microsoft sign-in rather than
  a dropdown. The cost: access is all-or-nothing, since SharePoint permissions are
  per list.
- **`contentMode` / `settingsMode` are set by the backend rejecting a write**
  (`writeFail`, board.html:632-641), not by asking permission up front. The UI goes
  read-only *after* the first refusal.
- **There are no per-tab write permissions.** Anyone who can write can write to any
  meeting.
- **Role arrays aren't exclusive.** Nothing stops a person being in `members` and
  `optional` at once.
- **Losses require a "what we'll do differently"** (board.html:1572) — this one *is*
  enforced, and it's the only content validation in the app beyond required fields.

---

## Known defects, found while writing this down

Recorded rather than fixed, because the port deliberately changes no behaviour
(outside the planned owner-id migration). Each is a small, separate change once the
extraction is finished.

- **The board thinks it's still yesterday if left open overnight.** `TODAY` is read
  once at startup (board.html:510) and never refreshed, so overdue actions don't turn
  over at midnight and `doneOn` can be stamped with the wrong date. `src/lib/dates.js`
  exposes `today()` as a function so this becomes fixable at the call sites.
- **A new show-stopper can get a rank of `NaN`** if the last existing show-stopper has
  no rank at all (board.html:1596 does `rank + 0.5`). Only reachable from data that
  predates the ranking logic, or from the notes-import path. See rule 6.
- **`doneOn` uses today's date, everything else uses the meeting date**
  (board.html:1637). Not wrong exactly, but inconsistent, and it means an action
  closed while reviewing last week's meeting is stamped with today.
- **A rating and a meeting note written at the same moment can clobber each other**,
  because both writers replace the whole `meetings` document rather than patching it.

### Fixed since

- **The Project Details panel was shown to everyone.** The gate was
  `Array.isArray(snap.projectDetails)`, which a refused reader also passes — see rule
  13. Both the meeting view and the project page now ask `detailsArrived(snap)`, and
  a test pins each. Found while building the project page, not by anyone using it.
- **`resources` and `chemistries` were stored but editable nowhere.** The meeting row
  never offered them and the project page only printed them, so since the split they
  could be read and never set. The project page now has a picker for both, and for
  `products`.

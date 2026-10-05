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
2. it has started: for a project raised as an opportunity, that meeting is **after**
   the one it was raised in (rule 5); for any other, it has no `start` date or
   `start` is on/before that meeting date, and
3. its status is active (`new`/`on`/`off`/`hold`) **or** it was closed
   (`done`/`cancelled`) on *exactly* that meeting date.

Consequence worth understanding: a project marked done in one meeting is visible in
that meeting forever (you can scroll back to it), but disappears the following week.
Closed work doesn't accumulate in the list.

## 5. An opportunity becomes a project at the next meeting, not this one

`F.opp` (board.html:1577-1585) creates two documents at once: the `entries` row and a
`projects` row with `status: 'new'`, `fromOpp` pointing back at the entry,
**`raisedOn` = the meeting date**, and `start` = the meeting date + 7 days.

Combined with rule 4, that means an opportunity raised today is *not* in Current
Projects today — it appears at the next meeting. Deliberate: you discuss it as a new
opportunity this week, then it becomes something you're accountable for.

**"Next meeting" is decided by `raisedOn`, not by `start`** (`raisedOn()` and
`projVisible` in `src/domain/queries.js`). It used to wait for `start`, which assumed
meetings are exactly a week apart. Moving a meeting's weekday broke that: a Monday
meeting four days after a Thursday one left that week's opportunities gone from New
Opportunities and not yet in Current Projects. Older opportunities without `raisedOn`
are read as `start` − 7 days, which is what it always was. `start` is kept but no
longer decides anything for an opportunity, and the project page does not show it.

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

## 11. The Projects list is ordered for working down, not for browsing

Off track first, then soonest due, undated last. That is the order somebody would
actually work down it, and it is why the list is not simply alphabetical.

**Undated sorts last on purpose.** An empty string compares below every real date as
text, so the obvious comparison puts everything undated at the top and buries the
work that has a deadline. `byWorkOrder` substitutes a far-future date instead.

**`priority` is deliberately ignored here.** It is per person per meeting — two
people's lists are numbered independently — so it cannot order a list that spans
both. It orders a person's block inside a meeting and nothing else.

### Sorting takes over from that order, and absent values sort last

Value, Win % and Due each sort on their header: first click in the column's natural
direction (**numbers descending, dates ascending**), second reverses, third returns
to the work order above.

**A project with no value sorts last in BOTH directions.** Direction applies only
among the projects that have one. No `estValue` means nobody has priced it and no
`winPct` means nobody has judged it; sorting those as zero asserts the project is
worth nothing and certain to be lost, which the data does not say. It is the same
rule as undated-last, generalised — and that rule exists because an empty string
compares below every real date as text, so the obvious comparison buried everything
with a deadline under everything without one.

The final tiebreak (title, then id) is **never reversed by direction**, or a block of
unpriced projects would list backwards between one click and the next for no reason.
The comparator has to be *total* rather than relying on `Array.sort` being stable,
because stability only preserves the input order and the input is rebuilt by the
adapter on every 60-second poll.

**A sort remembered on a column the reader cannot see is ignored.** A persisted
`projSort: 'value'` from a session with access would otherwise order the list by
something invisible.

### Filter menus come from the scoped set, not the filtered one

The Field and Project Type dropdowns are built from the values present after the
person and meeting scope, and **before** the search, the status chips and each other.
Options drawn from the searched set vanish while you type; options drawn from the
status-filtered set reshuffle when you touch an unrelated control; and two filters
narrowing each other's menus means you cannot change one without first resetting the
other. The cost is that a combination can show nothing, which is met with a count in
each label and an empty message that names the control responsible.

An empty list says **why** it is empty: a filter hiding everything reads differently
from a meeting with no projects, which reads differently again from a board with
none. "No projects" while a filter quietly hides them is how somebody concludes
their project is gone and enters it a second time.

---

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
Confidence, why-we-win, product selection, focus and resources all live on the
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

## 14. A list value can be renamed, and it follows every project

`field`, `projectType`, `focus` and `resources` hold their values on a project **by
value**, the same way an action holds its owner by name. So renaming one on the
Board settings screen has to cascade, exactly as renaming a person rewrites every
action they own (`renameListValue` in `src/domain/cascade.js`).

This is what makes a self-growing list safe to have. Anybody typing a new Field adds
it to the shared list, so a slip becomes shared vocabulary the moment it is typed —
and the only honest answer to that is being able to correct it in one action rather
than retyping it on every project that caught it.

**Merging is the point, not an error.** Renaming onto a value the list already holds
collapses the two: the old entry leaves, its projects move across, and the message
says how many did. Refusing it would leave you retyping the value by hand, which is
the situation the rename exists to get you out of.

Two shapes have to work. `field` and `projectType` hold a single string; `focus` and
`resources` hold an array, and the array case **de-duplicates** — a project tagged
both "Coatngs" and "Coatings" must end up with one, not two.

**Products is deliberately not renameable.** That list is coming from Dataverse, so
renaming a value here would edit a copy of something this app does not own, and the
change would be undone the moment the real list is connected.

**Deleting is not renaming.** `removeFromList` only rewrites the settings row: projects
keep the value, stay filterable, and the value is still offered by the suggestions,
which union in what is in use. So delete means "take it off the seed list"; rename is
the tool for retiring a term. Giving delete a cascade would destroy data where rename
preserves it.

---

## 15. What is not actually enforced

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
- **Seeing only your own meetings is a view, not protection** (`src/domain/scope.js`).
  Once a board has an admin, a person who is neither an admin nor in Tech Directors
  is shown only the meetings they attend, and everything filed against them. The
  whole board still reaches their browser: SharePoint permissions are per list, and
  every area's rows share one. Real isolation needs a store that can refuse rows
  (Dataverse, or a site per area). When it exists it should send exactly what
  `scopeBoard` produces, and the screens need no change.
- **The Admin switch shows controls; it does not grant them.** Non-admins get the
  roster, board settings and meeting settings drawn read-only. On SharePoint the
  lock is the site's admin group; an admin not in it has their saves refused, and the
  People page says why. A board with no admin treats everybody as one, and the last
  admin cannot be switched off.
- ~~**Role arrays aren't exclusive.**~~ **Fixed.** Every role change goes through
  `withRole` (`src/domain/meetings.js`), which removes the person from the other two
  lists.
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

- **`fmt()` renders an unparseable date as the literal text "undefined NaN".**
  Every caller today guards against a missing date first, so it does not show. Worth
  knowing before adding a new one: `confidencePoints` checks the date's *shape*
  rather than just its presence for exactly this reason, because that history is a
  JSON column somebody can edit by hand in SharePoint.

### Fixed since

- **Last-write-wins on a settings list.** A list is stored as one `{items}`
  document, and the local copy only refreshes on window focus and the 60-second poll.
  Two people adding different values inside the same minute: the second write
  overwrites the first's addition, silently. This has always been true of
  `addToList`, but it was confined to an admin screen one person used occasionally —
  Fields and Project types now grow from the project page, so it is on a path
  everyone uses mid-meeting, and a rename touching many projects widens the window
  further. Fixing it properly means merging on write rather than replacing.

- **A typo joins the shared list immediately.** `canonicalValue` kills case and
  whitespace variants; it does nothing for "Coatngs". The usage count on each chip is
  what makes the slip visible — junk reads `1` beside a real category's `14` — and
  rename (rule 14) is the cure. There is deliberately no minimum length, so "tbd"
  will join a list: a floor blocks nothing people actually type by accident and would
  reject a legitimate short name.

- **A field that filters as you type needs its value left alone.** `restoreForms`
  skips the value of anything carrying `data-input`, because such a field writes to
  ui state on every keystroke and the render that just happened already shows the
  right thing. Without the skip, clicking **Reset** on the Projects list captures the
  old search text out of the box and restores it over the blank one, so Reset appears
  not to work. Focus and the caret are still restored.

- **An open form emptied itself mid-entry.** The board reloads and redraws every 60
  seconds (`IDLE_POLL_MS`), and again whenever the window regains focus. `draw()`
  replaced the page with `root.innerHTML = ...`, and anything typed into a form that
  had not been submitted lived *only* in the DOM — so it went. Reported against the
  new-opportunity form, which is the first one long enough to reliably outlast a
  minute; every other form had the same hole and it just rarely showed. Fields
  carrying `data-edit` were never affected, because they write on change and the
  next render puts them back from the store. Fixed by `renderPreservingForms` in
  `src/lib/formstate.js`, which reads the open forms before the replace and puts
  them back after, caret included.

- **The Project Details panel was shown to everyone.** The gate was
  `Array.isArray(snap.projectDetails)`, which a refused reader also passes — see rule
  13. Both the meeting view and the project page now ask `detailsArrived(snap)`, and
  a test pins each. Found while building the project page, not by anyone using it.
- **`resources` and `focus` (then `chemistries`) were stored but editable nowhere.** The meeting row
  never offered them and the project page only printed them, so since the split they
  could be read and never set. The project page now has a picker for both, and for
  `products`.

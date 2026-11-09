# The practice run

`docs/REHEARSAL.md` asks **does it look right**. This asks **does it work** — you
driving a whole meeting through the board, start to finish, with nobody watching.

Every real defect in this project was found this way. The automated checks have
never found one before a person did. So this is the test that matters.

Budget an hour. **It doubles as your setup**: you are entering your real meeting, so
if it goes well you are ready, and if it goes badly it went badly in private.

---

## Before you start

```
python tools/serve.py 8010
```

Then open **http://localhost:8010/** — the plain address, no `?board=`. That is your
board, and it saves.

> If it sits on "Loading the board…", check the terminal. If it says *Could not start
> on port 8010*, an older server is still running and you are talking to that one.
> Stop every python window and start one. **Do not switch ports** — the browser saves
> your board per address, so `:8011` is a different, empty board.

Two commands first, both must be green:

```
node tests/all.test.js
node tools/layout-check.mjs
```

**Keep a notepad open.** Anything confusing, slow, missing or annoying goes on it.
That list is the point of the exercise — more than whether it crashes.

---

## Part 1 — Setup (about 30 minutes)

Each step needs the one before it, so do them in order.

### 1. The people

**People → + Person**, once for everyone in the meeting. The form lists every
meeting with a role picker; set their role in any that already exist.

Fill in the **work email** even though it says optional. It is what matches somebody
to their Microsoft sign-in later; skipping it means hand-matching everyone at
cutover. It stays editable in the table afterwards.

Then tick **Admin** for yourself. Until somebody is an admin, everybody is treated as
one and sees everything; once somebody is, only admins get the roster and settings
controls, and everybody else sees only the meetings they attend.

### 2. Say who you are

**Sidebar → "You are"** → yourself.

Skip this and the board has no point of view: it opens showing everybody's work
rather than yours, and any note you write records no author.

### 3. The meeting

The **+** beside "Internal & initiatives" in the sidebar makes one and drops you into
its settings. Set:

- **Name** — what the room calls it
- **Kind** → **Area** (it starts as Internal, which is why it appears under the wrong
  heading until you change it)
- **Day** and **Length**
- **Attendance** — tick each person as Reporting, Supporting or Optional

Reporting members are the ones who get a turn in each segment.

### 4. The projects

Go to **Current Projects** (segment 3). Under each person, **+ Project**.

> ⚠️ A project can only be added under somebody who is already **a member of this
> meeting**. If a name is missing, they are not on the attendance list.

For each: the customer, the name, a due date, a status. Then open one and fill in the
details — Project Type, Mission & challenges, Field, System, Product selection, the
commercial numbers — to see how long a full one takes. That timing is worth knowing before you ask fifteen people to do it.

> ⚠️ **Enter today's existing projects with + Project, not + Opportunity.** An
> opportunity waits on the Horizon until somebody promotes it, so something already
> under way entered as one will not be in Current projects until you do.

### 5. What is already owed

**+ Action** for anything outstanding, with an owner and a date. Put at least one in
the past, so you can see the overdue handling in Part 2.

### 6. Save

**Board settings → Download a copy.** Check it lands in your Downloads. You have
just spent half an hour; do not leave it in one browser.

---

## Part 2 — Run the meeting (about 20 minutes)

Work the three segments, as though the room were there. Projects is the main one;
Wins & Losses and Issues are a click away when one comes up. Say the words out
loud if you can — it catches things reading never does.

| # | Segment | Do this | Watch for |
|---|---|---|---|
| 1 | **Projects** — Horizon | **+ Opportunity**, then Promote one, Put one on hold, Cancel one. Fold the section and unfold it | Promoted drops into Current projects. Held stays on the Horizon |
| 2 | **Projects** — Current | Set a status on each. Mark one **off track**. Use the ▲▼ arrows. Click **Filter actions** | Off-track should appear in Issues. Does the rail show that project's actions? |
| 3 | **Wins & Losses** | **+ Win or loss** for two people. Make one a loss, which asks what you will do differently | Does the extra question appear only for a loss? |
| 4 | **Issues** | Work the queue: agree an action, **one** owner, a date. Then in **Already Owed**, push one date and re-date another | Does the owned issue leave the queue? Does the overdue label update without a reload? |
| 5 | **Summary** (top right) | Open it, press **Email** | Outlook opens addressed to the meeting, with the summary in it or ready to paste |

Then the between-meetings screens: **Action items** (sort each column, search, check
the Origin column, Reset), **Projects**, **Timeline**, and a **project page**.

**Finish: reload the page (F5).** Everything must still be there. Then **Download a
copy** again.

---

## What to write down

Answer these honestly while it is fresh. Vague notes are still useful; no notes are
not.

1. **What took too many clicks?**
2. **What did you expect to be there and could not find?**
3. **What did you have to think about** that should have been obvious?
4. **What would embarrass you** if the room saw it?
5. **What is missing** that your meeting actually needs?
6. Anything that looked broken — screen, what you did, what happened.

Send me that list. It is the next change set, and it is worth more than anything I
would come up with unprompted.

---

## Known, and not worth reporting

So you can tell a decision from a defect:

- **An opportunity does not become a project until somebody promotes it.** Deliberate.
  Use the Promote to project / Put on hold / Cancel links on its tile under New
  Opportunities. Undecided ones come back there every meeting.
- **The board says "Local board — this computer only".** Correct until SharePoint.
- **A fresh board is completely empty.** There is no sample data on your board; the
  demo moved to `?board=demo`.
- **The work email is invisible after you enter it.** A real gap, already on my list.
- **Two people editing at once can lose each other's work.** Cannot happen yet —
  it is one browser — and it is fixed before SharePoint, not before you use this.

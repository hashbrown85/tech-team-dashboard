# Rehearsal checklist

Run this before the board is used in a real meeting, **on the machine that will
present, on the meeting-room network, through the projector**. Half the risks here
are environmental and none of them show up on your desk.

Budget 45 minutes. Work down in order — it puts the worst failures first.

---

## Before you start

**The browser.** Use the one you will use on the day. Maximise it. Zoom at 100%
(`Ctrl+0`).

**The real width.** Open the console and run `window.innerWidth`. That number, not the
projector's resolution, is what the layout reacts to — 1920×1080 at 150% Windows
scaling is an effective **1280px**, which is past the point where the meeting screen
drops its side rail below the agenda instead of beside it. Write the number down; step
9 uses it.

**The theme.** Nothing in the app chooses light or dark — it follows Windows. For the
live run, open `index.html` and add `data-theme="light"` to the `<html>` tag:

```html
<html lang="en" data-theme="light">
```

One attribute, no code, and an OS setting can no longer flip your board mid-meeting.
Rehearse dark anyway at step 8, in case the attribute gets lost.

**Serve it properly.** `python tools/serve.py 8010`, then open
`http://localhost:8010/`. Browsers refuse ES modules opened as files.

> **Open `index.html`. Never `board.html`.** `board.html` is the original
> single-file version, kept for reference. It has its own stale copy of the entire
> stylesheet, so rehearsing against it tells you nothing about what will ship.

**The network.** With the page open on the meeting network, check the console for
blocked requests to `fonts.googleapis.com`. If the corporate network blocks it, the
board falls back to system fonts, every measurement shifts, and a layout that fitted
at your desk may not fit in the room. Better to find out now.

---

## Step 0 — the two commands

```
node tests/all.test.js
node tools/layout-check.mjs
```

Both must be green before you open a browser. The second one reads the stylesheet and
checks the markup against it — it is the only thing that catches a class nothing
styles or a row with the wrong number of children, which is how five bugs reached you
last time.

---

## What to look for, at every screen

Scan in this order. The first two are the failures that would actually stop a meeting.

1. **Vertical text** — a column of single letters where a title should be. Look
   hardest at project rows, issue titles, action text, the attendance list and the
   sidebar name.
2. **A horizontal scrollbar on the page.** The timeline is the known offender. If the
   page is wider than the window, the sidebar goes off the edge and there is no way
   back to it.
3. **A row that wrapped onto an extra line** when it should be one — status buttons
   dropping below a project name, arrows on their own line, a date below its action.
4. Text clipped, overlapping, or running underneath something else.
5. Numbers that read wrong from the back of the room.

---

## The pass

Open `http://localhost:8010/?board=big` — a deliberately oversized board of invented
data: 20 people, 10 meetings, 56 projects, a year of history. The tab title says **BIG
BOARD** so you cannot show it to anyone by mistake.

| # | Where | What it is stressing |
|---|---|---|
| 1 | **Overview** | 56 projects in the numbers strip; the meeting cards with ten meetings; the attendance list at 20 names |
| 2 | **Northern Area 1 → Wins & Losses** | the busiest meeting. Long "why" text in a three-column row |
| 3 | **→ New Opportunities** | open the form *and* close it again. It is the longest form in the app |
| 4 | **→ Current Projects** ⚠ highest risk | the 73-character unbroken project name; the 206-character one; a project with six focus chips and four products; status buttons wrapping; the priority arrows; open a project's details and check the confidence line inside |
| 5 | **→ Issues** | half the meeting lives here. 90-odd issues, all three severities, a resolved one, and one issue carrying fifteen actions |
| 6 | **→ Rate the meeting** | 20 raters, the trend line, and the summary preview |
| 7 | **Between meetings** | Projects list — type in the search box, sort by each of Value, Win and Due, use the Field and Type filters, then hit Reset and confirm the search box actually empties. Then the Action register, the Timeline in both groupings, a Project page, and People & settings |
| 8 | **Dark mode** | switch Windows to dark (or set `data-theme="dark"`) and repeat 1, 4 and 5 quickly. **Nothing has ever rendered this.** The brand colour changes from dark red to light red, so check the header, chips, the selected-project outline, and that focus outlines are still visible |
| 9 | **Narrow** | drag the window to roughly 1100, 980, 700 and 560 px. Each is a point where the layout rearranges. You will not present narrow, but a laptop screen mid-meeting is one alt-tab away |
| 10 | **Reload mid-flow** | with a timer running and a half-filled form open, press F5. The form should keep what you typed and the meeting should come back where you left it |
| 11 | **The collapsed menu** | press the toggle at the top of the sidebar. Check the tiles actually get wider (see the note below), that the meeting initials read clearly at ten meetings, that the strip scrolls if it needs to, and that you can reach every screen from it without expanding. Tab to the toggle and press Space twice — focus must still be on it |

**Keyboard check, at step 7:** press Tab until focus reaches a sortable column header
on the Projects list. The outline there is set specially, because the normal one is
invisible against the red header. Confirm you can see it.

**Finally, do it again on the real board** — `http://localhost:8010/` with no
`?board=big`. That is closer to what the room will contain on day one, and it confirms
the big board did not hide a small-data problem.

---

## Two things already known

Worth a look while you are there, rather than a surprise on the day.

**Vertical text should now be gone for good.** It was diagnosed wrongly the first
time: the cause is not the text property but the row. A title sitting in a track
floored at zero collapses when an uncapped neighbour shares its row, because grid
gives that neighbour its full width first. The opportunity rows and the action rows
now place their sub-lines underneath instead of beside, and `layout-check.mjs` fails
if that is ever undone. Step 2 and the side rail at step 5 are where to confirm it.

**The issue header.** The stylesheet lays out four columns and expects the issue title
in the third — but the markup only puts three things there and the title sits
underneath instead. The effect is that the toolbar on each issue hugs the severity chip
rather than sitting out to the right. It is not broken, but it is not what the
stylesheet intends, and two mobile rules point at something that no longer exists.
Decide whether it looks right at step 5; it is a design call, not a bug fix.

**Dark mode is genuinely untested.** Not "lightly tested" — nothing in the app, the
tests or the tools has ever rendered it. Step 8 is the first time. Allow for finding
something.

**Whether collapsing the menu gains you anything depends on your width.** The content
column is capped, so on a wide screen the space freed up would otherwise just become
more margin. Collapsing raises that cap to 1600px to compensate, but the effect is very
different at 1280px (roughly +180px of tile) and at 1920px (the cap is what is binding,
not the sidebar). This is the number from the console at the top of this page, and step
11 is where it is worth actually measuring rather than assuming.

---

## If you find something

Note which screen, which step, and the width from the console. With `?board=big` the
data is identical every time it loads, so anything you see can be looked at again.

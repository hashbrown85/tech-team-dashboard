# Tech Team Dashboard

A board for running the tech team's recurring meetings: a five-segment agenda,
an issue-to-action pipeline, project status, action items and meeting ratings.

## Running it locally

```
python tools/serve.py
```

Then open <http://localhost:8000/>.

Use that rather than `python -m http.server`. The plain server lets the browser
cache JavaScript modules, so after an edit a normal reload can keep running the
previous version of the code — and the symptom looks like "the fix didn't work".
`tools/serve.py` is the same simple static server with caching turned off.

The app cannot be opened as a file. It is built from JavaScript modules, and
browsers block those on `file://`, so it has to be served over `http://`.

By default it runs on invented demo data, with no sign-in. See `src/config.js`
to point it at real SharePoint lists.

## Tests

<http://localhost:8000/tests/tests.html> — or, without a browser:

```
node tests/all.test.js
node tools/layout-check.mjs
```

Two commands, not one. The second reads `assets/theme.css` and `index.html` off disk
and checks the markup against them — a class nothing styles, a grid row with the wrong
number of children, `overflow-wrap: anywhere` creeping back. It **cannot** live in the
first, because that suite also runs in a browser via `tests/tests.html` and nothing it
imports may touch `node:fs`.

`?board=big` renders a deliberately oversized board of invented data — 20 people, 10
meetings, 56 projects — for checking a layout at realistic size. See
[`docs/REHEARSAL.md`](docs/REHEARSAL.md) before running the board in a real meeting.

## What's where

| | |
|---|---|
| `docs/DATA_MODEL.md` | every collection and field — the only schema that exists |
| `docs/BUSINESS_RULES.md` | the rules, in prose. **Read before changing `src/domain/`** |
| `docs/REHEARSAL.md` | what to check before a meeting is run from this |
| `tools/layout-check.mjs` | markup vs stylesheet; the checks the test suite cannot make |
| `tools/bigboard.mjs` | an oversized board of invented data, for `?board=big` |
| `src/domain/` | the rules as code. No DOM, no store — pure functions over a snapshot |
| `src/views/` | HTML-string builders. Pure functions, so every screen is testable |
| `src/adapters/` | where the data lives: in memory, or SharePoint via Graph |
| `src/store.js` | the local copy of the board, and the only thing that writes to it |
| `tools/provision.mjs` | prints the PowerShell that creates the SharePoint lists |
| `board.html` | the original single-file app, kept for reference |

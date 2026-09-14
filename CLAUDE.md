# Context for AI agents working in this repo

## Who
Kevin Wilson — Technical Operations and Innovation (national scope) at a
chemical company. Not a professional software developer. Explain what code
does in plain language; prefer obvious code over clever code.

## What this repo is for
A dashboard, viewable in a browser, that tracks the tech team's projects
and initiatives: what's being worked on and its status.

## Hard rules
1. NEVER copy company workbooks, exports, or data pulls into this repo.
   Read/fetch them from their source location at runtime, or via a build
   step that writes to a gitignored folder. `data/` and `output/` are
   gitignored.
2. NEVER commit .xlsx/.xlsm/.csv files, or any file containing real
   project/customer data. If one needs committing, stop and ask.
3. No credentials, API keys, connection strings, or customer names in
   code or commits.

## Conventions
- Plain HTML/CSS/JS to start (framework TBD as the project takes shape —
  ask before adding a build system or heavy dependency)
- Keep pages/scripts named for what they do
- Print/log what's happening as it runs; fail loudly with a clear message

## Style
- Small commits, one change each

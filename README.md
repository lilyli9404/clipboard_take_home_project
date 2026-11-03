# Bellhaven CRM ownership review

A local, approval-gated reconciliation tool for the Clipboard Sales Operations Analyst exercise. It crawls the fictional Bellhaven website, matches every discovered community against the complete CRM, saves evidence and proposals, and writes only changes explicitly approved in the review UI.

## Run

Requires **Node.js 24 or newer**. There are **no npm dependencies** and no LLM calls.

```sh
node server.mjs
```

Open **http://127.0.0.1:8765**, expand **Connect CRM token**, and enter your personal exercise token. The server retains it only in memory. It is never sent to the website frontend, returned in API responses, embedded in source, or written to the SQLite database. The local token-entry form sends it only to the loopback server, which authenticates calls to the assessment's documented API origin.

Alternatively, supply `CRM_TOKEN` in the process environment. `PORT` defaults to 8765. `DATA_DIR` defaults to this project's `data` folder. Use a separate data folder for each CRM sandbox; the app binds the folder to a token fingerprint to prevent accidental cross-account reuse.

This task's machine has Node at `C:\Users\248\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`. If `node` is not on your PATH, invoke that executable with the absolute path to `server.mjs`.

## Review flow

1. **Run read-only scan**. This does not write to the CRM.
2. Filter by category, current CRM parent, Bellhaven affiliation, target parent, date or status. Red important records always sort first. Dates use America/New_York. A group matches a parent filter when any candidate has that parent.
3. Each facility has one review record with multiple applicable labels. Select the corresponding CRM account, choose fields to update, and explicitly select any duplicates to inactivate. Confirm identity where needed. Click **Preview selected operations**, inspect every operation, then **Approve and execute these operations**. Reject saves a decision without writing to the CRM.
4. **Read affected account(s) from CRM** shows a fresh API read. For the required demo, also show the change in the assessment's own CRM browser.
5. Re-run the scan. Identical decided proposals stay decided. Approved field corrections no longer generate a diff.
6. Use **Export audit** to download the current decision history and proposal evidence.

An approval can include multiple API operations, notably a CHOW creation followed by a pointer update on the old account. The preview identifies every affected record. Grouped candidates are not automatically inactivated: only explicitly selected duplicates are changed. Even formatting and missing-field proposals require approval, as required by the exercise.

## Pipeline and daily schedule

```sh
# CRM_TOKEN must be supplied securely in the process environment.
node cli.mjs
node --test test/*.test.mjs
```

`schedule/bellhaven.cron` is the proposed daily schedule. It is **not installed or active**. The scheduler runs only the read-only scan and queue-generation path. The server and scheduler must share the same durable `DATA_DIR`. The SQLite operation lock prevents concurrent scans/approvals. Do not use an ephemeral daily runner without persisting that directory, or decision history would be lost.

## Implementation

- `lib/source.mjs`: bounded same-origin crawl, explicit directory count validation, detail parser, and paginated CRM client.
- `lib/review-model.mjs`: multi-label classification, candidate groups, explicit selections and execution previews. `lib/match.mjs` retains shared normalizers and legacy behavior for old records.
- `lib/distance.mjs`: Census address validation and estimated straight-line distance; failed/ambiguous geocoding remains an unresolved review item.
- `lib/store.mjs`: SQLite proposals, decisions, audit events, scan history and operation locking.
- `lib/service.mjs`: read-only scans, source/CRM freshness checks, approval-only writes, journaling and post-write verification.
- `server.mjs` and `public/`: localhost review application.
- `test/*.test.mjs`: 23 behavioral tests including filters, groups, distance boundaries and failure recovery, using a fake CRM; no tests mutate the live sandbox.
- `data/snapshots/`: timestamped source HTML and full CRM/contact snapshots, created by actual scans.
- `data/review.sqlite`: durable reviewer decisions and operation progress. Keep it for re-runs and the interview.

## Matching and policy choices

- Crawl the home page, About page and **every directory page**, then follow community links. The initial directory advertises 34 entries; the homepage links to Findlay as a 35th community. Count mismatches or failed detail parsing abort the scan rather than treating a partial crawl as evidence of absence.
- Read **all CRM accounts and contacts** through pagination, not just accounts already labeled Bellhaven.
- Normalize abbreviations, phone formatting, state names and four-digit ZIPs with a missing leading zero. Exact street numbers are preserved; only a one-character typo in a sufficiently long string is treated as similar. Keep source values visible and propose canonical website values for formatting differences.
- Candidate discovery and identity confirmation are distinct. Same-name records in other states remain visible as remote-move/bad-match candidates. Confidence uses city/state and street, or name with independent phone/active-contact evidence. Ambiguous or moved candidates require explicit identity confirmation.
- Labels 1–12 cover format, service/phone conflicts, rename, same-city move, nearby move, CRM missing fields, website missing fields, ZIP conflict, remote move, multiple candidates, new account and website absence. Parent/CHOW/identity/distance-unknown labels add context. Labels overlap: the same-city street-plus-ZIP case carries both move and ZIP labels.
- Both nonempty but unequal service/phone values use category 2; CRM-only empty fields use 6; website-only empty fields use 7 and never clear CRM automatically.
- Every multiple-candidate facility is one grouped review. The reviewer selects the survivor and individually selects confirmed duplicates. No candidate is preselected in a group. The preview shows selected field writes and duplicate inactivation/link operations.
- A website-absent Bellhaven account is set to **Needs Review**, with an explanation. Absence is not proof of sale or closure, so the tool does not guess a new parent or delete the account.
- **CHOW:** if changing parent and both `lifetime_revenue > 0` and `outstanding_ar > 0`, create a new account under Bellhaven and change only `chow_current_account` on the old account. Do not carry old financial balances into the new account. Otherwise, re-parent the existing account directly.

## Re-runs, stale evidence and interruption recovery

Proposals use a SHA-256 key derived from the action, community URL, affected account ID(s), and proposed field values. Dates, HTML formatting and volatile CRM timestamps do not change that decision identity. Identical approved/rejected proposals are not re-opened; materially different actions get a new key. No-longer-current pending proposals are superseded.

Before an approval, the app re-reads the website community and every affected CRM account. A changed reviewed snapshot blocks the write. A read-only rescan regenerates pending evidence. Financial safeguards are checked again. Source absence is re-checked against a complete crawl before approving a not-listed proposal.

Each create has a unique marker in its CRM note and a durable local write-ahead journal. A retry finds a successfully created account by marker rather than issuing a second POST. A CHOW retry can finish the old-account pointer without another create. If a create timed out and no marker can be found, the tool deliberately stops for manual reconciliation rather than blindly retrying a non-idempotent POST. PATCH operations are verified by read-back and unrelated fields are checked for unintended changes.

## Known limitations and explicit tradeoffs

- The API has no documented conditional-write, transaction or server-side idempotency contract. Freshness checks reduce races but cannot eliminate a third-party write between the read and PATCH. CHOW is a journaled two-step operation, not an atomic server transaction.
- The HTML parser is designed for the provided server-rendered `dt/dd` markup, validates required fields and fails closed on markup changes. A broader production scraper should use a maintained HTML parser and schema monitoring.
- Ambiguous same-address records remain a human investigation task. The reviewer can reject, choose a corresponding account and confirmed duplicates, or explicitly request a new account. No merge or delete is performed.
- Straight-line distance uses two individually validated coordinates from the public [US Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html). Coordinates are street-range estimates. A mismatched/failed address result produces “distance unavailable,” never an assumed nearby move. No key is needed. Responses are cached for 24 hours; scans attempt up to ten unresolved pairs per run.
- Parent dropdowns are data-driven and groups can span multiple parents. The decision store separates target-parent scopes. The current source crawler is configured for Bellhaven; adding another operator requires its source adapter and target-parent configuration, not merely selecting a filter.
- Contacts and account phone numbers can be stale. They corroborate matches; they are not universal authority. Address and geographic evidence remain visible to the reviewer.
- Care-offering serialization is based on the API's observed string field. The published OpenAPI does not declare request schemas or allowed care values. Multi-value writes require live approval/read-back validation; there was no speculative live write during development.
- A rejected proposal stays rejected if the proposed action is identical. Reconsideration requires an explicit change in the reconciliation policy or a separately reviewed manual decision; there is no silent reset button.
- This is a local single-reviewer application, not an internet-facing service. It binds to loopback, validates Host and mutation Origin/CSRF, and does not implement multiuser authentication.

## Submission status

See `WRITEUP.md` for the initial findings and `DEMO.md` for a suggested two-minute walkthrough. **A finished tool alone does not complete the assessment:** approved corrections must land in the sandbox, the review demo must be recorded, and the final form must be submitted by the candidate. The initial development run made no live CRM writes.

See [REVIEW_RULES.md](REVIEW_RULES.md) for the complete English classification and trigger specification.

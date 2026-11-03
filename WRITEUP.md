# Bellhaven reconciliation — implementation and findings

## Approach
The Node.js pipeline crawls the home page, About page, all directory pages and every linked community detail. It fetches all CRM accounts and contacts, compares normalized identity and stores evidence/proposals in SQLite. A local English review UI displays multiple difference labels and all candidates for each facility. The reviewer selects the corresponding account, fields and any confirmed duplicates, previews operations, and approves or rejects.

No paid API, LLM runtime, deployment or external database is required. AI assistance was used to develop and test the implementation. Runtime matching is deterministic. See REVIEW_RULES.md for the full classification and trigger specification.

## Current read-only findings (November 2, 2026)
The complete scan found 35 website facilities, 121 CRM accounts and 67 CRM contacts. The updated policy generates 38 grouped facility review records, including 11 red priority records. Differences are multi-label, so category counts are not additive. The earlier 27-record plan is preserved as superseded history.

The directory advertises 34 entries across three pages, while the homepage links to Findlay as the 35th. A partial crawl cannot establish absence.

Five facilities have grouped candidates: Monroe, Kettering, Owosso, Port Clinton and Erie. All candidate records appear together, and the reviewer decides which account corresponds to the website and which, if any, are duplicates.

Amberly Manor has a same-name Colorado candidate while the website facility is in Ohio. It receives remote-move / incorrect-match and identity-confirmation prompts. No geographic conflict is silently resolved.

Three target-parent accounts are absent from the website: Alliance, Coldwater and Sandusky. They receive red existence-review items proposing Needs Review and an explanatory note, preserving ownership and finances.

Tiffin and Marietta require CHOW if their parent change is approved: create a new current account and update only the old-account pointer. Both old accounts have positive lifetime revenue and outstanding AR.

Formatting, substantive phone/care conflicts, rename, address and ZIP differences are visible as separate labels. Current-parent, target-parent, Bellhaven-affiliation, category, date and status filters support focused review.

## Validation and limitations
23 automated tests pass, covering classification boundaries, multiple labels, grouped selections, geographic thresholds, filters, source completeness, pagination, rejection without writes, stale CRM protection and CHOW recovery. Tests use a fake CRM. The development scans and UI previews have made no live CRM writes.

Coordinates, when available, are Census street-range estimates rather than surveyed facility locations. Failed geocoding remains unresolved. The current source adapter is Bellhaven-specific, although the filters and decision store model multiple parent scopes. The external API lacks atomic multi-account transactions or conditional-write guarantees; operations use freshness checks, durable journaling and read-back verification.

## Submission status
This is a working review tool and a pending review queue, not a claim of a corrected CRM. The candidate must review and approve the appropriate changes, verify the resulting CRM state, record the required demo, submit its accessible link and report actual time honestly. Export the final audit after those decisions.

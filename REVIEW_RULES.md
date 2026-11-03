# Facility reconciliation: review categories and trigger conditions

## Purpose and comparison model

Compare each facility on the operator's website with the full CRM, including accounts under other parents. A facility produces one review record containing every plausible CRM candidate and all applicable difference labels. Categories are not mutually exclusive: a rename, phone conflict and missing CRM field can appear together.

The website supplies the proposed current profile; it is not sufficient on its own to prove that an ambiguous CRM account represents the same legal or operating facility. Reviewers retain responsibility for identity, ownership and duplicate decisions.

## Normalization and candidate discovery

- Compare website `name`, `street`, `city`, `state`, `zip`, `care_offerings`, and `phone` against CRM `name`, `billing_street`, `billing_city`, `billing_state`, `billing_zip`, `care_type`, and `phone`.
- Normalize case, punctuation, common street/direction abbreviations, state names and telephone formatting. Pad a four-digit ZIP with a leading zero; compare the five-digit ZIP prefix. Map equivalent care terms to a consistent care label.
- Name normalization handles selected equivalents such as Centre/Center and Rehab/Rehabilitation. A one-character spelling difference is tolerated only for strings at least eight characters long with identical numeric sequences. Similarity is deliberately conservative and is not a general fuzzy-name score.
- A candidate is confidently associated when city and state agree and either street agrees, or name agrees with independent phone or active-administrator corroboration. Similar names remain possible candidates even when geography conflicts. Matching city/state with independent phone or administrator evidence can also produce a candidate.
- Ranking helps display evidence; it does not automatically select a survivor or authorize a write. An ambiguous identity, move or inactive-account reactivation requires explicit reviewer confirmation.
- Empty means null, absent, blank string or empty list. Zero and false are not empty. Both-empty fields produce no difference.

## Categories and triggers

| # | Review category | Trigger condition | Reviewer prompt / proposed action |
|---|---|---|---|
| 1 | Formatting normalization | Both values are present and equivalent after normalization, but the displayed values differ. Examples: Street/St, phone punctuation, minor spelling, ZIP missing its leading zero. | Verify and standardize to the website/canonical value. |
| 2 | Care / phone confirmation | Both sources have nonempty care or phone values that differ after normalization. For an otherwise matching facility, these are substantive field conflicts. | Confirm the service scope and/or contact number. Empty values belong to categories 6 or 7. |
| 3 | Possible name change | A plausible account has a substantively different name, with address or independent identity evidence supporting comparison. | Has the facility been renamed? Review address, phone and administrator evidence. |
| 4 | Possible same-city move | Name or independent evidence supports the candidate, state/city agree, but street differs substantively. | Confirm a same-city move or address correction. If ZIP also differs, also add category 8. A PO box versus a street address may be an address correction rather than a move. |
| 5 | Possible nearby move | Same-state candidate with a different city/address; both full addresses can be reliably geocoded and estimated straight-line distance is at most 20 miles. | Confirm whether the facility moved nearby. Distance alone does not establish identity. |
| 6 | Fill missing CRM fields | A plausible facility match has a website value but the corresponding CRM field is empty. | Propose filling the missing field. Do not confuse an empty field with a missing whole account. |
| 7 | Verify CRM-only information | A plausible facility match has a CRM value but the corresponding website field is empty. | Verify the CRM value. Retain it; no deletion or empty-value PATCH is proposed. |
| 8 | ZIP confirmation | Both ZIPs are present but differ after normalization. | Confirm the ZIP. This can stand alone or accompany a move. Cities can contain multiple ZIP codes, so a street-plus-ZIP difference is not automatically a ZIP error. |
| 9 | Remote move / incorrect match | A same-name/plausible candidate crosses state boundaries, or a same-state different-city candidate has a reliable straight-line distance greater than 20 miles. | Is this a remote move or a different facility with a similar name? Require identity confirmation before changing the candidate. |
| 10 | Multiple accounts / duplicates | One website facility has more than one plausible CRM account. | Present all candidates together. Reviewer selects the corresponding/surviving account and individually selects confirmed duplicates to inactivate. No survivor or duplicate is automatically selected. |
| 11 | New facility review | No plausible CRM account is found anywhere in the full CRM; alternatively, the reviewer explicitly confirms that all displayed candidates are different facilities. | Decide whether to create an account under the target parent. A fresh duplicate check precedes creation. |
| 12 | Facility existence review | A current CRM account under the target parent has no plausible facility in a complete website crawl. | Show in red at the top. Verify existence and ownership. Proposed action is `Needs Review` plus an explanatory note; absence alone does not justify closure, deletion or a guessed parent. |

Categories 2, 6 and 7 are disjoint for a single field. Different fields on the same facility can trigger all three. Candidate-level labels are combined on the facility record, so a group can contain differences from several candidates. The selected candidate's exact differences and final operations remain visible before approval.

## Additional ownership and identity labels

| Label | Trigger | Treatment |
|---|---|---|
| Parent ownership confirmation | Candidate `parent_id` differs from the website target parent. | Propose the target parent, subject to the financial rule below. |
| CHOW billing preservation | Parent must change **and** `lifetime_revenue > 0` **and** `outstanding_ar > 0`. | Create a new current account under the correct parent. Change only `chow_current_account` on the old account to the new ID. Preserve all other old-account fields and balances. |
| Identity confirmation | Insufficient corroboration, material geographic conflict, or an inactive candidate. | Require explicit identity confirmation; do not silently assume a match. |
| Distance unavailable | A same-state different-city comparison cannot obtain two reliable full-address coordinate results. | Show as a priority item. Never treat an unavailable distance as zero or as within 20 miles. |

If either financial condition is false, a confirmed parent change can update the existing account directly. Duplicate handling is separate: explicitly selected losing records are marked `Inactive`, linked through `duplicate_of_account`, and given a reviewer-confirmed-duplicate note. No merge, delete or silent contact transfer occurs.

## Review interaction and write gate

1. Inspect source evidence and all candidate accounts, including parent, revenue and AR.
2. Select the corresponding account for a group; select any confirmed duplicates separately. Select the fields to apply. For a new facility, explicitly choose that outcome.
3. Confirm identity when required and record the reasoning.
4. Open **Preview selected operations**. It lists CREATE/PATCH operations and before/after values. For CHOW, the new account uses the website profile and the preview clearly shows the old account's pointer-only update.
5. Click **Approve and execute these operations** to write. Rejection records a decision without CRM writes. The scan and preview never write to CRM.

The exercise requires approval for every CRM write. Categories 1 and 6 are therefore prepared as straightforward suggestions but still pass through the approval gate. Category 7 has no destructive write. Every approval refreshes the evidence and affected CRM records; stale evidence blocks execution. Writes are read back and unrelated fields are checked for preservation.

## Filtering, dates and priority

- **Difference category:** match any label on the record.
- **Current CRM parent:** match any candidate's parent, including unparented accounts; options come from CRM parent data.
- **Bellhaven affiliation:** all candidates under Bellhaven, some under Bellhaven, other parents, all unparented, or no candidate.
- **Website target parent:** the operator whose website generated the review. This differs from current CRM ownership. The current scraper is configured for Bellhaven; another operator needs its own source adapter/configuration.
- **Date range:** first detected, last observed in a scan, or latest candidate CRM update. Display/filter dates use America/New_York. Date boundaries are inclusive.
- **Priority:** red items always precede standard items, even when sorting by time. Priority order is website absence, CHOW, multiple candidates, remote move, unavailable distance, and unresolved identity. Standard items follow, ordered by ownership change, creation, moves, ZIP, rename, care/phone, CRM-only information, missing fields and formatting.

## Distance calculation and operational limits

The [US Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) returns street-range coordinate estimates. The implementation accepts a unique result only when normalized street, city, state and ZIP agree with the full input. It uses the Haversine formula for estimated straight-line miles. Unmatched, ambiguous or timed-out results stay unresolved. Results are cached for 24 hours; a scan attempts up to ten unresolved pairs.

Review decisions, evidence and operation progress persist in SQLite. Stable proposal identities suppress identical decided proposals on subsequent scans; materially changed evidence creates a new review item. Pending records superseded by a new plan remain in history. Daily configuration runs the read-only pipeline against the same durable data directory. Multi-step CHOW operations use an operation marker and journal to recover safely; the external API does not provide an atomic transaction.

## Code map and validation

`lib/review-model.mjs` implements categories, grouped candidates, decision selection and execution previews. `lib/distance.mjs` implements geocoding and distance. `public/review-filters.mjs` implements filter/date/priority behavior. `lib/service.mjs` owns the approval-only write path. `lib/store.mjs` persists history and scoped scans.

Run `node --test test/*.test.mjs`. Behavioral tests cover category boundaries, combined labels, the 20-mile boundary, grouped selections, parent/date filters, CHOW preservation, rejection without writes, repeated decisions, stale evidence and interrupted-operation recovery. Tests use a fake CRM.

# Progress

Resume from here after any interruption. Update it at the end of every step. Client and project
details are kept outside this public file, in the gitignored `private/NOTES.md`.

## Phase 1 — Design + DEWA approval pack

| # | Milestone | Status |
|---|---|---|
| M1 | Foundation: PWA shell (phone + laptop), local database, library with review queue, sync client, public-repo guard, CI deploy | **Done 2026-09-17**, except the sync connection test on a real device |
| M2 | Source registry: confirm current editions on official sites, extract PDF text locally, draft candidate clauses | **In progress**: first pack (7 sources, 26 clauses) done 2026-09-17 |
| M3 | Load schedule engine (multi-building, standby, DF with source, headroom vs NOC) | To do |
| M4 | Calculations: breakers, cables (private data pack), voltage drop, PF correction, fault level, generator check | To do |
| M5 | Pre-submission checks, approval pack exports, submission tracker | To do |
| M6 | Item lookup slice and the pilot project | To do |

Later phases: 2 QA/QC, T&C, handover · 3 MTO and procurement · 4 site execution.

## M1 — what exists

- `src/library/provenance.ts`: the single gate for every value. It accepts only verified clauses from
  non-superseded, non-note sources, plus labelled declared values.
- `src/pages/LibraryPage.tsx`: sources, clauses, and the Review queue (candidate → verified or
  rejected, with a note).
- `src/sync/appsScript.ts`: client for the existing Site Tasks Sync script (`ping`,
  `attachUpload`, `attachDownload`). It always sends an empty project, so the tracker's tabs are
  never created or renamed.
- `src/db/backup.ts`: JSON backup and restore. The sync token is excluded.
- `scripts/guard-public.mjs`: blocks PDFs, spreadsheets, drawings, `private/`, `library/raw/`,
  `datapacks/`, secret-looking strings, and local private terms.
- Checked in the browser: phone and laptop layouts, the add source → add clause → review → verify
  flow, the URL validation message, and a reload with the server stopped (loaded from the offline
  cache).

## M2 — done so far (2026-09-17)

- **Editions checked on the official sites:**
  - Dubai Building Code 2021 (DM page, last modified 15 Sep 2026);
  - DEWA Regulations for Electrical Installations 2017 (DEWA "Circulars & Regulations" page);
  - UAE Fire & Life Safety Code, September 2018 (DCD page, updated 11 Jun 2026);
  - Al Sa'fat 2nd edition, January 2023 (DM page; 1st edition marked superseded).
- **Not confirmed as latest:** the TRA FTTx specification manual V1.1, the Etisalat FTTH design guide
  (Rev 1.0, January 2013) and the DEWA IMS Annexure-1. All three are marked "unverified".
- **Precedence (DBC A.4.1):** the Building Code replaces the building-design rules of DM, DDA,
  Trakhees and DSOA, and incorporates or cross-references DEWA's. The library therefore puts the DBC
  first and gives each DEWA 2017 clause its matching DBC reference.
- **`scripts/extract-sources.mjs`:** one text file per PDF page into gitignored `library/raw/`.
  - Use `table` mode for single-column documents with tables (DEWA).
  - Use `reading` mode for multi-column codes (DBC, UAE FLSC, Al Sa'fat).
- **`library/packs/core.json` + `src/library/pack.ts`:** clauses arrive as candidates. A pack update
  that changes a clause the user reviewed sends it back to review, tracked by a content fingerprint.
- **Clauses drafted:**
  - supply;
  - substation threshold and metering;
  - ambient conditions;
  - cable types and minimum sizes;
  - voltage drop 4%;
  - load balancing;
  - isolation for water heaters, saunas and AC;
  - load assessment per point;
  - maximum demand and DEWA schedule formats (Tables G.11–G.14);
  - MD limits (Tables G.15/G.16);
  - RCD currents (Table G.21);
  - PF correction and capacitor banks;
  - fire-pump earth-leakage alarms.
- **Difference to confirm:** window AC on a 15 A socket is limited to 1.5 kW in DBC G.4.13.8 but to
  18,000 Btu/h in DEWA 2017 4.6.6.

## Next step (rest of M2)

1. Draft clauses from the next set of sections:
   - DBC G.4.5 tariff metering;
   - G.4.12 distribution boards;
   - G.4.14–G.4.15 standby generators and fire-pump power;
   - G.5 EV charging;
   - G.7 substations;
   - UAE FLSC chapters on emergency lighting, fire alarm and life-safety power;
   - Al Sa'fat electrical requirements (metering, lighting, EV).
2. Before any calculation uses them, visually check DBC cable Tables G.4–G.6 (p429) and DEWA
   Appendix 5. The text extraction scrambles their columns.
3. The user reviews the 26 candidates in **Library → Review**.
4. Find SIRA's official residential CCTV requirements (DBC Part J summarises them), and open DEWA
   circular DP-VP-CS-GEN-0008-2022, which DEWA blocks from automated download.

## Waiting on the user

- Enter the sync URL and token in Settings on a device and press **Save & test connection**. This is
  the real cross-origin check, which the tests could only mock.
- Before M4: attach the cable-rating files and the approved load schedule format (xlsx + PDF).
- Pilot facts still unknown: telecom operator, district cooling, CCTV scope, the consultant's DEWA
  registration details.

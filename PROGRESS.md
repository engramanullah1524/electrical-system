# Progress

Resume from here after any interruption. Update it at the end of every step. Client and project
details are kept outside this public file, in the gitignored `private/NOTES.md`.

## Phase 1 — Design + DEWA approval pack

| # | Milestone | Status |
|---|---|---|
| M1 | Foundation: PWA shell (phone + laptop), local database, library with review queue, sync client, public-repo guard, CI deploy | **Done 2026-09-17**, except the sync connection test on a real device |
| M2 | Source registry: confirm current editions on official sites, extract PDF text locally, draft candidate clauses | Next |
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

## Next step (M2)

1. For each source, check the current edition on the issuer's official site, then record title,
   edition, date, URL and check date:
   - DEWA Regulations for Electrical Installations;
   - Dubai Building Code (electrical part);
   - UAE Fire & Life Safety Code;
   - Dubai Green Building Regulations / Al Sa'fat;
   - e& and du building guides, TDRA in-building rules;
   - SIRA rules for residential CCTV.
2. Write a script that extracts the user's local PDF copies with `pdftotext -layout`, one text file
   per page, into `library/raw/` (gitignored).
3. Draft candidate clauses for the Phase 1 parameters, each with page references, for the user to
   verify in the Review queue:
   - supply system, voltage-drop limits, power factor;
   - demand/diversity factors, fault levels;
   - metering/AMI, isolation, RCDs;
   - capacitor banks, EV charging, emergency-lighting supply.
4. Add a library import format, so candidate clauses prepared on the laptop load into every device.

## Waiting on the user

- Enter the sync URL and token in Settings on a device and press **Save & test connection**. This is
  the real cross-origin check, which the tests could only mock.
- Before M4: attach the cable-rating files and the approved load schedule format (xlsx + PDF).
- Pilot facts still unknown: telecom operator, district cooling, CCTV scope, the consultant's DEWA
  registration details.

# Electrical Project System

An offline-first web app for the electrical works of mid- and high-rise buildings in Dubai. It covers
design and authority approval, then execution, inspections, testing & commissioning and handover,
plus material take-off and procurement.

**Live app:** https://engramanullah1524.github.io/electrical-system/ (install it from the browser menu
on a phone or laptop; it keeps working without internet).

## The one rule

Nothing is assumed. Every limit, factor or requirement the app applies must point to a source
document, edition, clause and page that the user has checked in the **Library → Review** queue.

- A clause starts as a *candidate* and is used only once it is *verified*.
- A source whose edition is superseded is refused.
- A *user note*, such as a checklist made with an AI tool, can never back a calculation.
- A value without a document behind it must be entered as a *designer's declared value* with a
  reason, and every export labels it as such.

## Privacy

This repository is public. It contains code and short, paraphrased rule references only.

Project data lives on the user's devices and in their own Google Drive. The following are never
committed:
- project files and drawings;
- regulation PDFs or their text;
- licensed tables;
- sync tokens.

`npm run guard` enforces this in CI, and nothing is published unless it passes.

## Development

The laptop uses a portable Node LTS through `dev.cmd`, so the system PATH is left untouched:

```
dev.cmd                start the dev server
dev.cmd test           run the tests
dev.cmd run build      production build
dev.cmd run guard      public-repo guard (run after git add)
```

Every push to `main` runs guard → tests → build, then deploys to GitHub Pages.

See [PROGRESS.md](PROGRESS.md) for what is done and what comes next.

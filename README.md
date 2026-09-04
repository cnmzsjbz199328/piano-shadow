# Piano Shadow

A browser-first piano practice app. Import a reference performance, follow it on a
virtual keyboard or a real MIDI controller, and get precise, explainable feedback on
pitch, timing, rhythm, duration, missed notes and extra notes.

> Turn a reference performance into a reusable practice template, then explain exactly
> how you differed from it.

This is v0.1, the Web Practice MVP described in [`doc/PIANO_SHADOW_GOAL.md`](doc/PIANO_SHADOW_GOAL.md).
Build status and architecture notes below are updated as the implementation progresses;
see [`CLAUDE.md`](CLAUDE.md) for the constraints this codebase is built under.

## Status

🚧 Under active initial development. This section, and the rest of this README, will be
filled in as each phase (spec §34) lands: foundation → input → practice engine →
practice UX → quality/persistence → optional polish.

## Development

```bash
npm install
npm run dev          # start the Vite dev server
npm run test          # unit + integration tests (Vitest)
npm run typecheck     # TypeScript, no emit
npm run build          # production build (typecheck + vite build)
npm run test:e2e:install  # one-time: install the Playwright browser
npm run test:e2e       # end-to-end tests (Playwright, builds + serves first)
npm run lint           # ESLint, including the architectural boundary rules
```

## License

MIT.

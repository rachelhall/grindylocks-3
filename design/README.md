# Design

Copies of the Grindylocks design system's files that the code builds from.
The design system is the source of truth: change things there first, then
copy them here.

- `tokens.json`: the design system's `tokens.json`. `npm run tokens` builds
  `src/theme/tokens.ts` (the app) and `web/src/styles/tokens.css` (the web
  admin) from it; `npm run check:tokens` fails if either is out of date.
- `web.md`: the design system's Web section, the rules for the web admin.

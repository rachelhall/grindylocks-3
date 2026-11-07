This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Branches and pull requests

- **One branch per feature, off an up-to-date `main`**, named `claude/<feature>` (e.g. `claude/navigation`). Don't build on another unmerged feature branch.
- **Every change reaches `main` through a pull request.** Open it as a draft, with what changed, how it was checked (typecheck, lint, translation check, iOS export bundle) and what's left to apply or test (migrations, a new EAS build, things to try in the simulator).
- **Rachel reviews, tests and merges.** A PR is marked ready once its migrations are applied and it's been tried in the simulator. Merge with a merge commit, not squash, so the feature's commits stay separate. Delete the branch after merging.
- Before pushing, fetch `main` and rebase the branch on it if `main` has moved.

## Migrations

- **A migration file is named by the version it was applied under.** The migration tool stamps its own time when it applies a migration, so a file written beforehand with a planned time ends up under a different version in production. After applying, look up the version (`list_migrations`, or `supabase migration list`) and rename the file to `<applied version>_<name>.sql` before the PR is marked ready. A file that doesn't match production breaks rebuilding the database from the repo (staging, branches, local).
- **Never edit a migration that has been applied.** Fix things with a new migration. `supabase/migrations/` must replay to the same database as production, in order.
- Rolled-back checks live in `supabase/tests/<name>_check.sql`; name the migration they cover by its applied version too.
- Data loaded outside migrations: the first 50 parks (Oct 31, 2026, before the repo existed) are rebuilt from the seed CSVs with `supabase/seed/build_seed.py`, not from a migration.

## Design tokens

- **`design/tokens.json` is a copy of the Grindylocks design system's `tokens.json`,** and the design system is the source of truth. Change a value there first, copy the file into `design/`, then run `npm run tokens`.
- `npm run tokens` writes `src/theme/tokens.ts` (the app) and `web/src/styles/tokens.css` (the web admin). Never edit either by hand; `npm run check:tokens` fails if they're stale. Run it with the other checks before a PR.
- `design/web.md` is a copy of the design system's Web section: the rules for the web admin.

## Web admin (`web/`)

- `web/` is the Next.js web admin for role holders: its own npm project with its own lockfile, so run its commands from `web/` (see `web/AGENTS.md`). The root `tsconfig.json`, ESLint config and Metro all skip it, and `.easignore` keeps it out of EAS uploads (`.easignore` replaces `.gitignore` for EAS, so keep the two in step).
- `npm run db:types` writes the generated types to both apps; `npm run check:db-types` fails if `web/src/lib/database.types.ts` differs from `src/lib/database.types.ts`. Run it with the other checks before a PR.

## Data fetching (TanStack Query)

Server data is cached with **TanStack Query** (`@tanstack/react-query`); the client and its React Native wiring live in `src/lib/query.ts`.

- **Reads go through query hooks**, never `useEffect` + `useState`. Fetch functions stay plain async functions in `src/lib/` (they throw on error); hooks wrap them (`usePark`, `useParksInBounds`, `useSavedParks`, …). Outside a component, use `queryClient.fetchQuery` / `prefetchQuery` with the same key so the cache is shared.
- **Keys come from `keys` in `src/lib/query.ts`.** Screens that show the same data use the same key: the map card and the park page both read `keys.park(slug)`.
- **Freshness comes from `fresh`:** park data 10 minutes, your own data always refetched on view, posts 5 minutes because their signed photo URLs expire after an hour.
- **Writes go through `useMutation`.** Toggles a member expects to flip at once (saving a park) update the cache optimistically and roll back on error; then invalidate the key.
- Refetching on foreground and reconnect is wired up through `AppState` and `expo-network`. The cache is cleared on sign-out, and anything per-member has the user ID in its key.
- Exceptions: the signed-in profile stays in `AuthProvider` (it decides routing), and the onboarding username check is a live validation, not cached data.
- No GraphQL layer: PostgREST nested selects and RPCs cover it.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

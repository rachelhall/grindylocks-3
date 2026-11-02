<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Grindylocks web admin

The web admin for role holders (Rachel, city admins, park admins). It's its own npm project inside the app's repo, with its own lockfile: run npm commands from `web/`. The repo root's AGENTS.md (branches, pull requests, tokens) applies here too.

- **Stack:** Next.js 16 (App Router, Cache Components), Tailwind v4, shadcn/ui on Base UI. shadcn components are copied into `src/components/ui/` and restyled to `design/web.md`; swap their Lucide icons for `<Icon>` (Material Symbols Sharp).
- **Design tokens:** `src/styles/tokens.css` is generated from `design/tokens.json` by `npm run tokens` at the repo root. Never edit it by hand. `src/app/globals.css` maps the tokens into Tailwind (`bg-gl-surface`, `type-title`) and shadcn's names.
- **Database types:** `src/lib/database.types.ts` is a copy of the app's, written by `npm run db:types` (or `npm run sync:db-types`) at the repo root; `npm run check:db-types` fails if they differ. Never edit it here.
- **Auth:** Supabase email codes with `@supabase/ssr` cookies and `shouldCreateUser: false`, so the web can't create accounts. `src/proxy.ts` refreshes the session and sends signed-out visitors to sign-in; `getAdmin()` in `src/lib/admin.ts` decides who's an admin. Every Server Function checks `getAdmin()` itself.
- **No service-role key, ever.** Reads and writes use the signed-in admin's own session, so the database's access rules apply exactly as in the app. Moderation actions are Postgres functions both apps call; no moderation logic lives here.
- **Cookie reads sit behind `<Suspense>`** (Cache Components): see `src/app/(admin)/layout.tsx`.
- **English only.** Copy follows the app's voice: plain, sentence case, no exclamation marks.

Checks before a PR, from `web/`: `npm run typecheck`, `npm run lint`, `npm run build`.

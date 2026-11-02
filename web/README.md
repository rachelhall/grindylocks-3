# Grindylocks admin

The web admin for park admins, city admins and Rachel: the moderation queue first, then park editing and roles. See `AGENTS.md` for how it's put together and `../design/web.md` for the visual rules.

## Run it locally

```sh
cd web
cp .env.example .env.local   # public Supabase URL and publishable key
npm install
npm run dev                  # http://localhost:3000
```

Sign in with the email you use in the app. Only accounts with an active owner, city admin or park admin role get past the code.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```

From the repo root, `npm run check:tokens` and `npm run check:db-types` make sure the web admin's tokens and database types match the app's.

## Hosting

Vercel, with the project's root directory set to `web/` and the two `NEXT_PUBLIC_SUPABASE_*` variables from `.env.example`. Vercel's free Hobby plan is for non-commercial use only; move to Pro once Grindylocks has sponsorships or any revenue.

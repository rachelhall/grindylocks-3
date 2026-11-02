# Web

The web admin (moderation queue first, later park editing and roles) uses the same tokens, type and rules as the app, adapted for a desk: a mouse and keyboard, a wide screen and long sessions working through a queue. It is built with Next.js and shadcn/ui; shadcn's components are copied into the repo and restyled to this system, so they never look like stock shadcn.

The admin is in English only. It sits in the **product layer**: flat surfaces, one accent, no texture. The only brand moments are the sign-in screen and the wordmark in the sidebar.

## Tokens on the web

- **One source.** `design/tokens.json` in the repo is a copy of this system's `tokens.json`. `npm run tokens` builds the app's theme and `web/src/styles/tokens.css` from it; `npm run check:tokens` fails if either is stale. Change values here first.
- Every token is a CSS variable named `--gl-<token>` (`--gl-surface`, `--gl-space-4`). Type styles are `--gl-type-<style>`, with `--line-height`, `--font-weight`, `--font-family` and `--letter-spacing` suffixes.
- shadcn's own variables point at those. Mind the name clash: shadcn's `--accent` is a hover background (`surface-raised`); Grindylocks pink is shadcn's `--primary`. `--muted-foreground` is `text-secondary`, because shadcn puts it on `surface-sunk`, where `text-muted` fails.
- `--radius` is 0. Light and dark follow the device setting, as in the app.
- **Web-only tokens:** `control-web` (40px controls), `row-web` (44px table rows), `sidebar-width`, `content-max`, `detail-pane` and `split-min`. `danger`, `on-danger` and `overlay` are shared with the app.

## Type

- Archivo and Archivo Black from Google Fonts (`next/font`), the same families as the app.
- Page titles use `title` (uppercase). `display` appears only on the sign-in screen. Card and pane headings use `headline`.
- Tables: cells in `body-sm`, column headers in `label` (uppercase, `text-secondary`). Numbers and dates in tables are right-aligned with tabular figures.
- Reported captions and comments show in `body`, exactly as written, in any language.

## Layout

- **Sidebar** (`sidebar-width`) on `surface` with a `stroke-rule` rule on its right edge. At the top: the name "Grindylocks" in Archivo Black with a tilted pink tape label reading ADMIN, like the park header's tape. Below it, one item per section: Queue, Parks (later), Roles (later). The current item is an `accent` fill with `on-accent` text; others are `text`, with `surface-raised` on hover. At the bottom: your username and role badge, and Sign out.
- **Content** sits on `surface` with a `space-6` gutter. Single-column pages stop at `content-max`.
- **Split view** (the queue): the list fills the space and the detail pane (`detail-pane` wide) sits on the right, separated by a `stroke-rule` rule. Under `split-min`, a row opens the detail as its own page. Under 768px the sidebar becomes a top bar; small screens work for a quick look, but quick actions on a phone belong in the app.
- Depth is still drawn, not shadowed: panes, cards and dialogs are outlined in `border` at `stroke-rule`. No shadows, no blur, no rounded corners.

## Controls

- **Size.** Buttons, inputs and selects are `control-web` (40px) tall; square icon buttons are 40px. `tap-min` stays the rule in the app.
- **Primary button:** `accent` fill, `on-accent` label, `stroke-rule` outline in `border`. At most one per screen or pane. On hover it gets a 2px `border` offset block down and to the right, a printed offset like the pink offset behind park names; pressed, the offset goes away.
- **Outlined button:** `surface` fill, `border` outline at `stroke-rule`, `text` label. On hover it inverts: `text` fill with a `surface` label.
- **Danger:** destructive and moderation actions (hide, suspend, ban, delete) are outlined in `danger` with a `danger` label. The confirm button inside the dialog is a `danger` fill with `on-danger`. Every one asks for confirmation; permanent bans also ask you to type the username.
- **Inputs, selects and text areas:** `surface-sunk` fill, `border` outline at `stroke-rule`, `text` value, `text-secondary` placeholder (not `text-muted`, which fails on `surface-sunk`).
- **Checkboxes:** square `accent` fill with a `stroke-rule` ink outline and an ink check, as in the app.
- **Chips and badges:** `label` style, square, outlined in `border` with the word inside. Report states (Open, Hidden, Dismissed, Escalated) are neutral outlined chips; Auto-hidden is outlined in `danger`. Role badges keep `role` with `on-role`.
- **Focus:** a solid `stroke-rule` ring in `focus`, offset 2px, on every focusable element, never removed.
- **Tooltips:** `text` fill with a `surface` label (inverted), `caption` style.
- **Dialogs and sheets:** `surface-raised`, outlined in `border`, over `overlay`.
- **Toasts:** `surface-raised`, outlined in `border`, bottom right. Undo appears in the toast for anything reversible (dismiss, hide).

## Tables and lists

- Rows are at least `row-web` tall, divided by `stroke-hairline` rules in `border-subtle`. The header row has a `stroke-rule` rule in `border` beneath it.
- Hover: `surface-raised`. Selected rows: `accent-subtle` with `on-accent-subtle` text and a checked checkbox, so the tint is never the only signal (the same rule as picked choices in the app).
- The row the detail pane is showing gets a `stroke-rule` outline in `border`.
- Empty states are plain sentences in `body`: "Nothing waiting. Reports, park info reports and suggested obstacles show up here." No illustrations.

## Keyboard

The queue is built to be worked from the keyboard. `j` and `k` move between rows, `Enter` opens one, `Esc` closes the pane, `?` lists every shortcut. Action shortcuts (dismiss, hide, escalate) still open their confirmation, so a stray key can't act on its own.

## Icons

Material Symbols, Sharp, at weight 600, from Google Fonts: the same set as the app. shadcn's components ship with Lucide icons; swap them for Material Symbols when a component is added. Icon-only buttons always have a tooltip and an accessible name.

## Voice

The same as the app: plain and neutral, sentence case, no exclamation marks. Name the action and its result: "Hide post", "Post hidden. Undo". Moderation copy never guesses at intent: "Reported 3 times for harassment", not "Abusive post".

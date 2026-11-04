// Copies the push notification sentences from the app's translation files
// into the push-send Edge Function, so a push reads exactly like its row
// under the bell. Run after changing any `notifications.*` string:
//   node scripts/build-push-strings.mjs
// `npm run check:i18n` fails if the copy is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['en', 'es', 'da', 'de'];
const keys = [
  'commentOne', 'reply', 'mention', 'captionMention', 'tag', 'filmer', 'inviteUsed', 'someoneNew', 'visiting', 'visitingPark', 'parkFixLive',
  // Meetups (PR 5).
  'meetupChanged', 'meetupCancelled', 'meetupEnded', 'meetupReminder', 'meetupCommentOne', 'meetupReply', 'meetupMention',
];
/** Brand and shop pages (PRs 5 and 7a), from `notifications.page`, as page_<key>. */
const pageKeys = [
  'teamInvite', 'ownership', 'claimApproved', 'claimDeclined', 'claimTaken', 'madeRole', 'removed', 'owner', 'joined', 'suggestionLive',
  // Running a page (PR 7a).
  'handedOver', 'ownershipDeclined', 'mention',
  // Commenting as a page (PR 8b): comments in a page's inbox.
  'commentPost', 'commentReply',
];
/** Role words, from `pageInvite.role` (role_<key>) and `pageInvite.roleA` (roleA_<key>). */
const roles = ['staff', 'manager'];
/** Cancel reasons, from `meetup.reason`, as reason_<key>. */
const reasons = ['rained_out', 'park_closed', 'something_came_up', 'other'];

export function pushStrings() {
  const out = {};
  for (const lang of languages) {
    const file = JSON.parse(readFileSync(join(root, 'src/i18n/locales', `${lang}.json`), 'utf8'));
    out[lang] = {
      ...Object.fromEntries(keys.map((k) => [k, file.notifications[k]])),
      ...Object.fromEntries(reasons.map((r) => [`reason_${r}`, file.meetup.reason[r]])),
      ...Object.fromEntries(pageKeys.map((k) => [`page_${k}`, file.notifications.page[k]])),
      ...Object.fromEntries(roles.map((r) => [`role_${r}`, file.pageInvite.role[r]])),
      ...Object.fromEntries(roles.map((r) => [`roleA_${r}`, file.pageInvite.roleA[r]])),
    };
  }
  return JSON.stringify(out, null, 2) + '\n';
}

export const pushStringsPath = join(root, 'supabase/functions/push-send/strings.json');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(pushStringsPath, pushStrings());
  console.log(`Wrote ${pushStringsPath}`);
}

// push-send: sends what's waiting in the push outbox to members' phones
// through Expo's push service (which hands iOS pushes to APNs and Android
// ones to FCM).
//
// The database pings this function (pg_net) whenever new rows land in the
// outbox, so there's no schedule. Calling it only ever drains the queue,
// with no input and nothing private in the reply, so it doesn't need a
// signed-in caller (verify_jwt = false). Everything about who may be told
// what is decided in the database by push_claim().

import { adminClient, json } from '../_shared/stream.ts';
import strings from './strings.json' with { type: 'json' };

type Language = keyof typeof strings;
type Sentences = (typeof strings)['en'];

type Claimed = {
  outbox_id: number;
  send: boolean;
  kind: string;
  actor_username: string | null;
  comment_body: string | null;
  post_id: string | null;
  park_name: string | null;
  park_slug: string | null;
  metro_name: string | null;
  devices: { token: string; language: string }[];
  /** Meetups: the date, on the park's clock. */
  event_id: string | null;
  event_starts_at: string | null;
  event_timezone: string | null;
  /** The meetup's title, or its line when it has none. */
  event_title: string | null;
  /**
   * What changed ("time", "park", "time,park"), or the cancel reason
   * (":series" when the rest of a series was cancelled). Pages: the invite
   * ("team:staff", "ownership"), the decline reason, the team change
   * ("role:manager", "removed", "owner"; from Rachel's page tools "suspended",
   * "suspension_lifted", "renamed:<old name>", "merged:<old name>", "closed",
   * "reopened") or what went live.
   * A page_comment: "post" (on the page's post) or "reply" (to its comment).
   */
  detail: string | null;
  /** Page notifications: the page's handle and name. */
  page_handle: string | null;
  page_name: string | null;
};

type ExpoMessage = {
  to: string;
  title?: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  channelId: 'default';
  priority: 'high';
};

type ExpoTicket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
/** Expo takes at most 100 messages per request. */
const CHUNK = 100;
/** Rounds per call, so a burst is drained without one call running forever. */
const MAX_ROUNDS = 5;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? '');
}

const LOCALES: Record<string, string> = { en: 'en-US', es: 'es', da: 'da-DK', de: 'de-DE' };

/** "Thu, Nov 5", "Thu, Nov 5, 7:00 PM" or "7:00 PM", on the park's clock, in the reader's language (as the bell writes them). */
function meetupTime(row: Claimed, language: string, style: 'date' | 'dateTime' | 'time'): string {
  if (!row.event_starts_at) return '';
  const day: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  try {
    return new Intl.DateTimeFormat(LOCALES[language] ?? 'en-US', {
      timeZone: row.event_timezone ?? 'UTC',
      ...(style === 'time' ? time : style === 'date' ? day : { ...day, ...time }),
    }).format(new Date(row.event_starts_at));
  } catch {
    return '';
  }
}

/**
 * The sentence is the same one the bell shows. A comment, reply or mention
 * puts the sentence in the title and the comment itself in the body; a
 * caption mention does the same with the caption.
 */
function compose(row: Claimed, language: string): { title?: string; body: string } | null {
  const s: Sentences = strings[(language in strings ? language : 'en') as Language];
  // Tags, credits, caption mentions and comments made as a page come from
  // the page; a page that mentions or comments is named in actor_username.
  const username = row.actor_username ?? row.page_name ?? '';
  const a = username ? `@${username}` : '';
  const metro = row.metro_name ?? '';
  const say = (key: keyof Sentences, extra: Record<string, string> = {}) => fill(s[key], { a, username, metro, ...extra });
  const lang = language in strings ? language : 'en';
  const page = row.page_name ?? '';
  // A page's meetup (PR 9) may be at its shop or an address: then the page names the place.
  const meetup = row.event_title ?? row.park_name ?? page;
  const park = row.park_name ?? page;
  const reasonOf = (r: string) => {
    const key = `reason_${r}` as keyof Sentences;
    return key in s ? fill(s[key], { name: page }) : s.reason_other;
  };

  switch (row.kind) {
    case 'comment':
      return { title: say('commentOne'), body: row.comment_body ?? '' };
    case 'reply':
      return { title: say('reply'), body: row.comment_body ?? '' };
    case 'mention':
      return { title: say('mention'), body: row.comment_body ?? '' };
    case 'caption_mention':
      // The caption plays the part of the comment.
      return { title: say('captionMention'), body: row.comment_body ?? '' };
    case 'tag':
      return { body: say('tag') };
    case 'filmer_credit':
      return { body: say('filmer') };
    case 'invite_used':
      return username ? { body: say('inviteUsed') } : null;
    case 'someone_new':
      return { body: say('someoneNew') };
    case 'visiting':
      return { body: row.park_name ? say('visitingPark', { park: row.park_name }) : say('visiting') };
    case 'park_report_accepted':
      return row.park_name ? { body: say('parkFixLive', { park: row.park_name }) } : null;
    // Meetups: the bell's sentence, with times on the park's clock.
    case 'meetup_changed':
      return meetup ? { body: say('meetupChanged', { meetup, when: meetupTime(row, lang, 'dateTime'), park }) } : null;
    case 'meetup_cancelled': {
      if (!meetup) return null;
      const [reason, scope] = (row.detail ?? 'other').split(':');
      // The page tools: "8SET has closed", or "It's no longer happening" for a suspension.
      if (reason === 'page_closed' || reason === 'page_suspended') {
        return scope === 'series'
          ? { body: say('meetupEndedPage', { meetup, reason: reasonOf(reason) }) }
          : { body: say('meetupCancelledPage', { meetup, date: meetupTime(row, lang, 'date'), reason: reasonOf(reason) }) };
      }
      return scope === 'series'
        ? { body: say('meetupEnded', { meetup, reason: reasonOf(reason) }) }
        : { body: say('meetupCancelled', { meetup, date: meetupTime(row, lang, 'date'), reason: reasonOf(reason) }) };
    }
    case 'meetup_reminder':
      return meetup ? { body: say('meetupReminder', { meetup, time: meetupTime(row, lang, 'time'), park }) } : null;
    case 'meetup_comment':
      return { title: say('meetupCommentOne', { meetup }), body: row.comment_body ?? '' };
    case 'meetup_reply':
      return { title: say('meetupReply', { meetup }), body: row.comment_body ?? '' };
    case 'meetup_mention':
      return { title: say('meetupMention', { meetup }), body: row.comment_body ?? '' };
    // Pages (brand and shop accounts, PR 5): the bell's sentences, with the
    // page's name in {{name}}.
    case 'page_invite': {
      if (!page) return null;
      if (row.detail === 'ownership') return { body: say('page_ownership', { name: page }) };
      const role = row.detail === 'team:manager' ? s.role_manager : s.role_staff;
      return { body: say('page_teamInvite', { name: page, role }) };
    }
    case 'page_claim_approved':
      return page ? { body: say('page_claimApproved', { name: page }) } : null;
    case 'page_claim_declined':
      if (!page) return null;
      return row.detail === 'another_claim_approved'
        ? { body: say('page_claimTaken', { name: page }) }
        : { title: say('page_claimDeclined', { name: page }), body: row.detail ?? '' };
    case 'page_team_change':
      if (!page) return null;
      if (row.detail === 'removed') return { body: say('page_removed', { name: page }) };
      if (row.detail === 'owner') return { body: say('page_owner', { name: page }) };
      // Rachel's page tools (PR 6b): told to the whole team. Renames and merges
      // carry the old name after the colon.
      if (row.detail === 'suspended') return { body: say('page_suspended', { name: page }) };
      if (row.detail === 'suspension_lifted') return { body: say('page_suspensionLifted', { name: page }) };
      if (row.detail === 'closed') return { body: say('page_closed', { name: page }) };
      if (row.detail === 'reopened') return { body: say('page_reopened', { name: page }) };
      if (row.detail?.startsWith('renamed:')) return { body: say('page_renamed', { name: page, old: row.detail.slice(8) }) };
      if (row.detail?.startsWith('merged:')) return { body: say('page_merged', { name: page, old: row.detail.slice(7) }) };
      // Running a page (PR 7a): a hand-over accepted or declined, told to the owner.
      if (row.detail === 'handed_over') return { body: say('page_handedOver', { name: page }) };
      if (row.detail === 'ownership_declined') return { body: say('page_ownershipDeclined', { name: page }) };
      return { body: say('page_madeRole', { name: page, role: row.detail === 'role:manager' ? s.roleA_manager : s.roleA_staff }) };
    case 'page_claimed':
      return page ? { body: say('page_joined', { name: page }) } : null;
    // A page's inbox (PR 7a), for team members who switched its push on: the
    // sentence in the title and what was said in the body, like a mention.
    case 'page_mention':
      return page ? { title: say('page_mention', { name: page }), body: row.comment_body ?? '' } : null;
    // Commenting as a page (PR 8b): a comment on the page's post, or a reply
    // to one of its comments, for members who switched its inbox push on.
    case 'page_comment':
      if (!page) return null;
      return {
        title: say(row.detail === 'reply' ? 'page_commentReply' : 'page_commentPost', { name: page }),
        body: row.comment_body ?? '',
      };
    case 'suggestion_live':
      return page ? { title: say('page_suggestionLive', { name: page }), body: row.detail ?? '' } : null;
    default:
      return null;
  }
}

/** Where tapping the push goes. The app maps this onto its routes. */
function destination(row: Claimed): Record<string, string> {
  if (row.event_id) {
    const comments = ['meetup_comment', 'meetup_reply', 'meetup_mention'].includes(row.kind);
    return { open: 'meetup', id: row.event_id, ...(comments ? { comments: '1' } : {}) };
  }
  if (row.post_id) {
    const comments = ['comment', 'reply', 'mention', 'page_comment'].includes(row.kind);
    return { open: 'post', id: row.post_id, ...(comments ? { comments: '1' } : {}) };
  }
  if (row.kind === 'park_report_accepted' && row.park_slug) return { open: 'park', slug: row.park_slug };
  // Team invites wait in the bell's Page invites box; the rest open the page
  // (an approved claim opens it to add the logo).
  if (row.kind === 'page_invite') return { open: 'notifications' };
  if (row.page_handle) return { open: 'page', handle: row.page_handle, ...(row.kind === 'page_claim_approved' ? { logo: '1' } : {}) };
  if (row.actor_username) return { open: 'profile', username: row.actor_username };
  return { open: 'notifications' };
}

async function sendChunk(messages: ExpoMessage[]): Promise<ExpoTicket[] | null> {
  const res = await fetch(EXPO_SEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.error('Expo push send failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  const body = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
  return body?.data ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const db = adminClient();
  let sent = 0;
  let skipped = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await db.rpc('push_claim', { max_rows: 100 });
    if (error) {
      console.error('push_claim failed', error.message);
      return json({ error: 'claim failed' }, 500);
    }
    const rows = (data ?? []) as Claimed[];
    if (rows.length === 0) break;

    const messages: ExpoMessage[] = [];
    for (const row of rows) {
      if (!row.send) {
        skipped++;
        continue;
      }
      for (const device of row.devices) {
        const text = compose(row, device.language);
        if (!text || !text.body) continue;
        messages.push({ to: device.token, ...text, data: destination(row), sound: 'default', channelId: 'default', priority: 'high' });
      }
    }

    // Send everything for this round; if Expo can't be reached, leave the
    // rows unsent so the next ping tries again.
    const dead: string[] = [];
    let failed = false;
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      const tickets = await sendChunk(chunk);
      if (!tickets) {
        failed = true;
        break;
      }
      tickets.forEach((ticket, j) => {
        if (ticket.status === 'ok') sent++;
        else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[j].to);
        else console.error('Expo push ticket error', ticket.details?.error, ticket.message);
      });
    }
    if (failed) return json({ sent, skipped, retrying: true }, 502);

    const { error: doneError } = await db.rpc('push_done', {
      outbox_ids: rows.map((r) => r.outbox_id),
      dead_tokens: dead,
    });
    if (doneError) {
      console.error('push_done failed', doneError.message);
      return json({ error: 'done failed' }, 500);
    }
  }

  return json({ sent, skipped });
});

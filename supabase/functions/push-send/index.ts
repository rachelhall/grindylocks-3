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
  metro_name: string | null;
  devices: { token: string; language: string }[];
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

/**
 * The sentence is the same one the bell shows. A comment, reply or mention
 * puts the sentence in the title and the comment itself in the body; a
 * caption mention does the same with the caption.
 */
function compose(row: Claimed, language: string): { title?: string; body: string } | null {
  const s: Sentences = strings[(language in strings ? language : 'en') as Language];
  const username = row.actor_username ?? '';
  const a = username ? `@${username}` : '';
  const metro = row.metro_name ?? '';
  const say = (key: keyof Sentences, extra: Record<string, string> = {}) => fill(s[key], { a, username, metro, ...extra });

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
    default:
      // park_report_accepted arrives with M5; nothing to say until then.
      return null;
  }
}

/** Where tapping the push goes. The app maps this onto its routes. */
function destination(row: Claimed): Record<string, string> {
  if (row.post_id) {
    const comments = ['comment', 'reply', 'mention'].includes(row.kind);
    return { open: 'post', id: row.post_id, ...(comments ? { comments: '1' } : {}) };
  }
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

// page-email-send: sends what's waiting in the page email outbox through
// Resend: the 6-digit code for a Claim this page work email, emailed team
// invites, and Rachel's claim invites (brand and shop accounts, PR 5).
//
// Like push-send, the database pings this function (pg_net) when new emails
// land in the outbox, so there's no schedule. Calling it only ever drains
// the queue, with no input and nothing private in the reply, so it doesn't
// need a signed-in caller (verify_jwt = false). page_email_claim() decides
// what still goes out; page_email_done() marks emails sent and forgets the
// codes.
//
// Needs RESEND_API_KEY (already set for export-data and delete-account).

import { adminClient, json } from '../_shared/stream.ts';
import strings from './strings.json' with { type: 'json' };

type Language = keyof typeof strings;
type Sentences = (typeof strings)['en'];

type Claimed = {
  email_id: number;
  send: boolean;
  kind: 'claim_code' | 'team_invite' | 'claim_invite';
  to_email: string;
  language: string;
  code: string | null;
  page_name: string;
  page_handle: string;
  page_kind: 'brand' | 'shop';
  page_place: string | null;
  inviter_username: string | null;
  role: string | null;
  expires_at: string | null;
};

const FROM = 'Grindylocks <noreply@mail.grindylocks.com>';
const LOCALES: Record<string, string> = { en: 'en-US', es: 'es', da: 'da-DK', de: 'de-DE' };

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? '');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain paragraphs become <p>s; the text version stays as written. */
function toHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** ABCD2345 → ABCD-2345, as the app shows invite codes. */
const showCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

function compose(row: Claimed): { subject: string; text: string } | null {
  if (!row.code) return null;
  const lang = (row.language in strings ? row.language : 'en') as Language;
  const s: Sentences = strings[lang];
  const page = row.page_name;
  const expires = row.expires_at
    ? new Intl.DateTimeFormat(LOCALES[lang] ?? 'en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(row.expires_at))
    : '';

  if (row.kind === 'claim_code') {
    return {
      subject: fill(s.codeSubject, { page, code: row.code }),
      text: fill(s.codeBody, { page, code: row.code }),
    };
  }

  const code = showCode(row.code);
  const howTo = fill(s.howTo, {
    code,
    link: `grindylocks://invite?code=${row.code}`,
    email: row.to_email,
    expires,
  });
  if (row.kind === 'team_invite') {
    const inviter = row.inviter_username ? `@${row.inviter_username}` : page;
    const role = row.role === 'manager' ? s.manager : s.staff;
    return {
      subject: fill(s.teamSubject, { inviter, page }),
      text: [fill(s.teamBody, { inviter, page, role }), howTo, s.beta, s.ignore].join('\n\n'),
    };
  }
  return {
    subject: fill(s.claimSubject, { page }),
    text: [fill(s.claimBody, { page }), howTo, s.beta, s.ignore].join('\n\n'),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'email_not_configured' }, 503);

  const db = adminClient();
  let sent = 0;
  let skipped = 0;

  for (let round = 0; round < 5; round++) {
    const { data, error } = await db.rpc('page_email_claim', { max_rows: 20 });
    if (error) {
      console.error('page_email_claim failed', error.message);
      return json({ error: 'claim failed' }, 500);
    }
    const rows = (data ?? []) as Claimed[];
    if (rows.length === 0) break;

    const done: number[] = [];
    for (const row of rows) {
      const email = row.send ? compose(row) : null;
      if (!email) {
        skipped++;
        done.push(row.email_id);
        continue;
      }
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [row.to_email], subject: email.subject, text: email.text, html: toHtml(email.text) }),
        });
        if (res.ok) {
          sent++;
          done.push(row.email_id);
        } else {
          // Left unsent: the next ping tries again (3 tries, within a day).
          console.error('page-email-send: Resend', res.status, await res.text().catch(() => ''));
        }
      } catch (err) {
        console.error('page-email-send: Resend', err);
      }
    }

    if (done.length > 0) {
      const { error: doneError } = await db.rpc('page_email_done', { ids: done });
      if (doneError) {
        console.error('page_email_done failed', doneError.message);
        return json({ error: 'done failed' }, 500);
      }
    }
    if (done.length < rows.length) break;
  }

  return json({ sent, skipped });
});

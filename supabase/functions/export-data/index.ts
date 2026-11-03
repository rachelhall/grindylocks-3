// POST /functions/v1/export-data   (no body)
//
// "Get a copy of my data": emails the signed-in member a JSON file of
// everything Grindylocks keeps about them. export_my_data() in the database
// gathers it (and allows one export a day); this function only sends it,
// through Resend. The data never comes back in the reply, only by email, so
// a stolen session can't read it off the API.
//
// Replies { ok: true }, or { error } with:
//   401 not_signed_in, 429 export_once_a_day, 502 email_failed,
//   503 email_not_configured (RESEND_API_KEY missing).

import { corsHeaders, json, userClient } from '../_shared/stream.ts';

const FROM = 'Grindylocks <noreply@mail.grindylocks.com>';

/** Base64 of the UTF-8 bytes, in chunks so big exports don't blow the stack. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Checked first, so a missing key doesn't use up the member's daily export.
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'email_not_configured' }, 503);

  if (!req.headers.get('Authorization')) return json({ error: 'not_signed_in' }, 401);
  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  const user = auth.user;
  if (!user?.email) return json({ error: 'not_signed_in' }, 401);

  const { data, error } = await db.rpc('export_my_data');
  if (error) {
    if (error.message === 'export_once_a_day') return json({ error: 'export_once_a_day' }, 429);
    if (error.message === 'not_signed_in') return json({ error: 'not_signed_in' }, 401);
    console.error('export-data: export_my_data', error);
    return json({ error: 'server_error' }, 500);
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const asOf = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const text =
    `Here's a copy of everything Grindylocks keeps about you, as of ${asOf}. ` +
    'Photos and clips are listed by their storage paths and video IDs.\n\n' +
    "If you didn't ask for this, reply to this email.";
  const html =
    `<p>Here's a copy of everything Grindylocks keeps about you, as of ${asOf}. ` +
    'Photos and clips are listed by their storage paths and video IDs.</p>' +
    "<p>If you didn't ask for this, reply to this email.</p>";

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [user.email],
        subject: 'Your Grindylocks data',
        text,
        html,
        attachments: [
          { filename: `grindylocks-data-${day}.json`, content: base64(JSON.stringify(data, null, 2)) },
        ],
      }),
    });
    if (!res.ok) {
      console.error('export-data: Resend', res.status, await res.text().catch(() => ''));
      return json({ error: 'email_failed' }, 502);
    }
  } catch (err) {
    console.error('export-data: Resend', err);
    return json({ error: 'email_failed' }, 502);
  }

  return json({ ok: true });
});

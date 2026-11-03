#!/usr/bin/env bash
# Creates a Cloudflare Stream signing key and saves it as the Supabase Edge
# Function secrets STREAM_SIGNING_KEY_ID and STREAM_SIGNING_KEY_JWK, which
# stream-token uses to sign playback tokens.
#
# It asks for the Cloudflare account ID and an API token with Stream: Edit
# (typed at the terminal, never echoed or logged). The private key goes
# straight from Cloudflare to Supabase; only the key ID is printed.
# Needs: curl, python3, and the Supabase CLI signed in (supabase login).
#
# Stream shows a key's private half only once, so running this again makes
# a new key (fine: tokens signed with the old key keep working until they
# expire, and old keys can be deleted in the Cloudflare API later).
set -euo pipefail

PROJECT_REF="ytfdgacofenkehnbbhsc"

read -r -p "Cloudflare account ID: " ACCOUNT_ID </dev/tty
read -r -s -p "Cloudflare API token (Stream: Edit): " API_TOKEN </dev/tty
echo >/dev/tty

RESPONSE="$(curl -sS -X POST \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/keys")"

KEY_ID="$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["result"]["id"] if d.get("success") else "")')"
if [ -z "$KEY_ID" ]; then
  echo "Cloudflare didn't create a key. Its errors:"
  printf '%s' "$RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("errors"))'
  exit 1
fi
KEY_JWK="$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["jwk"])')"
unset RESPONSE API_TOKEN

echo "Created Stream signing key ${KEY_ID}"
supabase secrets set --project-ref "$PROJECT_REF" \
  "STREAM_SIGNING_KEY_ID=${KEY_ID}" "STREAM_SIGNING_KEY_JWK=${KEY_JWK}" >/dev/null
unset KEY_JWK
echo "Saved STREAM_SIGNING_KEY_ID and STREAM_SIGNING_KEY_JWK to Supabase project ${PROJECT_REF}"
supabase secrets list --project-ref "$PROJECT_REF" | grep -E "NAME|STREAM_SIGNING" || true

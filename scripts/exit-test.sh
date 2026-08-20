#!/usr/bin/env bash
#
# The iteration 2 exit test from docs/DESIGN.md, as a script.
#
#   pnpm server          # in another terminal
#   bash scripts/exit-test.sh
#
# Every assertion is printed with its status code rather than asserted on, so a
# human reads the output - this complements the unit suite rather than replacing
# it, and it is the ONLY thing that exercises real Postgres end to end (see
# "Known gaps" in docs/HANDOFF.md). Each run signs up new accounts, so it is safe
# to run repeatedly.
#
# What to look for:
#   201 create - 201 first turn - 200 replayed with turnCount unchanged
#   404 (never 403) when the other account reads it
#   ended twice with the SAME endedAt
#   no id appearing on both pages of the keyset listing
set -u
BASE=http://127.0.0.1:3000
STAMP=$(date +%s)
A="a-$STAMP@example.com"
B="b-$STAMP@example.com"
PW="correct-horse-battery"

hdr() { printf "\n\033[1m== %s\033[0m\n" "$1"; }
signup() { # email -> token (from set-auth-token header)
  curl -s -m 20 -D - -o /dev/null -X POST "$BASE/api/auth/sign-up/email" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"Test $1\",\"email\":\"$1\",\"password\":\"$PW\"}" \
  | tr -d '\r' | awk 'tolower($1)=="set-auth-token:"{print $2}'
}

hdr "sign up two users"
TA=$(signup "$A"); TB=$(signup "$B")
echo "A token: ${TA:0:24}...  B token: ${TB:0:24}..."
[ -n "$TA" ] && [ -n "$TB" ] || { echo "FAIL: no set-auth-token header"; exit 1; }

hdr "short password is refused with Better Auth's own flat error"
curl -s -m 20 -w " <- %{http_code}\n" -X POST "$BASE/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Short\",\"email\":\"short-$STAMP@example.com\",\"password\":\"tooshort\"}"

hdr "create a conversation (expect 201)"
CREATED=$(curl -s -m 20 -w "\n%{http_code}" -X POST "$BASE/api/conversations" -H "authorization: Bearer $TA")
echo "$CREATED"
CID=$(echo "$CREATED" | head -1 | sed -E 's/.*"id":"([^"]+)".*/\1/')

hdr "append seq=1 (expect 201, turnCount 1, title derived)"
TURN='{"seq":1,"role":"user","text":"What is the tallest mountain in Japan and how long does it take to climb?"}'
curl -s -m 20 -w "\n<- %{http_code}\n" -X POST "$BASE/api/conversations/$CID/turns" \
  -H "authorization: Bearer $TA" -H 'content-type: application/json' -d "$TURN"

hdr "append the SAME seq again (expect 200, replayed:true, turnCount still 1)"
curl -s -m 20 -w "\n<- %{http_code}\n" -X POST "$BASE/api/conversations/$CID/turns" \
  -H "authorization: Bearer $TA" -H 'content-type: application/json' -d "$TURN"

hdr "assistant turn seq=2 (expect 201, title unchanged)"
curl -s -m 20 -w "\n<- %{http_code}\n" -X POST "$BASE/api/conversations/$CID/turns" \
  -H "authorization: Bearer $TA" -H 'content-type: application/json' \
  -d '{"seq":2,"role":"assistant","text":"Mount Fuji, at 3776 metres."}'

hdr "user B reads user A's conversation (expect 404, NOT 403)"
curl -s -m 20 -w "\n<- %{http_code}\n" "$BASE/api/conversations/$CID" -H "authorization: Bearer $TB"

hdr "user B appends to user A's conversation (expect 404)"
curl -s -m 20 -w "\n<- %{http_code}\n" -X POST "$BASE/api/conversations/$CID/turns" \
  -H "authorization: Bearer $TB" -H 'content-type: application/json' -d '{"seq":9,"role":"user","text":"hello"}'

hdr "detail with turns (expect 200)"
curl -s -m 20 -w "\n<- %{http_code}\n" "$BASE/api/conversations/$CID" -H "authorization: Bearer $TA"

hdr "PATCH -> ended"
curl -s -m 20 -w "\n<- %{http_code}\n" -X PATCH "$BASE/api/conversations/$CID" \
  -H "authorization: Bearer $TA" -H 'content-type: application/json' -d '{"status":"ended"}'

hdr "PATCH again -> idempotent, same endedAt"
curl -s -m 20 -w "\n<- %{http_code}\n" -X PATCH "$BASE/api/conversations/$CID" \
  -H "authorization: Bearer $TA" -H 'content-type: application/json' -d '{"status":"ended"}'

hdr "keyset pagination: make 4 more, then page limit=2"
for i in 1 2 3 4; do
  curl -s -m 20 -o /dev/null -X POST "$BASE/api/conversations" -H "authorization: Bearer $TA"
done
P1=$(curl -s -m 20 "$BASE/api/conversations?limit=2" -H "authorization: Bearer $TA")
echo "page 1: $P1"
CUR=$(echo "$P1" | sed -E 's/.*"nextCursor":"([^"]+)".*/\1/')
P2=$(curl -s -m 20 "$BASE/api/conversations?limit=2&cursor=$CUR" -H "authorization: Bearer $TA")
echo "page 2: $P2"
echo "overlap check (ids on both pages):"
comm -12 <(echo "$P1" | grep -oE '"id":"[^"]+"' | sort) <(echo "$P2" | grep -oE '"id":"[^"]+"' | sort) || true

hdr "garbage cursor (expect 400)"
curl -s -m 20 -w "\n<- %{http_code}\n" "$BASE/api/conversations?cursor=not-a-cursor" -H "authorization: Bearer $TA"

hdr "malformed body (expect 422 with field detail)"
curl -s -m 20 -w "\n<- %{http_code}\n" -X POST "$BASE/api/conversations/$CID/turns" \
  -H "authorization: Bearer $TA" -H 'content-type: application/json' -d '{"seq":"one","role":"user","text":""}'

hdr "no token (expect 401)"
curl -s -m 20 -w "\n<- %{http_code}\n" "$BASE/api/conversations"

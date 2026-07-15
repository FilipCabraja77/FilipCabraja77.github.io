<?php
/* =========================================================================
   Foka contact form endpoint  ->  POST /api/contact.php  (JSON in, JSON out)
   Validates + honeypot + simple per-IP rate limit, then relays the message
   through the Resend API (https://api.resend.com/emails) via cURL. No database,
   no third-party JS. The API key lives in a config file OUTSIDE the web root
   (see api/config.php). Reply-To is set to the sender so replies go to them.

   NOTE: PHP does not run on the local Node dev server - test on Hostinger.
   ========================================================================= */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function out($code, $arr) { http_response_code($code); echo json_encode($arr); exit; }

/* ---- method ---- */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(405, ['ok' => false, 'error' => 'method']);

/* ---- same-origin: Origin/Referer host must be (a subdomain of) foka.hr or the
   current host. Blocks trivial cross-site abuse of the endpoint. ---- */
$host = strtolower($_SERVER['HTTP_HOST'] ?? '');
$src  = $_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? '');
if ($src !== '') {
  $sh = strtolower((string) parse_url($src, PHP_URL_HOST));
  if ($sh !== $host && !preg_match('/(^|\.)foka\.hr$/', $sh)) out(403, ['ok' => false, 'error' => 'origin']);
}

/* ---- read JSON body (cap the raw size) ---- */
$raw = file_get_contents('php://input', false, null, 0, 64 * 1024);
$data = json_decode((string) $raw, true);
if (!is_array($data)) out(400, ['ok' => false, 'error' => 'badbody']);

/* ---- honeypot: if the hidden "company" field is filled, silently accept ---- */
if (trim((string) ($data['company'] ?? '')) !== '') out(200, ['ok' => true]);

/* ---- interaction signal: main.js flips "interacted" to true after the first
   pointerdown/keydown/touchstart on any form field (see initContactForm). A bot
   that POSTs straight at this endpoint without running our JS never sets it, so
   anything other than a strict boolean true is rejected. The front end shows the
   same generic error + mailto fallback as every other guard, so a real visitor
   (whose interaction always sets this) is never affected. ---- */
if (($data['interacted'] ?? null) !== true) out(422, ['ok' => false, 'error' => 'bot']);

/* ---- time trap: the browser sends "elapsed" = milliseconds the form was on
   screen before submit (Date.now() - loadedAt, see initContactForm in main.js).
   A person needs seconds to fill this in; a script posts instantly. We compare
   ONLY that elapsed value - never a client timestamp against the server clock,
   which would break for anyone whose clock is off. Missing, non-numeric or under
   3 seconds is rejected. The front end shows the generic error + mailto fallback,
   so a real visitor is never stuck. ---- */
$elapsed = $data['elapsed'] ?? null;
if (!is_numeric($elapsed) || (float) $elapsed < 3000) out(422, ['ok' => false, 'error' => 'fast']);

/* ---- sanitize + validate ---- */
function clean($s, $max) {
  $s = (string) $s;
  $s = str_replace(["\0"], '', $s);
  $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s); // strip control chars
  $s = trim($s);
  if (mb_strlen($s) > $max) $s = mb_substr($s, 0, $max);
  return $s;
}
$name    = clean($data['name'] ?? '', 120);
$email   = clean($data['email'] ?? '', 160);
$phone   = clean($data['phone'] ?? '', 40);
$message = clean($data['message'] ?? '', 4000);
$consent = !empty($data['consent']);
$lang    = preg_match('/^(en|hr|de)$/', (string) ($data['lang'] ?? '')) ? $data['lang'] : 'en';

// e-mail also must not contain newlines (header-injection guard for Reply-To)
$email = str_replace(["\r", "\n"], '', $email);

if ($name === '' || $message === '' || !$consent) out(422, ['ok' => false, 'error' => 'fields']);
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) out(422, ['ok' => false, 'error' => 'email']);

/* ---- proof-of-work: main.js (WebCrypto) searches for a nonce such that
   SHA-256(email + elapsed + nonce) begins with 4 hex zeros ("0000") and sends it
   as "nonce". We recompute the very same hash here and reject a mismatch. Costs a
   visitor a few ms; multiplies the per-attempt cost for a mass spammer.
   IMPORTANT: the check applies ONLY when a nonce is present. main.js omits it
   when crypto.subtle is unavailable (old browser / non-secure context) - a
   documented fallback - so we must not block those visitors; the honeypot, time
   trap, interaction signal and rate limit still guard them. email/elapsed are
   concatenated exactly as the client did (elapsed is the integer ms value; email
   is the trimmed address), so the digests line up byte for byte. ---- */
if (isset($data['nonce']) && (string) $data['nonce'] !== '') {
  $nonce = (string) $data['nonce'];
  if (substr(hash('sha256', $email . $elapsed . $nonce), 0, 4) !== '0000') {
    out(422, ['ok' => false, 'error' => 'pow']);
  }
}

/* ---- spam heuristic: reject link-stuffed messages. More than 3 URLs
   (http://, https:// or a bare www.) or any "<a ... href" markup is treated as
   spam. Client gets the same generic error; honeypot, rate limit, consent and
   the time trap all remain in force. ---- */
if (preg_match_all('~\b(?:https?://|www\.)~i', $message) > 3
    || preg_match('~<a\b[^>]*\bhref~i', $message)) {
  out(422, ['ok' => false, 'error' => 'spam']);
}

/* ---- simple per-IP rate limit: max 5 requests / 60s, file-based (no DB) ----
   If the temp store is unavailable we skip limiting rather than blocking users. */
$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$rlFile = sys_get_temp_dir() . '/foka_rl_' . md5($ip) . '.json';
$now = time();
$hits = [];
if (is_readable($rlFile)) { $hits = json_decode((string) file_get_contents($rlFile), true) ?: []; }
$hits = array_values(array_filter($hits, function ($t) use ($now) { return ($now - $t) < 60; }));
if (count($hits) >= 5) out(429, ['ok' => false, 'error' => 'ratelimit']);
$hits[] = $now;
@file_put_contents($rlFile, json_encode($hits), LOCK_EX);

/* ---- load secret config (key outside web root) ---- */
$cfg = null;
$candidates = [
  __DIR__ . '/../../foka-config.php',   // recommended: above public_html
  __DIR__ . '/../config.php',           // public_html/config.php
  __DIR__ . '/config.php',              // public_html/api/config.php (test only)
];
$envPath = getenv('FOKA_CONFIG');
if ($envPath) array_unshift($candidates, $envPath);
foreach ($candidates as $p) { if ($p && is_readable($p)) { $c = require $p; if (is_array($c)) { $cfg = $c; break; } } }

$apiKey = $cfg['resend_api_key'] ?? getenv('RESEND_API_KEY') ?: '';
$to     = $cfg['to'] ?? 'fokadive@gmail.com';
$from   = $cfg['from'] ?? 'Foka Diving Center <web@foka.hr>';
if (!$apiKey || $apiKey === 'RESEND_API_KEY_OVDJE') out(500, ['ok' => false, 'error' => 'config']);

/* ---- compose + send via Resend ---- */
$subjects = [
  'en' => 'Website inquiry - Foka Diving Center',
  'hr' => 'Upit s web stranice - Foka Diving Center',
  'de' => 'Anfrage über die Website - Foka Diving Center',
];
$lines = [
  'Name: ' . $name,
  'E-mail: ' . $email,
  'Phone: ' . ($phone !== '' ? $phone : '-'),
  'Language: ' . $lang,
  '',
  $message,
];
$text = implode("\n", $lines);

$payload = json_encode([
  'from' => $from,
  'to' => [$to],
  'reply_to' => $email,
  'subject' => $subjects[$lang],
  'text' => $text,
]);

$ch = curl_init('https://api.resend.com/emails');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => $payload,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 15,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . $apiKey,
    'Content-Type: application/json',
  ],
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($resp === false || $code < 200 || $code >= 300) {
  out(502, ['ok' => false, 'error' => 'send']);
}
out(200, ['ok' => true]);

/* =========================================================================
   HOW TO TEST THIS ENDPOINT
   -------------------------------------------------------------------------
   PHP does not run on the Node dev server and was not installed on the build
   machine, so these were NOT executed locally. Run them once on Hostinger (or
   on any box with PHP) and you have covered every guard in this file.

   Syntax check:
     php -l api/contact.php

   Local PHP server (from dist/, so /api/contact.php resolves):
     php -S localhost:8090 -t dist
     BASE=http://localhost:8090/api/contact.php     # on Hostinger: https://foka.hr/api/contact.php

   (a) Valid request -> passes EVERY validation, then stops at the API key.
       Expect: HTTP 500 {"ok":false,"error":"config"} while the key is still the
       placeholder. Once the real Resend key is in place this becomes 200 ok.
       "interacted":true is required; "nonce" must satisfy the proof-of-work
       (SHA-256(email+elapsed+nonce) starts with "0000") - compute one with:
         node -e 'const c=require("crypto");let n=0;const p="test@example.com"+5000;while(c.createHash("sha256").update(p+n).digest("hex").slice(0,4)!=="0000")n++;console.log(n)'
     curl -i -X POST "$BASE" -H 'Content-Type: application/json' \
       -d '{"name":"Test","email":"test@example.com","phone":"","message":"Upit","consent":true,"elapsed":5000,"interacted":true,"nonce":"<computed>","company":"","lang":"hr"}'

   (a2) Missing "interacted" (bot posting straight to the endpoint) -> HTTP 422
        {"ok":false,"error":"bot"}
   (a3) Present but wrong "nonce" -> HTTP 422 {"ok":false,"error":"pow"}
        (omit "nonce" entirely and the PoW check is skipped - old-browser fallback)
   (a4) Message with >3 links or <a href markup -> HTTP 422 {"ok":false,"error":"spam"}

   (b) No consent -> HTTP 422 {"ok":false,"error":"fields"}
     curl -i -X POST "$BASE" -H 'Content-Type: application/json' \
       -d '{"name":"Test","email":"test@example.com","message":"Upit","consent":false,"elapsed":5000,"lang":"hr"}'

   (c) Submitted too fast -> HTTP 422 {"ok":false,"error":"fast"}
     curl -i -X POST "$BASE" -H 'Content-Type: application/json' \
       -d '{"name":"Test","email":"test@example.com","message":"Upit","consent":true,"elapsed":500,"lang":"hr"}'
     (same result if "elapsed" is missing entirely or is not a number)

   (d) Honeypot filled -> HTTP 200 {"ok":true}, and nothing is sent. The bot is
       told it succeeded on purpose, and this happens before the time trap.
     curl -i -X POST "$BASE" -H 'Content-Type: application/json' \
       -d '{"name":"Bot","email":"bot@example.com","message":"spam","consent":true,"elapsed":5000,"company":"ACME","lang":"hr"}'

   (e) Rate limit, max 5 per 60 s per IP -> the 6th answers HTTP 429
       {"ok":false,"error":"ratelimit"}
     for i in 1 2 3 4 5 6; do
       curl -s -o /dev/null -w "req $i -> %{http_code}\n" -X POST "$BASE" \
         -H 'Content-Type: application/json' \
         -d '{"name":"Test","email":"test@example.com","message":"Upit","consent":true,"elapsed":5000,"lang":"hr"}'
     done
     # expected: 500 500 500 500 500 429   (500 = config, i.e. everything else passed)

   Error codes the front end maps (initContactForm in main.js): every non-ok
   answer shows the same generic message plus a mailto: fallback, so "bot",
   "pow", "spam", "fast", "fields", "email", "ratelimit", "config" and "send"
   never leave a visitor without a way to reach us - and, crucially, never tell
   an attacker which filter caught them.
   ========================================================================= */

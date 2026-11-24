<?php
// Mjesečni podsjetnik na porezne rokove (Resend).
// POST: prijava iz obrasca u kalendaru. Provjerava podatke i šalje e-mail za potvrdu s potpisanom poveznicom
//       (vrijedi 7 dana). Do potvrde se u Resendu ništa ne sprema, a ovdje se osobni podaci ne spremaju.
// GET ?potvrda=TOKEN: kontakt u Resendu (svojstva vrsta i jezik, segment Podsjetnik), pa stranica „Prijava potvrđena”.
// GET ?odjava=TOKEN: odjava, pa stranica odjave. POST ?odjava=TOKEN: odjava jednim klikom (List-Unsubscribe-Post).

declare(strict_types=1);

ini_set('display_errors', '0');

$private = getenv('FENIX_PRIVATE') ?: __DIR__ . '/../fenix-private';
require $private . '/forms.php';
require $private . '/mail.php';
require $private . '/reminder.php';

$wantsJson = wants_json();

function respond(int $status, bool $ok, bool $json): never
{
    header('Cache-Control: no-store');
    if ($json) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok]);
    } elseif ($ok) {
        // povratak na stranicu s koje je prijava poslana (porezni kalendar na jeziku stranice)
        $page = (string) ($_POST['page'] ?? '');
        http_response_code(303);
        header('Location: ' . (preg_match('~^/(?!/)[a-z0-9/-]{0,120}\z~', $page) === 1 ? $page : '/porezni-kalendar/') . '#prijava');
    } else {
        fail($status);
    }
    exit;
}

function redirect(string $path): never
{
    http_response_code(303);
    header('Cache-Control: no-store');
    header('Location: ' . $path);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';

/** Jezik iz neispravnog ili isteklog tokena (ako se može pročitati), za poruku na kalendaru na tom jeziku. */
function token_lang(string $token): string
{
    $raw = json_decode((string) b64url_decode(explode('.', $token)[0]), true);
    return is_array($raw) && in_array($raw['l'] ?? null, REMINDER_LANGS, true) ? $raw['l'] : 'hr';
}

// ---- odjava (poveznica u podsjetniku i odjava jednim klikom) ----
if (isset($_GET['odjava'])) {
    $data = reminder_token_read('odjava', (string) $_GET['odjava']);
    if ($data === null) {
        if ($method === 'POST') {
            http_response_code(400);
            exit;
        }
        redirect(reminder_path(token_lang((string) $_GET['odjava']), 'calendar') . '#odjava-neispravna');
    }
    try {
        reminder_unsubscribe($data['e']);
    } catch (Throwable $e) {
        error_log('podsjetnik.php: odjava nije uspjela: ' . $e->getMessage());
        if ($method === 'POST') {
            http_response_code(502);
            exit;
        }
        redirect(reminder_path($data['l'], 'calendar') . '#neuspjelo');
    }
    if ($method === 'POST') {
        http_response_code(200);
        header('Cache-Control: no-store');
        exit;
    }
    redirect(reminder_path($data['l'], 'unsubscribed'));
}

// ---- potvrda prijave ----
if (isset($_GET['potvrda'])) {
    $data = reminder_token_read('potvrda', (string) $_GET['potvrda']);
    // istekla ili neispravna poveznica: kalendar s porukom na jeziku prijave (ako se jezik može pročitati)
    if ($data === null) {
        redirect(reminder_path(token_lang((string) $_GET['potvrda']), 'calendar') . '#istekla');
    }
    try {
        reminder_subscribe($data['e'], $data['v'], $data['l']);
    } catch (Throwable $e) {
        error_log('podsjetnik.php: potvrda nije uspjela: ' . $e->getMessage());
        redirect(reminder_path($data['l'], 'calendar') . '#neuspjelo');
    }
    redirect(reminder_path($data['l'], 'confirmed'));
}

// ---- prijava iz obrasca ----
if ($method !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== parse_url('//' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)) {
    respond(403, false, $wantsJson);
}

// Skriveno polje: robot dobiva odgovor kao da je uspio, ništa se ne šalje.
if (is_robot()) {
    respond(200, true, $wantsJson);
}

$email = field('email');
$biz = field('biz');
$lang = page_lang();
if (strlen($email) > 120 || filter_var($email, FILTER_VALIDATE_EMAIL) === false
    || !array_key_exists($biz, REMINDER_TYPES) || field('consent') !== '1') {
    respond(422, false, $wantsJson);
}

// Ograničenje: najviše 3 prijave po IP adresi na sat, da nitko ne može masovno prijavljivati tuđe adrese.
// Čuva se samo HMAC IP adrese s dnevnom soli, najviše sat vremena.
$limited = with_log(data_dir() . '/reminder-limit.json', static function (array &$log): bool {
    $key = ip_key();
    if (count(array_filter($log, static fn($e) => ($e['ip'] ?? '') === $key)) >= 3) {
        return true;
    }
    $log[] = ['t' => time(), 'ip' => $key];
    return false;
});
if ($limited) {
    respond(429, false, $wantsJson);
}

$type = REMINDER_TYPES[$biz];
$link = REMINDER_SITE . '/podsjetnik.php?potvrda=' . reminder_token('potvrda', ['e' => $email, 'v' => $type, 'l' => $lang, 't' => time()]);
$mail = reminder_mail("potvrda/$lang/$type", ['%POTVRDA%' => $link]);
if ($mail === null) {
    error_log("podsjetnik.php: nema e-maila za potvrdu potvrda/$lang/$type (npm run podsjetnik)");
    respond(500, false, $wantsJson);
}
try {
    send_mail(['to' => $email] + $mail);
} catch (Throwable $e) {
    error_log('podsjetnik.php: e-mail za potvrdu nije poslan: ' . $e->getMessage());
    respond(502, false, $wantsJson);
}
respond(200, true, $wantsJson);

<?php
// Jednostrani raskid ugovora (čl. 81.a Zakona o zaštiti potrošača), dva koraka:
// step=review samo provjerava podatke (bez JavaScripta vraća stranicu s pregledom i skrivenim poljima),
// step=confirm bilježi vrijeme zaprimanja (Europe/Zagreb), kupcu odmah šalje potvrdu, a uredu obavijest.

declare(strict_types=1);

ini_set('display_errors', '0');

$private = getenv('FENIX_PRIVATE') ?: __DIR__ . '/../fenix-private';
require $private . '/forms.php';
require $private . '/mail.php';
require $private . '/templates.php';

// Izgrađena stranica raskida na jeziku s kojeg je obrazac poslan (polje page); inače hrvatska.
$pageFileFor = static function (string $path): string {
    $file = __DIR__ . $path . 'index.html';
    return str_ends_with($path, '/') && is_file($file) ? $file : __DIR__ . '/raskid-ugovora/index.html';
};
$pageFile = $pageFileFor(page());

// Potvrda (korak 3) bez JavaScripta.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && isset($_GET['potvrda'])) {
    $saved = token_get((string) $_GET['potvrda']);
    if ($saved === null || ($saved['type'] ?? '') !== 'raskid') {
        http_response_code(303);
        header('Location: ' . page());
        exit;
    }
    render_page($pageFileFor((string) ($saved['page'] ?? '/')), ' data-step="3"', ['at' => $saved['received'], 'order' => $saved['order'], 'email' => $saved['email'] ?? '']);
}

require_post();

$step = field('step') === 'confirm' ? 'confirm' : 'review';

if (is_robot()) {
    done([], page());
}

$d = [
    'name' => field('name'),
    'email' => field('email'),
    'order' => field('order'),
    'received' => field('received'),
    'note' => field('note', true),
    'page' => page(),
];

$errors = [];
if (!fits($d['name'], 2, 100)) {
    $errors['name'] = t('field.name');
}
if (!valid_email($d['email'])) {
    $errors['email'] = t('field.email');
}
if (preg_match('/^\d{4}-\d{4}$/', $d['order']) !== 1) {
    $errors['order'] = t('field.order');
}
if ($d['received'] !== '') {
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $d['received']);
    if ($date === false || $date->format('Y-m-d') !== $d['received']) {
        $errors['received'] = t('field.received');
    }
}
if (!fits($d['note'], 0, 2000)) {
    $errors['note'] = t('field.note');
}
if ($errors) {
    fail(422, $errors);
}

// Korak 2: pregled. Skrivena polja nose izvorne vrijednosti, a prikaz je čitljiv.
if ($step === 'review') {
    if (wants_json()) {
        send_json(200, ['ok' => true]);
    }
    $raw = array_intersect_key($d, array_flip(['name', 'email', 'order', 'received', 'note']));
    render_page($pageFile, ' data-step="2"', [
        'note' => $d['note'] !== '' ? $d['note'] : t('withdrawal.none'),
        'received' => received_display($d['received']),
    ] + $raw, $raw);
}

$result = guarded_send(json_encode($d), static function () use ($d): array {
    $now = time();
    $d['received_at'] = zagreb_time($now);
    $auto = try_send_mail(withdrawal_customer_mail($d) + ['to' => $d['email'], 'to_name' => $d['name']]);
    // ured dobiva vrijeme zaprimanja u hrvatskom obliku i kad je raskid poslan sa strane jezične stranice
    $office = ['received_at' => with_lang('hr', fn() => zagreb_time($now))] + $d;
    send_office_mail(with_lang('hr', fn() => withdrawal_office_mail($office, $auto, $now)) + [
        'to' => config()['to'],
        'reply_to' => $d['email'],
        'reply_name' => $d['name'],
    ], $auto);
    return ['received' => $d['received_at'], 'order' => $d['order'], 'email' => $d['email']];
});

if (wants_json()) {
    send_json(200, ['ok' => true, 'received' => $result['received'], 'order' => $result['order'], 'email' => $result['email']]);
}
$token = token_put(['type' => 'raskid', 'page' => page()] + $result);
done([], '/raskid.php?potvrda=' . $token);

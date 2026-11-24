<?php
// Narudžba knjige Tajna novca. Poslužitelj sam računa iznose, dodjeljuje broj narudžbe (2026-0042),
// kupcu šalje potvrdu s kodom za plaćanje (HUB3) i privicima, a uredu obavijest.
// Bez JavaScripta: 303 na ?potvrda=TOKEN, koji sat vremena prikazuje stranicu narudžbe s potvrdom.

declare(strict_types=1);

ini_set('display_errors', '0');

// Build ovdje upisuje sadržaj src/data/book.json; dok je oznaka na mjestu, čita se datoteka iz projekta.
const BOOK_JSON = '{"price":1158,"postage":300,"postagePerOrder":true,"maxQty":999}';

$private = getenv('FENIX_PRIVATE') ?: __DIR__ . '/../fenix-private';
require $private . '/forms.php';
require $private . '/mail.php';
require $private . '/templates.php';
require $private . '/shop.php';
require $private . '/hub3.php';

$orderPage = '/tajna-novca/narudzba/';

// Stranica potvrde bez JavaScripta.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && isset($_GET['potvrda'])) {
    $saved = token_get((string) $_GET['potvrda']);
    if ($saved === null || ($saved['type'] ?? '') !== 'narudzba') {
        http_response_code(303);
        header('Location: ' . $orderPage);
        exit;
    }
    // Potvrda zamjenjuje obrazac: data-done na <html>, a blok potvrde više nije skriven.
    render_page(__DIR__ . '/tajna-novca/narudzba/index.html', ' data-done', [
        'order' => $saved['order'],
        'email' => $saved['email'],
    ], [], [' data-ok hidden' => ' data-ok']);
}

require_post();

if (is_robot()) {
    done([], $orderPage);
}

$book = book(BOOK_JSON, dirname(__DIR__) . '/src/data/book.json');

$d = [
    'buyer' => field('buyer'),
    'name' => field('name'),
    'company' => field('company'),
    'oib' => field('oib'),
    'email' => field('email'),
    'phone' => field('phone'),
    'street' => field('street'),
    'postal' => field('postal'),
    'city' => field('city'),
    'note' => field('note', true),
    'page' => page(),
];
$qtyRaw = field('qty');

$errors = [];
if (!in_array($d['buyer'], ['osobno', 'tvrtka'], true)) {
    $errors['buyer'] = t('field.buyer');
}
if ($d['buyer'] === 'tvrtka') {
    $d['name'] = '';
    if (!fits($d['company'], 2, 100)) {
        $errors['company'] = t('field.company');
    }
    if (!valid_oib($d['oib'])) {
        $errors['oib'] = t('field.oib');
    }
} else {
    $d['company'] = $d['oib'] = '';
    if (!fits($d['name'], 2, 100)) {
        $errors['name'] = t('field.name');
    }
}
if (!valid_email($d['email'])) {
    $errors['email'] = t('field.email');
}
if ($d['phone'] !== '' && !valid_phone($d['phone'])) {
    $errors['phone'] = t('field.phone');
}
if (!fits($d['street'], 2, 100)) {
    $errors['street'] = t('field.street');
}
if (preg_match('/^\d{5}$/', $d['postal']) !== 1) {
    $errors['postal'] = t('field.postal');
}
if (!fits($d['city'], 2, 60)) {
    $errors['city'] = t('field.city');
}
if (!fits($d['note'], 0, 2000)) {
    $errors['note'] = t('field.note');
}
$max = (int) $book['maxQty'];
if (preg_match('/^\d{1,4}$/', $qtyRaw) !== 1 || (int) $qtyRaw < 1 || (int) $qtyRaw > $max) {
    $errors['qty'] = t('field.qty', ['max' => $max]);
}
if (field('terms') !== '1') {
    $errors['terms'] = t('field.terms');
}
if ($errors) {
    fail(422, $errors);
}

$d['qty'] = (int) $qtyRaw;
$d['book'] = $book;
$d['amounts'] = order_amounts($d['qty'], $book);

$result = guarded_send(json_encode($d), static function () use ($d): array {
    $d['order'] = next_order_number(data_dir() . '/narudzbe-brojac.json');
    $png = hub3_png(hub3_text([
        'amount' => $d['amounts']['total'],
        'payer_name' => order_display_name($d),
        'payer_street' => $d['street'],
        'payer_city' => $d['postal'] . ' ' . $d['city'],
        'reference' => $d['order'],
        'description' => t('order.description_value', ['order' => $d['order']]),
    ]));
    $auto = try_send_mail(order_customer_mail($d, $png) + [
        'to' => $d['email'],
        'to_name' => order_display_name($d),
        'attachments' => [
            ['path' => __DIR__ . '/Uvjeti-prodaje.pdf', 'name' => t('order.attachment_terms')],
            ['path' => __DIR__ . '/obrazac-za-raskid-ugovora.pdf', 'name' => t('order.attachment_form')],
        ],
    ]);
    send_office_mail(with_lang('hr', fn() => order_office_mail($d, $auto, time())) + [
        'to' => config()['to'],
        'reply_to' => $d['email'],
        'reply_name' => order_display_name($d),
    ], $auto);
    return ['order' => $d['order']];
});

if (wants_json()) {
    send_json(200, ['ok' => true, 'order' => $result['order'], 'email' => $d['email']]);
}
$token = token_put(['type' => 'narudzba', 'order' => $result['order'], 'email' => $d['email']]);
done([], '/narudzba.php?potvrda=' . $token);

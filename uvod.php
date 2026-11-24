<?php
// Besplatan uvod knjige Tajna novca: e-mail s poveznicom na PDF (uvod_pdf_url iz config.php) i obavijest uredu.
// Adresa se nigdje ne sprema; ograničenje slanja čuva samo HMAC IP adrese.

declare(strict_types=1);

ini_set('display_errors', '0');

// Build ovdje upisuje sadržaj src/data/book.json (cijena u e-mailu); dok je oznaka na mjestu, čita se datoteka iz projekta.
const BOOK_JSON = '{"price":1158,"postage":300,"postagePerOrder":true,"maxQty":999}';

$private = getenv('FENIX_PRIVATE') ?: __DIR__ . '/../fenix-private';
require $private . '/forms.php';
require $private . '/mail.php';
require $private . '/templates.php';
require $private . '/shop.php';

require_post();

if (is_robot()) {
    done([], '/tajna-novca/#uvod-poslan');
}

$email = field('email');
if (!valid_email($email)) {
    fail(422, ['email' => t('field.email')]);
}

// Dok Iva ne pošalje PDF uvoda, slanje ne uspijeva s porukom i telefonom.
$pdfUrl = (string) config()['uvod_pdf_url'];
if ($pdfUrl === '') {
    error_log('uvod.php: uvod_pdf_url nije postavljen');
    fail(503, [], ['reason' => 'unavailable'], rich('error.intro_unavailable', ['phone' => fenix_phone_link()]));
}

$d = [
    'email' => $email,
    'pdf_url' => $pdfUrl,
    'book' => book(BOOK_JSON, dirname(__DIR__) . '/src/data/book.json'),
    'page' => page(),
];

guarded_send(null, static function () use ($d): array {
    $auto = try_send_mail(intro_customer_mail($d) + ['to' => $d['email']]);
    send_office_mail(with_lang('hr', fn() => intro_office_mail($d, $auto, time())) + ['to' => config()['to'], 'reply_to' => $d['email']], $auto);
    return [];
});

done([], '/tajna-novca/#uvod-poslan');

<?php
// Obrasci za upit: konzultacije (zadano), Kontakt i škole i vrtići. Posjetitelj s e-mail adresom dobiva
// automatsku potvrdu, a ured obavijest sa svim podacima. Zajednička zaštita je u fenix-private/forms.php.

declare(strict_types=1);

ini_set('display_errors', '0');

$private = getenv('FENIX_PRIVATE') ?: __DIR__ . '/../fenix-private';
require $private . '/forms.php';
require $private . '/mail.php';
require $private . '/templates.php';

require_post();

// Robot dobiva odgovor kao da je uspio, ništa se ne šalje.
if (is_robot()) {
    done([], page() . '#poslano');
}

$form = field('form') ?: 'konzultacije';
$name = field('name');
$contact = field('contact');
$message = field('message', true);
$institution = field('institution');
$place = field('place');
$children = field('children');
// Natpis pitanja kako ga posjetitelj vidi, bez upitnika na kraju (pitanja se razlikuju po stranici).
$label = static fn(string $key, string $default): string => rtrim(field($key), '?') ?: $default;
$questions = [
    [$label('q1t', 'Prvo pitanje'), field('q1')],
    [$label('q2t', 'Drugo pitanje'), field('q2')],
];
$isEmail = valid_email($contact);

$errors = [];
if (!in_array($form, ['konzultacije', 'kontakt', 'skole'], true)) {
    $form = 'konzultacije';
}
if (!fits($name, 2, 100)) {
    $errors['name'] = t('field.name');
}
if (!$isEmail && !valid_phone($contact)) {
    $errors['contact'] = t('field.contact');
}
if (!fits($message, 0, 2000)) {
    $errors['message'] = t('field.message');
}
if ($form === 'skole') {
    if (!fits($institution, 2, 150)) {
        $errors['institution'] = t('field.institution');
    }
    if (!fits($place, 2, 60)) {
        $errors['place'] = t('field.place');
    }
    if (preg_match('/^.{0,20}$/su', $children) !== 1) {
        $errors['children'] = t('field.children');
    }
}
foreach ($questions as [$q, $a]) {
    if (chars($q) > 80 || chars($a) > 80) {
        fail(422, $errors);
    }
}
if ($errors) {
    fail(422, $errors);
}

$data = compact('form', 'name', 'contact', 'message', 'institution', 'place', 'children', 'questions') + [
    'contact_is_email' => $isEmail,
    'page' => page(),
];

guarded_send(json_encode($data), static function () use ($data, $isEmail, $name, $contact): array {
    $auto = null;
    if ($isEmail) {
        $auto = try_send_mail(inquiry_customer_mail($data) + ['to' => $contact, 'to_name' => $name]);
    }
    send_mail(with_lang('hr', fn() => inquiry_office_mail($data, $auto, time())) + [
        'to' => config()['to'],
        'reply_to' => $isEmail ? $contact : '',
        'reply_name' => $name,
    ]);
    return [];
});

done([], page() . '#poslano');

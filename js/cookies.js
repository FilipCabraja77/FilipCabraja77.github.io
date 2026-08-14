/* =========================================================
   Veterinarska ambulanta Novo Brestje - cookies.js
   Privola za kolačiće: traka pri prvom posjetu + modal s postavkama.
   Vanilla JS, bez ovisnosti. Uključuje se na SVE stranice, s defer.

   Načelo (GDPR): nijedan neobavezni kolačić ni skripta ne smiju se
   učitati prije privole. Ništa nije unaprijed označeno - analitika i
   karta kreću iskLjučene i uključuju se samo izričitim izborom.

   Traka i modal grade se iz JS-a namjerno: markup je tako identičan na
   svim stranicama i ne treba ga održavati na četiri mjesta.
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'vanb-cookie-consent';
  var VERSION = 1;

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var POLICY_URL = 'politika-kolacica.html';

  /* -------------------------------------------------------
     1. Pohrana
     ------------------------------------------------------- */
  function readConsent() {
    var raw;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    var v;
    try { v = JSON.parse(raw); } catch (e) { return null; }
    if (!v || typeof v !== 'object') return null;
    // Promjena verzije poništava staru privolu - traka se javlja ponovno.
    if (v.verzija !== VERSION) return null;
    return {
      nuzni: true,
      analitika: v.analitika === true,
      karta: v.karta === true,
      verzija: VERSION,
      datum: v.datum || null
    };
  }

  function saveConsent(analitika, karta) {
    var v = {
      nuzni: true,
      analitika: analitika === true,
      karta: karta === true,
      verzija: VERSION,
      datum: new Date().toISOString()
    };
    try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* privatni način rada */ }
    applyConsent(v);
    return v;
  }

  /* -------------------------------------------------------
     2. Primjena privole
     ------------------------------------------------------- */
  var analyticsLoaded = false;

  function loadAnalytics() {
    if (analyticsLoaded) return;
    analyticsLoaded = true;
    /* MJESTO ZA GOOGLE ANALYTICS.
       Kad klijentica odluči uvesti analitiku, mjerni kod ide OVDJE - dakle
       tek nakon privole, nikad u <head>. Primjer:

         var s = document.createElement('script');
         s.async = true;
         s.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
         document.head.appendChild(s);
         window.dataLayer = window.dataLayer || [];
         function gtag(){ dataLayer.push(arguments); }
         gtag('js', new Date());
         gtag('config', 'G-XXXXXXX', { anonymize_ip: true });

       Zasad namjerno prazno - nema mjernog koda na stranici. */
  }

  function loadMaps() {
    $$('iframe[data-src]').forEach(function (frame) {
      if (frame.getAttribute('src')) return;
      frame.setAttribute('src', frame.getAttribute('data-src'));
    });
    $$('[data-map-gate]').forEach(function (gate) { gate.hidden = true; });
  }

  function unloadMaps() {
    // Povlačenje privole: makni src da se karta više ne učitava.
    $$('iframe[data-src]').forEach(function (frame) { frame.removeAttribute('src'); });
    $$('[data-map-gate]').forEach(function (gate) { gate.hidden = false; });
  }

  function applyConsent(v) {
    if (v.analitika) loadAnalytics();
    if (v.karta) loadMaps(); else unloadMaps();
  }

  /* -------------------------------------------------------
     3. Traka za privolu
     ------------------------------------------------------- */
  var banner = null;

  function buildBanner() {
    var el = document.createElement('div');
    el.className = 'ckbar';
    el.id = 'ckbar';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Obavijest o kolačićima');
    el.innerHTML =
      '<div class="container">' +
        '<div class="ckbar__card">' +
          '<span class="ckbar__icon" aria-hidden="true"><svg><use href="#i-paw"></use></svg></span>' +
          '<p class="ckbar__text">Koristimo nužne kolačiće za rad stranice. Analitiku i Google kartu učitavamo <strong>samo uz vašu privolu</strong>. Više u <a class="ckbar__link" href="' + POLICY_URL + '">Politici kolačića</a>.</p>' +
          '<div class="ckbar__actions">' +
            '<button type="button" class="btn btn--accent" data-ck="all">Prihvati sve</button>' +
            '<button type="button" class="btn btn--ghost" data-ck="none">Odbij ne nužne</button>' +
            '<button type="button" class="btn btn--quiet" data-ck="open">Postavke</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ck]');
      if (!btn) return;
      var a = btn.getAttribute('data-ck');
      if (a === 'all')  { saveConsent(true, true);  hideBanner(); }
      if (a === 'none') { saveConsent(false, false); hideBanner(); }
      if (a === 'open') { openModal(btn); }
    });
    return el;
  }

  /* Visina trake u CSS varijablu, da joj se plutajući gumb za poziv (.fab)
     može maknuti s puta. Traka je različito visoka na različitim širinama
     (tekst se prelama, gumbi se slažu u stupac), pa se mjeri stvarna
     visina umjesto da se upisuje konstanta. */
  function syncBannerHeight() {
    if (!banner || banner.hidden) {
      document.documentElement.style.setProperty('--cookiebar-h', '0px');
      return;
    }
    document.documentElement.style.setProperty(
      '--cookiebar-h', Math.round(banner.getBoundingClientRect().height) + 'px'
    );
  }

  function showBanner() {
    if (!banner) banner = buildBanner();
    document.body.classList.add('has-ckbar');
    banner.hidden = false;
    // Mjeri se tek kad je traka u rasporedu - skrivena nema visinu.
    window.requestAnimationFrame(syncBannerHeight);
    window.addEventListener('resize', syncBannerHeight);
  }

  function hideBanner() {
    if (!banner) return;
    banner.hidden = true;
    document.body.classList.remove('has-ckbar');
    window.removeEventListener('resize', syncBannerHeight);
    syncBannerHeight();
  }

  /* -------------------------------------------------------
     4. Modal s postavkama
     ------------------------------------------------------- */
  var modal = null;
  var lastTrigger = null;

  var CATEGORIES = [
    {
      id: 'nuzni', always: true,
      naslov: 'Nužni kolačići',
      opis: 'Potrebni su za osnovni rad stranice i pamćenje vašeg izbora o kolačićima. Bez njih stranica ne radi ispravno, pa se ne mogu isključiti.'
    },
    {
      id: 'analitika', always: false,
      naslov: 'Analitički kolačići',
      opis: 'Pomažu nam razumjeti kako se stranica koristi kako bismo je stalno poboljšavali. Podaci su anonimni i skupni.'
    },
    {
      id: 'karta', always: false,
      naslov: 'Vanjski sadržaj - karta',
      opis: 'Google karta u sekciji Kontakt učitava se s Googleovih poslužitelja i pritom im se prenosi vaša IP adresa. Bez privole karta se ne učitava.'
    }
  ];

  function buildModal() {
    var el = document.createElement('div');
    el.className = 'ckmodal';
    el.id = 'ckmodal';
    el.hidden = true;

    var rows = CATEGORIES.map(function (c) {
      var inputId = 'ck-' + c.id;
      var attrs = c.always ? ' checked disabled' : '';
      var badge = c.always ? '<span class="ckcat__badge">Uvijek aktivni</span>' : '';
      return '' +
        '<div class="ckcat">' +
          '<div class="ckcat__head">' +
            '<label class="ckcat__label" for="' + inputId + '">' + c.naslov + '</label>' +
            badge +
            '<span class="switch">' +
              '<input class="switch__input" type="checkbox" id="' + inputId + '" data-cat="' + c.id + '"' + attrs + '>' +
              '<span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>' +
            '</span>' +
          '</div>' +
          '<p class="ckcat__desc">' + c.opis + '</p>' +
        '</div>';
    }).join('');

    el.innerHTML =
      '<div class="ckmodal__overlay" data-ck-close></div>' +
      '<div class="ckmodal__panel" role="dialog" aria-modal="true" aria-labelledby="ckmodal-title" aria-describedby="ckmodal-desc">' +
        '<div class="ckmodal__head">' +
          '<h2 class="ckmodal__title" id="ckmodal-title">Postavke kolačića</h2>' +
          '<button type="button" class="ckmodal__close" data-ck-close aria-label="Zatvori postavke">' +
            '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
          '</button>' +
        '</div>' +
        '<p class="ckmodal__desc" id="ckmodal-desc">Odaberite što dopuštate. Nužni kolačići su uvijek uključeni; sve ostalo je po vašem izboru i možete ga promijeniti kad god želite.</p>' +
        '<div class="ckmodal__body">' + rows + '</div>' +
        '<div class="ckmodal__actions">' +
          '<button type="button" class="btn btn--accent" data-ck="save">Spremi postavke</button>' +
          '<button type="button" class="btn btn--outline" data-ck="all">Prihvati sve</button>' +
          '<button type="button" class="btn btn--quiet-dark" data-ck="none">Odbij ne nužne</button>' +
        '</div>' +
        '<p class="ckmodal__foot"><a class="ckmodal__link" href="' + POLICY_URL + '">Pročitajte Politiku kolačića</a></p>' +
      '</div>';

    document.body.appendChild(el);

    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-ck-close]')) { closeModal(); return; }
      var btn = e.target.closest('[data-ck]');
      if (!btn) return;
      var a = btn.getAttribute('data-ck');
      if (a === 'save') {
        saveConsent($('#ck-analitika', el).checked, $('#ck-karta', el).checked);
      } else if (a === 'all') {
        saveConsent(true, true);
      } else if (a === 'none') {
        saveConsent(false, false);
      }
      hideBanner();
      closeModal();
    });

    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      if (e.key === 'Tab') trapTab(e);
    });

    return el;
  }

  function focusables() {
    return $$('button, [href], input:not([disabled])', $('.ckmodal__panel', modal))
      .filter(function (n) { return n.offsetParent !== null || n === document.activeElement; });
  }

  function trapTab(e) {
    var items = focusables();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openModal(trigger) {
    if (!modal) modal = buildModal();
    lastTrigger = trigger || document.activeElement;

    // Prekidači uvijek pokazuju trenutačno spremljeno stanje.
    var saved = readConsent();
    $('#ck-analitika', modal).checked = !!(saved && saved.analitika);
    $('#ck-karta', modal).checked = !!(saved && saved.karta);

    modal.hidden = false;
    document.body.classList.add('is-locked');
    var items = focusables();
    if (items.length) items[0].focus();
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('is-locked');
    if (lastTrigger && document.contains(lastTrigger) && lastTrigger.offsetParent !== null) {
      lastTrigger.focus();
    }
    lastTrigger = null;
  }

  /* -------------------------------------------------------
     5. Okidači izvan trake i modala
     ------------------------------------------------------- */
  document.addEventListener('click', function (e) {
    var open = e.target.closest('[data-cookie-settings]');
    if (open) { e.preventDefault(); openModal(open); return; }

    // „Prikaži kartu" na zaslonu ispred karte - uključi samo tu kategoriju.
    var allow = e.target.closest('[data-map-allow]');
    if (allow) {
      e.preventDefault();
      var saved = readConsent();
      saveConsent(saved ? saved.analitika : false, true);
      hideBanner();
    }
  });

  /* -------------------------------------------------------
     6. Start
     ------------------------------------------------------- */
  var consent = readConsent();
  if (consent) {
    applyConsent(consent);        // Zapamćen izbor - bez trake.
  } else {
    unloadMaps();                 // Bez privole karta ostaje blokirana.
    showBanner();
  }
})();

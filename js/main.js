/* =========================================================
   Veterinarska ambulanta Novo Brestje - main.js
   Vanilla JS, bez ovisnosti. Sve interakcije stranice.
   ========================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* -------------------------------------------------------
     1. Zaglavlje - smanjivanje pri skrolanju
     ------------------------------------------------------- */
  (function initHeader() {
    var header = $('#header');
    if (!header) return;

    var ticking = false;
    function update() {
      header.classList.toggle('is-scrolled', window.scrollY > 20);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();

  /* -------------------------------------------------------
     2. Mobilni izbornik (fullscreen overlay)
     ------------------------------------------------------- */
  (function initNav() {
    var nav = $('#nav');
    var burger = $('#hamburger');
    if (!nav || !burger) return;

    /* Zaključavanje pozadine dok je izbornik otvoren.
       Sam `overflow: hidden` na body-u na iOS Safariju ne zaustavlja skrol,
       pa se body fiksira, a scroll pozicija pamti i vraća pri zatvaranju.
       Klasa je namjerno odvojena od .is-locked (modal za kolačiće): ta ne
       smije pomicati stranicu, a ova je pomiče pa se mora točno poništiti. */
    var lockedY = 0;
    var isLocked = false;

    function lockPage() {
      if (isLocked) return;
      lockedY = window.pageYOffset || document.documentElement.scrollTop || 0;
      document.body.style.top = -lockedY + 'px';
      document.body.classList.add('is-navlocked');
      isLocked = true;
    }

    function unlockPage() {
      if (!isLocked) return;
      document.body.classList.remove('is-navlocked');
      document.body.style.top = '';
      isLocked = false;
      // Povratak na zapamćenu poziciju mora biti trenutačan - globalni
      // scroll-behavior: smooth inače animira i taj skok.
      var html = document.documentElement;
      var prev = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      window.scrollTo(0, lockedY);
      html.style.scrollBehavior = prev;
    }

    function open() {
      nav.classList.add('is-open');
      burger.setAttribute('aria-expanded', 'true');
      lockPage();
      var first = $('a, button', nav);
      if (first) first.focus();
    }

    function close(returnFocus) {
      nav.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      unlockPage();
      if (returnFocus) burger.focus();
    }

    /* Skok na sekciju BEZ animacije i bez sudara s otključavanjem pozadine.
       Poštuje scroll-margin-top sekcija (visina sticky zaglavlja). */
    function jumpTo(target, toTop) {
      var html = document.documentElement;
      var prev = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      if (toTop) window.scrollTo(0, 0);
      else target.scrollIntoView();
      html.style.scrollBehavior = prev;
    }

    burger.addEventListener('click', function () {
      if (nav.classList.contains('is-open')) close(true); else open();
    });

    /* Zatvaranje je delegirano na cijeli overlay: klik često završi na <svg>
       unutar gumba, a delegacija ga svejedno uhvati - i ne ovisi o tome je li
       gumb postojao u trenutku vezanja slušača. */
    nav.addEventListener('click', function (e) {
      var el = e.target;
      var closer = el && el.closest ? el.closest('.nav__close') : null;
      if (!closer) return;
      e.preventDefault();
      close(true);
    });

    /* Klik na poveznicu zatvara izbornik.
       Za sidra na istoj stranici preuzimamo skrol: prvo se izbornik zatvori i
       pozadina otključa (body se vrati iz position: fixed na zapamćenu
       poziciju), pa se TEK u sljedećem kadru skače na sekciju. Bez toga se
       vraćanje scroll pozicije i skok na sidro dogode u istom trenutku i biju
       se - na mobitelu se to vidi kao trzanje. Na desktopu ne diramo ništa,
       ondje vrijedi obično glatko skrolanje iz CSS-a. */
    $$('a', nav).forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (!nav.classList.contains('is-open')) return;

        var href = a.getAttribute('href') || '';
        if (href.charAt(0) !== '#' || href.length < 2) { close(false); return; }

        var target = document.getElementById(href.slice(1));
        if (!target) { close(false); return; }

        e.preventDefault();
        close(false);
        window.requestAnimationFrame(function () {
          jumpTo(target, href === '#top');
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', href);
          }
        });
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) close(true);
    });

    // Zatvori pri prelasku na desktop širinu
    var mq = window.matchMedia('(min-width: 861px)');
    var onChange = function (e) { if (e.matches) close(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  })();

  /* -------------------------------------------------------
     3. Akordeon (usluge, FAQ) - animirano otvaranje
        uz ispravno skrivanje panela (hidden) za čitače ekrana
     ------------------------------------------------------- */
  function expand(panel) {
    panel.hidden = false;
    if (reduceMotion) { panel.style.maxHeight = 'none'; return; }
    panel.style.maxHeight = '0px';
    panel.style.opacity = '0';
    // prisili reflow pa animiraj
    void panel.offsetHeight;
    panel.style.maxHeight = panel.scrollHeight + 'px';
    panel.style.opacity = '1';
    var done = function (e) {
      if (e.propertyName !== 'max-height') return;
      panel.style.maxHeight = 'none';
      panel.removeEventListener('transitionend', done);
    };
    panel.addEventListener('transitionend', done);
  }

  function collapse(panel) {
    if (reduceMotion) { panel.hidden = true; panel.style.maxHeight = ''; return; }
    panel.style.maxHeight = panel.scrollHeight + 'px';
    void panel.offsetHeight;
    panel.style.maxHeight = '0px';
    panel.style.opacity = '0';
    var done = function (e) {
      if (e.propertyName !== 'max-height') return;
      panel.hidden = true;
      panel.style.maxHeight = '';
      panel.style.opacity = '';
      panel.removeEventListener('transitionend', done);
    };
    panel.addEventListener('transitionend', done);
  }

  /**
   * Poveže skup gumba s panelima. Uvijek je otvoren najviše jedan.
   * @param {string} rootSel  selektor kontejnera
   * @param {string} btnSel   selektor gumba unutar kontejnera
   * @param {string} itemSel  selektor stavke koja dobiva klasu .is-open (neobavezno)
   */
  function accordion(rootSel, btnSel, itemSel) {
    var root = $(rootSel);
    if (!root) return;
    var buttons = $$(btnSel, root);

    // Panele koji su u HTML-u već otvoreni pripremi za animaciju
    buttons.forEach(function (btn) {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      if (btn.getAttribute('aria-expanded') === 'true') {
        panel.hidden = false;
        panel.style.maxHeight = 'none';
        if (itemSel) { var it = btn.closest(itemSel); if (it) it.classList.add('is-open'); }
      }
    });

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (!panel) return;
        var isOpen = btn.getAttribute('aria-expanded') === 'true';

        // zatvori ostale
        buttons.forEach(function (other) {
          if (other === btn) return;
          if (other.getAttribute('aria-expanded') !== 'true') return;
          var op = document.getElementById(other.getAttribute('aria-controls'));
          other.setAttribute('aria-expanded', 'false');
          if (itemSel) { var oi = other.closest(itemSel); if (oi) oi.classList.remove('is-open'); }
          if (op) collapse(op);
        });

        btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        if (itemSel) {
          var item = btn.closest(itemSel);
          if (item) item.classList.toggle('is-open', !isOpen);
        }
        if (isOpen) collapse(panel); else expand(panel);
      });
    });
  }

  // Gumbi su u vodoravnoj traci, a paneli ispod nje - accordion ih spaja
  // preko aria-controls pa lokacija panela nije bitna.
  accordion('#services-scroller', '.scard__toggle', '.scard');
  accordion('#faq-acc',           '.acc__toggle',   '.acc__item');

  /* -------------------------------------------------------
     3.1 Usluge - X u panelu zatvara detalj
        Ne dira stanje izravno nego okine gumb kartice, pa aria-expanded,
        animacija i klasa .is-open ostaju u nadležnosti akordeona.
     ------------------------------------------------------- */
  (function initPanelClose() {
    $$('.panel__close').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panel = btn.closest('.service__panel');
        if (!panel) return;
        var toggle = $('[aria-controls="' + panel.id + '"]');
        if (!toggle || toggle.getAttribute('aria-expanded') !== 'true') return;
        toggle.click();
        toggle.focus();
      });
    });
  })();

  /* -------------------------------------------------------
     3.2 Usluge - vodoravni klizač (strelice na desktopu)
     ------------------------------------------------------- */
  (function initServicesScroller() {
    var scroller = $('#services-scroller');
    var track = $('.services__track', scroller || document);
    var prev = $('#services-prev');
    var next = $('#services-next');
    if (!scroller || !track || !prev || !next) return;

    function stepWidth() {
      var card = $('.scard', track);
      if (!card) return Math.round(scroller.clientWidth * 0.8);
      var styles = window.getComputedStyle(track);
      var gap = parseFloat(styles.columnGap || styles.gap) || 0;
      return Math.round(card.getBoundingClientRect().width + gap);
    }

    function maxScroll() {
      return scroller.scrollWidth - scroller.clientWidth;
    }

    // Pomak za jednu karticu, ali nikad preko rubova: ako bi sljedeći klik
    // prešao kraj, ide se točno na maxScroll() - ondje je i snap točka
    // zadnje kartice (scroll-snap-align: end), pa se vidi cijela i nije
    // potreban dodatni klik.
    function move(dir) {
      var target = scroller.scrollLeft + dir * stepWidth();
      target = Math.max(0, Math.min(target, maxScroll()));
      scroller.scrollTo({
        left: target,
        behavior: reduceMotion ? 'auto' : 'smooth'
      });
    }

    function sync() {
      var max = maxScroll();
      prev.disabled = scroller.scrollLeft <= 1;
      next.disabled = scroller.scrollLeft >= max - 1;
    }

    next.addEventListener('click', function () { move(1); });
    prev.addEventListener('click', function () { move(-1); });

    // sync() je jeftin (dva čitanja i dva boolean upisa) pa ide izravno -
    // bez rAF zastavice koja bi, ako kadar izostane, trajno zapela.
    scroller.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  })();

  /* -------------------------------------------------------
     4. Brojke - count-up pri skrolanju
     ------------------------------------------------------- */
  (function initStats() {
    var nums = $$('.stat__num');
    if (!nums.length) return;

    var DURATION = 2100;   // duže od prijašnjih 1500ms - brojanje je mirnije

    // Početno stanje za nježan ulaz (fade + pomak prema gore). Postavlja ga
    // JS, pa bez skripte brojka stoji na mjestu i odmah je čitljiva.
    if (!reduceMotion) {
      nums.forEach(function (n) { n.classList.add('is-enter'); });
    }

    function run(el) {
      el.classList.remove('is-enter');

      var target = parseInt(el.getAttribute('data-count'), 10);
      var suffix = el.getAttribute('data-suffix') || '';
      if (isNaN(target)) { el.textContent = el.getAttribute('data-static') || el.textContent; return; }
      if (reduceMotion) { el.textContent = target + suffix; return; }

      var startTime = null;
      function step(ts) {
        if (startTime === null) startTime = ts;
        var p = Math.min((ts - startTime) / DURATION, 1);
        // easeOutQuart - kreće brže i duže se smiruje pred kraj nego kubna.
        var eased = 1 - Math.pow(1 - p, 4);
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    }

    if (!('IntersectionObserver' in window)) { nums.forEach(run); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        run(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.5 });

    nums.forEach(function (n) { io.observe(n); });
  })();

  /* -------------------------------------------------------
     4b. Brojke - lukovi koji se preobražavaju pri skrolanju

     Oba ruba trake koriste isti jednostruki luk kao dno heroja: kubična
     krivulja s kontrolnim točkama na x=360 i x=1080, simetrična i bez
     infleksije. Jedina promjenjiva veličina je dubina d.

     Dubina se računa iz Bézierove sredine. Za krivulju s rubovima na E i
     objema kontrolnim točkama na C vrijedi
       y(0.5) = (E + 3C + 3C + E) / 8 = (E + 3C) / 4,
     pa je dubina (razlika sredine i ruba) jednaka 3(C − E)/4. Obrnuto,
     za željenu dubinu d treba C = E + 4d/3 - odatle ±d/3 u formulama.

     Pri skrolanju kroz sekciju gornji se luk izravnava (90 → 0), a donji
     produbljuje (0 → 90). Napredak p je 0 kad vrh trake uđe na dno ekrana,
     a 1 kad vrh trake dođe na 40% visine ekrana (TOP_FLAT_AT). Ograničen je
     na [0, 1], pa gornji luk od te točke nadalje ostaje točno ravan - bez
     ostatka zakrivljenosti i bez vraćanja dok se skrola dalje. Donji luk
     se produbljuje do maksimuma na istom rasponu i ondje ostaje.

     Sredine lukova (TOP_MID = 8, BOTTOM_MID = 92) odabrane su tako da pri
     najvećoj dubini krivulja još stane u viewBox visine 100: gornja se
     kreće po y ∈ [8, 98], donja po y ∈ [2, 92]. Da su sredine ostale na
     38/62, luk od 90 izlazio bi izvan okvira i SVG bi ga odrezao.
     Pri dubini 0 ostaje tanka traka ispune (8 jedinica) - ravan rub, a
     ujedno i preklop koji sprječava dlaku šava pri necjelobrojnom
     omjeru piksela.
     ------------------------------------------------------- */
  (function initStatsCurves() {
    var band = $('#stats-band');
    var arcTop = $('#stats-arc-top');
    var arcBottom = $('#stats-arc-bottom');
    if (!band || !arcTop || !arcBottom) return;

    var MAX_DEPTH = 90;      // najdublji luk
    var MID_DEPTH = 30;      // mirna inačica (bez animacije)
    var TOP_FLAT_AT = 0.4;   // vrh trake na 40% visine ekrana → gornji luk je ravan
    var TOP_MID = 8;         // y sredine gornjeg luka (viewBox 0 0 1440 100)
    var BOTTOM_MID = 92;     // y sredine donjeg luka

    function round(n) { return Math.round(n * 100) / 100; }

    // Gornji luk: ispuna je iznad krivulje, pa se crta zdesna nalijevo.
    function topPath(d) {
      var e = round(TOP_MID + d);
      var c = round(TOP_MID - d / 3);
      return 'M0,0 L1440,0 L1440,' + e + ' C 1080,' + c + ' 360,' + c + ' 0,' + e + ' Z';
    }

    // Donji luk: ispuna je ispod krivulje (isti smjer kao kod heroja).
    function bottomPath(d) {
      var e = round(BOTTOM_MID - d);
      var c = round(BOTTOM_MID + d / 3);
      return 'M0,' + e + ' C 360,' + c + ' 1080,' + c + ' 1440,' + e + ' L1440,100 L0,100 Z';
    }

    function draw(depthTop, depthBottom) {
      arcTop.setAttribute('d', topPath(depthTop));
      arcBottom.setAttribute('d', bottomPath(depthBottom));
    }

    // Bez animacije: oba luka mirno stoje na istoj, umjerenoj dubini.
    if (reduceMotion) { draw(MID_DEPTH, MID_DEPTH); return; }

    var ticking = false;

    function update() {
      ticking = false;
      // Jedno čitanje geometrije po kadru, pa tek onda upisi - bez
      // naizmjeničnog čitanja i pisanja koje bi prisililo preračun rasporeda.
      var rect = band.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      // Put koji vrh trake prijeđe od dna ekrana do praga na 40% visine.
      var travel = vh * (1 - TOP_FLAT_AT);
      if (travel <= 0) return;

      var p = (vh - rect.top) / travel;
      if (p < 0) p = 0; else if (p > 1) p = 1;

      draw(MAX_DEPTH * (1 - p), MAX_DEPTH * p);
    }

    function onScroll() {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  })();

  /* -------------------------------------------------------
     5. Otkrivanje elemenata pri skrolanju
     ------------------------------------------------------- */
  (function initReveal() {
    var items = $$('.reveal');
    if (!items.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    items.forEach(function (el, i) {
      // Najviše 60ms razmaka među susjedima - kaskada se osjeti, ne primijeti.
      el.style.transitionDelay = (i % 3) * 30 + 'ms';
      io.observe(el);
    });
  })();

  /* -------------------------------------------------------
     6. Aktivna stavka navigacije (scrollspy)
     ------------------------------------------------------- */
  (function initScrollspy() {
    var links = $$('.nav__list a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    var sections = [];
    links.forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      var sec = document.getElementById(id);
      if (!sec) return;
      map[id] = link;
      sections.push(sec);
    });
    if (!sections.length) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = map[entry.target.id];
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach(function (l) { l.classList.remove('is-active'); });
          link.classList.add('is-active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach(function (s) { io.observe(s); });
  })();

  /* -------------------------------------------------------
     7. Galerija - mozaik u sekciji, lightbox preko svega

     Popis fotografija NIJE u ovoj datoteci: čita se iz DOM-a, iz svih
     `<li class="gallery__item">` unutar #galerija-popis, u redoslijedu u
     kojem stoje u index.html. Istaknute stavke (one koje se vide u mozaiku)
     nose pravi `<img>`, a ostatak seta samo `data-src` / `data-alt` /
     `data-w` / `data-h` - tako preglednik njihove datoteke ne skida dok
     lightbox ne zatraži sliku. Nova fotka = jedan novi `<li>`, bez diranja
     JS-a.
     ------------------------------------------------------- */
  (function initGallery() {
    var list = $('#galerija-popis');
    var box = $('#lightbox');
    if (!list || !box) return;

    var items = $$('.gallery__item', list);
    if (!items.length) return;

    /* Jedan zapis po fotografiji: {src, alt, w, h}. */
    var photos = items.map(function (li) {
      var img = $('img', li);
      if (img) {
        return {
          src: img.getAttribute('src'),
          alt: img.getAttribute('alt') || '',
          w: img.getAttribute('width'),
          h: img.getAttribute('height')
        };
      }
      return { src: li.dataset.src, alt: li.dataset.alt || '', w: li.dataset.w, h: li.dataset.h };
    }).filter(function (p) { return !!p.src; });

    if (!photos.length) return;

    var panel = $('.lbox__panel', box);
    var imgEl = $('#lbox-img');
    var countEl = $('#lbox-count');
    var allBtn = $('#galerija-sve');
    var countOut = $('#galerija-broj');

    var index = 0;
    var lastTrigger = null;

    // Broj u gumbu uvijek prati stvarno stanje popisa.
    if (countOut) countOut.textContent = String(photos.length);

    function show(i) {
      index = (i + photos.length) % photos.length;
      var p = photos[index];
      imgEl.setAttribute('src', p.src);
      imgEl.setAttribute('alt', p.alt);
      if (p.w) imgEl.setAttribute('width', p.w);
      if (p.h) imgEl.setAttribute('height', p.h);
      // Opis ostaje samo u `alt` - vidljiv natpis se ne ispisuje.
      countEl.textContent = (index + 1) + ' / ' + photos.length;
    }

    /* Susjedne fotke se predučitavaju tiho: listanje tada nema bijeli bljesak,
       a stranica pri učitavanju i dalje skida samo istaknute slike. */
    function prefetch(i) {
      var p = photos[(i + photos.length) % photos.length];
      if (!p) return;
      var pre = new Image();
      pre.src = p.src;
    }

    function focusables() {
      return $$('button', panel).filter(function (n) { return n.offsetParent !== null; });
    }

    function trapTab(e) {
      var f = focusables();
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function open(i, trigger) {
      lastTrigger = trigger || document.activeElement;
      show(i);
      box.hidden = false;
      document.body.classList.add('is-lightbox');
      var closeBtn = $('.lbox__close', box);
      if (closeBtn) closeBtn.focus();
      prefetch(index + 1);
      prefetch(index - 1);
    }

    function close() {
      if (box.hidden) return;
      box.hidden = true;
      document.body.classList.remove('is-lightbox');
      // Slika se ne prazni: ostaje u kešu za sljedeće otvaranje.
      if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
      lastTrigger = null;
    }

    function step(dir) {
      show(index + dir);
      prefetch(index + dir);
    }

    /* Klik na istaknutu fotografiju otvara lightbox točno na njoj.
       Delegacija: cilj klika često je <img>, a ne sama poveznica. */
    list.addEventListener('click', function (e) {
      var link = e.target.closest ? e.target.closest('.gallery__btn') : null;
      if (!link) return;
      e.preventDefault();
      var li = link.closest('.gallery__item');
      var src = link.getAttribute('href');
      var i = photos.findIndex(function (p) { return p.src === src; });
      open(i < 0 ? items.indexOf(li) : i, link);
    });

    if (allBtn) {
      allBtn.addEventListener('click', function () { open(0, allBtn); });
    }

    box.addEventListener('click', function (e) {
      // Klik u prazno oko panela (padding lightboxa) zatvara kao i zastor.
      if (e.target === box) { close(); return; }
      var el = e.target.closest ? e.target.closest('[data-lbox]') : null;
      if (!el) return;
      var a = el.getAttribute('data-lbox');
      if (a === 'close') close();
      else if (a === 'prev') step(-1);
      else if (a === 'next') step(1);
    });

    document.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'Tab') trapTab(e);
    });

    /* Listanje prstom. Prag od 45px razlikuje namjeran potez od drhtaja, a
       uvjet na okomiti pomak sprječava da okretanje uređaja ili skrol
       preskoče fotografiju. */
    var touchX = 0;
    var touchY = 0;
    box.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      touchX = t.clientX;
      touchY = t.clientY;
    }, { passive: true });

    box.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - touchX;
      var dy = t.clientY - touchY;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
      step(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  /* Mobilni gumb za poziv (.fab) nema JS - okrugli je gumb koji stalno stoji
     dolje desno. Nekadašnja traka .callbar skrivala se kad bi sekcija
     #kontakt ušla u vidokrug; to je uklonjeno zajedno s njom. */

})();

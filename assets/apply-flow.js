/* QURA Film Academy — multi-page application flow logic. v2
   Adds: "Other (specify)" boxes, advisory portrait-card slider, 3s slider cadence,
   welcome film-poster marquee, gentle fee-help question (no scholarship), and
   removes the funding/parents questions. State persists in sessionStorage. */
(function () {
  'use strict';

  var ENDPOINT = '/api/intake';
  var PROSPECTUS = '/QURA-Film-Academy-Prospectus-2026-27.pdf';
  var ORDER = ['about', 'fit', 'commitment', 'story'];
  var URLS = { about: 'about.html', fit: 'fit.html', commitment: 'commitment.html', story: 'story.html' };
  var TITLES = ['About you', 'Fit', 'Commitment', 'Your story'];
  var STORE = 'qura_app', RESP = 'qura_app_resp', ATTR = 'qura_attr', STARTED = 'qura_started';
  var SLIDE_MS = 3000, SUBMIT_TIMEOUT = 10000;

  var step = document.body.getAttribute('data-step') || 'about';

  function load() { try { return JSON.parse(sessionStorage.getItem(STORE) || '{}'); } catch (e) { return {}; } }
  function save(d) { try { sessionStorage.setItem(STORE, JSON.stringify(d)); } catch (e) {} }
  function cookie(n) { var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)')); return m ? m[1] : ''; }

  (function () {
    var keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid'];
    var qs = new URLSearchParams(location.search), stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(ATTR) || '{}'); } catch (e) {}
    var changed = false;
    keys.forEach(function (k) { var v = qs.get(k); if (v && !stored[k]) { stored[k] = v; changed = true; } });
    if (changed) { try { sessionStorage.setItem(ATTR, JSON.stringify(stored)); } catch (e) {} }
  })();
  function attr() { try { return JSON.parse(sessionStorage.getItem(ATTR) || '{}'); } catch (e) { return {}; } }

  function fireFormStart(intent) {
    try { if (sessionStorage.getItem(STARTED)) return; sessionStorage.setItem(STARTED, '1'); } catch (e) {}
    try { if (typeof fbq === 'function') fbq('trackCustom', 'FormStart', { intent: intent || 'apply' }); } catch (e) {}
  }
  function fireLead(eventId) {
    try { if (typeof fbq === 'function') fbq('track', 'Lead', { content_name: 'QURA One-Year Filmmaking Programme' }, { eventID: eventId }); } catch (e) {}
    try { if (typeof window.gtag === 'function') window.gtag('event', 'conversion', { send_to: 'AW-18125399100/BZZzCNzIg7EcELzI7aJD' }); } catch (e) {}
  }

  /* ---------- option data ---------- */
  var STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'];
  var OPT = {
    age_band: [['under_18','Under 18'],['18_21','18–21'],['22_25','22–25'],['26_30','26–30'],['31_35','31–35'],['36_plus','36 or above']],
    current_status: [['school',"I'm in school (Class 11 or below)"],['class_12',"I'm in Class 12"],['completed_12',"I've finished Class 12"],['college',"I'm in college"],['graduate',"I've graduated"],['working',"I'm working"],['business','I run my own business'],['other','Something else']],
    looking_for: [['fulltime','The full-time, 1-year filmmaking programme'],['short_course','A short course or weekend workshop'],['job','A job or internship'],['other','Something else']],
    english: [['very','Very comfortable'],['comfortable','Comfortable'],['not_comfortable','Not comfortable']],
    relocate: [['chennai','I already live in or near Chennai'],['yes','Yes, I can relocate'],['not_sure','Not sure yet'],['no','No — I need an online or near-home option']],
    start: [['jan_2027','January 2027 batch'],['later_2027','A later 2027 intake'],['exploring',"I'm just exploring for now"]],
    fee_help: [['set',"I'm set — no help needed"],['payment_plan','Yes, show me payment plans']],
    focus: [['direction','Direction'],['cinematography','Cinematography'],['editing','Editing'],['screenwriting','Screenwriting'],['sound','Sound'],['not_sure','Not sure yet'],['other','Something else']],
    experience: [['none','Nothing yet'],['reels','Reels or YouTube videos'],['short_films','Short films'],['professional',"I've worked on professional sets or productions"],['other','Something else']]
  };
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  /* ---------- render option cards + states ---------- */
  document.querySelectorAll('.qaf2-cards[data-field]').forEach(function (grp) {
    var name = grp.getAttribute('data-field'), opts = OPT[name] || [];
    grp.innerHTML = opts.map(function (o) {
      return '<label class="qaf2-card"><input type="radio" name="' + name + '" value="' + esc(o[0]) + '"><span class="qaf2-card-t">' + esc(o[1]) + '</span></label>';
    }).join('');
  });
  var stateSel = document.querySelector('select[name="state"]');
  if (stateSel) stateSel.innerHTML = '<option value="">Select your state…</option>' + STATES.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');

  /* ---------- populate from storage ---------- */
  var data = load();
  document.querySelectorAll('.qaf2-step [name]').forEach(function (el) {
    var v = data[el.name]; if (v == null) return;
    if (el.type === 'radio') el.checked = (el.value === v);
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });
  var why = document.querySelector('#why'), countN = document.querySelector('.qaf2-count-n');
  if (why && countN) { countN.textContent = String((why.value || '').trim().length); why.addEventListener('input', function () { countN.textContent = String(why.value.trim().length); }); }
  var phone = document.querySelector('#phone');
  if (phone) phone.addEventListener('input', function () { phone.value = phone.value.replace(/\D/g, '').slice(0, 10); });

  /* ---------- "Other" reveal ---------- */
  function syncOthers() {
    document.querySelectorAll('.qaf2-other[data-for]').forEach(function (o) {
      var f = o.getAttribute('data-for');
      var c = document.querySelector('input[name="' + f + '"]:checked');
      o.hidden = !(c && c.value === 'other');
    });
  }
  document.addEventListener('change', function (e) { if (e.target && e.target.type === 'radio') syncOthers(); });
  syncOthers();

  /* ---------- validation ---------- */
  var PHONE_BLOCK = { '9876543210':1,'9876543212':1,'1234567890':1,'0123456789':1 };
  function validPhone(v){ if(!/^[6-9]\d{9}$/.test(v))return false; if(PHONE_BLOCK[v])return false; if(/^(\d)\1{9}$/.test(v))return false; return true; }
  function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function fieldOf(el){ return el.closest ? el.closest('.qaf2-fld') : el.parentNode; }
  function setErr(fld,msg){ if(!fld)return; var b=fld.querySelector('.qaf2-err'); if(b)b.textContent=msg||''; fld.classList.toggle('has-err',!!msg); }

  function validateCurrent() {
    var scope = document.querySelector('.qaf2-step');
    if (!scope) return true;
    scope.querySelectorAll('.qaf2-fld').forEach(function (f) { setErr(f, ''); });
    var ok = true, firstBad = null;
    scope.querySelectorAll('.qaf2-cards[data-field]').forEach(function (grp) {
      var name = grp.getAttribute('data-field');
      if (!scope.querySelector('input[name="' + name + '"]:checked')) { setErr(fieldOf(grp), 'Please choose an option.'); ok = false; firstBad = firstBad || grp; }
    });
    scope.querySelectorAll('.qaf2-other[data-for]').forEach(function (o) {
      var f = o.getAttribute('data-for'), c = scope.querySelector('input[name="' + f + '"]:checked');
      if (c && c.value === 'other') { var t = o.querySelector('input,textarea'); if (t && !t.value.trim()) { setErr(fieldOf(o), 'Please tell us a bit more.'); ok = false; firstBad = firstBad || t; } }
    });
    scope.querySelectorAll('input,select,textarea').forEach(function (el) {
      if (el.type === 'radio') return;
      var name = el.name, v = (el.value || '').trim();
      if (name === 'full_name') { if (v.replace(/[^A-Za-zÀ-ɏ]/g,'').length < 3) { setErr(fieldOf(el),'Please enter your full name (at least 3 letters).'); ok=false; firstBad=firstBad||el; } }
      else if (name === 'phone') { if (!validPhone(v)) { setErr(fieldOf(el),'Please enter a valid 10-digit WhatsApp number — our admissions team will message you here.'); ok=false; firstBad=firstBad||el; } }
      else if (name === 'email') { if (!validEmail(v)) { setErr(fieldOf(el),'Please enter a valid email address.'); ok=false; firstBad=firstBad||el; } }
      else if (name === 'city') { if (v.length < 2) { setErr(fieldOf(el),'Please enter your city.'); ok=false; firstBad=firstBad||el; } }
      else if (name === 'state') { if (!v) { setErr(fieldOf(el),'Please select your state.'); ok=false; firstBad=firstBad||el; } }
      else if (name === 'why') { if (v.length < 150) { setErr(fieldOf(el),'Please write at least 150 characters (' + v.length + ' so far).'); ok=false; firstBad=firstBad||el; } }
      else if (name === 'portfolio_link') { if (v && !/^https?:\/\/.+/i.test(v)) { setErr(fieldOf(el),'Please enter a full link starting with http:// or https://'); ok=false; firstBad=firstBad||el; } }
      else if (name === 'consent') { if (!el.checked) { setErr(fieldOf(el),'Please accept to continue.'); ok=false; firstBad=firstBad||el; } }
    });
    if (firstBad && firstBad.focus) { try { firstBad.focus(); } catch (e) {} }
    return ok;
  }

  function collectCurrent() {
    var d = load();
    document.querySelectorAll('.qaf2-step [name]').forEach(function (el) {
      if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
      else if (el.type === 'checkbox') { d[el.name] = el.checked ? (el.value || 'yes') : ''; }
      else { d[el.name] = el.value.trim(); }
    });
    save(d); return d;
  }

  /* ---------- progress ---------- */
  (function () {
    var fill = document.querySelector('.qaf2-bar-fill'), label = document.querySelector('.qaf2-steplabel');
    var i = ORDER.indexOf(step);
    if (i >= 0 && fill) fill.style.width = Math.round(((i + 1) / ORDER.length) * 100) + '%';
    if (i >= 0 && label) label.textContent = 'Step ' + (i + 1) + ' of ' + ORDER.length + ' · ' + TITLES[i];
  })();

  /* ---------- image slider (3s) ---------- */
  document.querySelectorAll('.qaf2-media[data-images]').forEach(function (m) {
    var imgs = (m.getAttribute('data-images') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!imgs.length) return;
    imgs.forEach(function (src, idx) { var d = document.createElement('div'); d.className = 'slide' + (idx === 0 ? ' on' : ''); d.style.backgroundImage = "url('/assets/" + src + "')"; m.insertBefore(d, m.firstChild); });
    if (imgs.length > 1) { var cur = 0, s = m.querySelectorAll('.slide'); setInterval(function () { s[cur].classList.remove('on'); cur = (cur + 1) % s.length; s[cur].classList.add('on'); }, SLIDE_MS); }
  });

  /* ---------- advisory portrait-card slider (3s) ---------- */
  document.querySelectorAll('.qaf2-media[data-portraits]').forEach(function (m) {
    var items = (m.getAttribute('data-portraits') || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean)
      .map(function (s) { var p = s.split('|'); return { img: (p[0] || '').trim(), nm: (p[1] || '').trim(), rl: (p[2] || '').trim(), cd: (p[3] || '').trim() }; });
    if (!items.length) return;
    m.classList.add('portrait');
    var wrap = document.createElement('div'); wrap.className = 'qaf2-pcard-wrap';
    items.forEach(function (it, idx) {
      var c = document.createElement('div'); c.className = 'qaf2-pcard' + (idx === 0 ? ' on' : '');
      c.innerHTML = '<div class="ph"><img loading="lazy" src="/assets/' + esc(it.img) + '" alt="' + esc(it.nm) + '"></div><div class="nm">' + esc(it.nm) + '</div><div class="rl">' + esc(it.rl) + '</div>' + (it.cd ? '<div class="cd">' + esc(it.cd) + '</div>' : '');
      wrap.appendChild(c);
    });
    m.insertBefore(wrap, m.firstChild);
    if (items.length > 1) { var cur = 0, cards = wrap.querySelectorAll('.qaf2-pcard'); setInterval(function () { cards[cur].classList.remove('on'); cur = (cur + 1) % cards.length; cards[cur].classList.add('on'); }, 6000); }
  });

  /* ---------- welcome marquee: duplicate each row for a seamless loop ---------- */
  document.querySelectorAll('.mrow').forEach(function (r) { r.innerHTML += r.innerHTML; });

  /* ---------- intent + FormStart ---------- */
  var intent = (function () {
    var qs = new URLSearchParams(location.search).get('intent');
    if (qs) { var d = load(); d.intent = (qs === 'prospectus' || qs === 'info') ? qs : 'apply'; save(d); return d.intent; }
    return (load().intent) || 'apply';
  })();
  document.addEventListener('focusin', function (e) {
    if (e.target.closest && e.target.closest('.qaf2-step')) { fireFormStart(intent); var d = load(); if (!d.form_started_at) { d.form_started_at = Date.now(); save(d); } }
  });

  /* ---------- navigation ---------- */
  var nextBtn = document.querySelector('.qaf2-next'), backBtn = document.querySelector('.qaf2-back');
  if (backBtn) backBtn.addEventListener('click', function () { history.length > 1 ? history.back() : (location.href = 'index.html'); });
  var idx = ORDER.indexOf(step);
  if (nextBtn && idx >= 0 && idx < ORDER.length - 1) nextBtn.addEventListener('click', function () { if (validateCurrent()) { collectCurrent(); location.href = URLS[ORDER[idx + 1]]; } });
  var beginBtn = document.querySelector('.qaf2-begin');
  if (beginBtn) beginBtn.addEventListener('click', function () { location.href = 'about.html'; });

  /* ---------- submit ---------- */
  var submitBtn = document.querySelector('.qaf2-submit');
  if (submitBtn && step === 'story') {
    var submitting = false;
    submitBtn.addEventListener('click', function () {
      if (submitting) return;
      if (!validateCurrent()) return;
      submitting = true; submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
      var d = collectCurrent(), a = attr();
      var payload = Object.assign({}, d, {
        intent: d.intent || 'apply', page_url: location.href, user_agent: navigator.userAgent,
        utm_source: a.utm_source || '', utm_medium: a.utm_medium || '', utm_campaign: a.utm_campaign || '', utm_content: a.utm_content || '', utm_term: a.utm_term || '', fbclid: a.fbclid || '',
        fbc: cookie('_fbc'), fbp: cookie('_fbp'),
        form_started_at: d.form_started_at || Date.now(), form_submitted_at: Date.now(),
        website: (document.querySelector('[name="website"]') || {}).value || '',
        qura_test: /[?&]qura_test=1(&|$)/.test(location.search) ? '1' : ''
      });
      var ctrl = new AbortController(); var timer = setTimeout(function () { ctrl.abort(); }, SUBMIT_TIMEOUT);
      function done(resp) { clearTimeout(timer); try { sessionStorage.setItem(RESP, JSON.stringify(resp || {})); } catch (e) {} location.href = 'submitted.html'; }
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'omit', signal: ctrl.signal })
        .then(function (r) { return r.json().catch(function () { return { ok: true, tier: 'warm', fire_lead: false }; }); })
        .then(function (j) { done(j || { ok: true, tier: 'warm', fire_lead: false }); })
        .catch(function () { done({ ok: true, tier: 'warm', fire_lead: false }); });
    });
  }

  /* ---------- submitted ---------- */
  if (step === 'submitted') {
    var resp = {}; try { resp = JSON.parse(sessionStorage.getItem(RESP) || '{}'); } catch (e) {}
    var d2 = load(), tier = resp.tier || 'warm';
    var h = document.querySelector('.qaf2-done h1'), p = document.querySelector('.qaf2-done p');
    var row = document.querySelector('.qaf2-done .row'), small = document.querySelector('.qaf2-done .small');
    var nextUrl = resp.next_url || '', buttons = '';
    if (tier === 'hot') {
      if (h) h.textContent = "You're shortlisted for the next step.";
      if (p) p.textContent = 'Complete your application and pay the ₹1,500 application fee to book your entrance exam. Our admissions team will also call you within 24 hours.';
      if (nextUrl) { buttons += '<a class="qaf2-btn primary" href="' + esc(nextUrl) + '" target="_blank" rel="noopener" style="margin-left:0">Complete my application</a>'; if (small) small.textContent = "We've also sent this link to your WhatsApp."; }
    } else if (tier === 'nurture') {
      if (h) h.textContent = 'Thank you for your interest in QURA.';
      if (p) p.textContent = 'QURA is a full-time, in-person programme in Chennai, taught in English. From your answers it may not be the right fit right now — we’ll keep you posted about future intakes.';
      if (nextUrl) buttons += '<a class="qaf2-btn primary" href="' + esc(nextUrl) + '" target="_blank" rel="noopener" style="margin-left:0">See our online programmes</a>';
    } else {
      if (h) h.textContent = 'Application received.';
      if (p) p.textContent = 'Our admissions team will call you within 2 working days. Keep an eye on WhatsApp for a message from QURA.';
    }
    if ((d2.intent || 'apply') === 'prospectus') buttons += '<a class="qaf2-btn ghost" href="' + PROSPECTUS + '" target="_blank" rel="noopener">Download the prospectus</a>';
    buttons += '<a class="qaf2-btn ghost" href="/">Back to QURA</a>';
    if (row) row.innerHTML = buttons;
    if (resp.fire_lead === true) fireLead(resp.lead_event_id || '');
  }
})();

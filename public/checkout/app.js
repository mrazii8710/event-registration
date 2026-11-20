(function () {
  'use strict';

  // ---------- config & session ----------
  const CFG_KEY = 'checkout-config-v1';
  const SES_KEY = 'checkout-session-v1';
  const UNDO_MINUTES = 15;

  function loadConfig() {
    const c = window.CHECKOUT_CONFIG || {};
    const filled = c.supabaseUrl && !/YOUR-PROJECT-REF/.test(c.supabaseUrl) && c.supabaseKey && !/PASTE-YOUR/.test(c.supabaseKey);
    if (filled) return { url: c.supabaseUrl.replace(/\/+$/, ''), key: c.supabaseKey.trim() };
    try { const s = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if (s && s.url && s.key) return s; } catch (e) {}
    return null;
  }
  let cfg = loadConfig();
  let ses = null; // { code, name, role, eventName }
  try { ses = JSON.parse(sessionStorage.getItem(SES_KEY) || 'null'); } catch (e) {}

  const $ = (id) => document.getElementById(id);
  function show(id) { ['setup', 'login', 'app'].forEach((v) => $(v).classList.toggle('hidden', v !== id)); }

  // ---------- server calls ----------
  async function rpc(fn, args, cfgOverride) {
    const c = cfgOverride || cfg;
    const headers = { 'content-type': 'application/json', apikey: c.key };
    if (/^eyJ/.test(c.key)) headers.authorization = 'Bearer ' + c.key; // legacy anon JWT
    let res;
    try {
      res = await fetch(c.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args || {}) });
    } catch (e) {
      throw new Error('network');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      const msg = (data && (data.message || data.hint)) || ('HTTP ' + res.status);
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return data;
  }

  function friendly(err) {
    const m = (err && err.message) || '';
    if (m === 'network' || !navigator.onLine) return "Can't reach the server. Check the internet connection.";
    if (m.includes('invalid_code')) return 'Wrong access code.';
    if (m.includes('Could not find the function') || m.includes('checkout_')) return 'The check-out database setup is missing. Run checkout_setup.sql in Supabase first.';
    if (m.includes('Invalid API key') || err.status === 401) return 'The Supabase key in config.js is not right.';
    return 'Something went wrong: ' + m;
  }

  // ---------- helpers ----------
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const isPhone = (v) => digits(v).length >= 7;
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
    return n;
  }
  const PHONE_LABEL = /mobile|phone|whats|contact|number|tel/i;
  const PARENT = /parent|guardian|father|mother/i;
  const HIDE_SUB = /name|mobile|phone|whats|contact|number|tel|timestamp|date|transport|place|gender/i;

  function describe(p) {
    const info = Array.isArray(p.info) ? p.info : [];
    const phones = [];
    for (const [label, value] of info) if (PHONE_LABEL.test(label) && isPhone(value) && !phones.includes(value)) phones.push(value);
    const sub = info.filter(([label, value]) => !HIDE_SUB.test(label) && value && value !== p.name).slice(0, 3).map(([l, v]) => (String(v).length <= 3 ? l + ' ' + v : v)).join(' · ');
    const parentName = (info.find(([l]) => PARENT.test(l) && /name/i.test(l)) || [])[1] || '';
    const parentPhone =
      (info.find(([l, v]) => PARENT.test(l) && PHONE_LABEL.test(l) && isPhone(v)) || [])[1] ||
      (info.find(([l, v]) => /whats/i.test(l) && isPhone(v)) || [])[1] || phones[0] || '';
    return { info, phones, sub, parentName, parentPhone };
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg, ok = true, undo = null) {
    clearTimeout(toastTimer);
    $('toastMsg').textContent = msg;
    $('toast').className = 'toast ' + (ok ? 'ok' : 'bad');
    const b = $('toastBtn');
    b.classList.toggle('hidden', !undo);
    b.onclick = undo ? async () => { $('toast').classList.add('hidden'); await undo(); } : null;
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), undo ? 8000 : 3200);
  }

  // ---------- setup ----------
  $('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = { url: $('setupUrl').value.trim().replace(/\/+$/, ''), key: $('setupKey').value.trim() };
    $('setupErr').classList.add('hidden');
    try {
      await rpc('checkout_login', { p_code: '' }, c);
    } catch (err) {
      // A wrong-code answer means the connection itself works.
      if (!(err.message || '').includes('invalid_code')) {
        $('setupErr').textContent = friendly(err);
        $('setupErr').classList.remove('hidden');
        return;
      }
    }
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
    cfg = c;
    show('login');
    $('loginName').focus();
  });

  // ---------- login ----------
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('loginName').value.trim();
    const code = $('loginCode').value;
    $('loginErr').classList.add('hidden');
    $('loginBtn').disabled = true;
    try {
      const r = await rpc('checkout_login', { p_code: code });
      ses = { code, name, role: r.role, eventName: r.event_name };
      sessionStorage.setItem(SES_KEY, JSON.stringify(ses));
      $('loginCode').value = '';
      enterApp();
    } catch (err) {
      $('loginErr').textContent = friendly(err);
      $('loginErr').classList.remove('hidden');
    } finally {
      $('loginBtn').disabled = false;
    }
  });

  $('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(SES_KEY);
    ses = null;
    clearInterval(summaryTimer);
    $('q').value = '';
    $('results').replaceChildren();
    show('login');
    $('loginName').focus();
  });

  // ---------- main ----------
  let summaryTimer = null;
  function enterApp() {
    $('eventName').textContent = ses.eventName || 'Check-out';
    $('who').textContent = '· ' + ses.name;
    $('adminBox').classList.toggle('hidden', ses.role !== 'admin');
    show('app');
    $('q').focus();
    loadSummary();
    clearInterval(summaryTimer);
    summaryTimer = setInterval(loadSummary, 20000);
  }

  function handleAuthError(err) {
    if ((err.message || '').includes('invalid_code')) {
      toast('The access code was changed. Please log in again.', false);
      $('logoutBtn').click();
      return true;
    }
    return false;
  }

  async function loadSummary() {
    if (!ses) return;
    try {
      const s = await rpc('checkout_summary', { p_code: ses.code });
      $('stHere').textContent = Math.max(0, s.present - s.left);
      $('stLeft').textContent = s.left;
      renderRecent(s.recent || []);
    } catch (err) { handleAuthError(err); }
  }

  function canUndo(ts) { return ses.role === 'admin' || Date.now() - new Date(ts).getTime() < UNDO_MINUTES * 60000; }

  async function undo(id, name) {
    try {
      const r = await rpc('checkout_undo', { p_code: ses.code, p_checkout_id: id });
      if (!r.undone) return toast('Too late to undo here. Ask the admin.', false);
      toast('Check-out for ' + name + ' undone');
      loadSummary();
      if ($('q').value.trim()) search($('q').value);
    } catch (err) { if (!handleAuthError(err)) toast(friendly(err), false); }
  }

  function pickupText(c) {
    const who = c.pickup_name || (c.pickup_type === 'parent' ? 'parent' : 'someone else');
    return who + (c.pickup_relation ? ' (' + c.pickup_relation + ')' : '');
  }

  function renderRecent(list) {
    const box = $('recent');
    box.replaceChildren();
    for (const r of list) {
      box.append(el('div', { class: 'item' },
        el('div', { class: 'who' },
          el('b', { text: r.student_name }),
          el('span', { class: 'muted', text: fmtTime(r.at) + ' · with ' + pickupText(r) + (r.recorded_by ? ' · by ' + r.recorded_by : '') })),
        canUndo(r.at) ? el('button', { class: 'btn-link', type: 'button', text: 'Undo', onclick: () => undo(r.id, r.student_name) }) : null));
    }
    $('recentWrap').classList.toggle('hidden', list.length === 0 || $('q').value.trim() !== '');
  }

  // ---------- search ----------
  let seq = 0, debounce = null;
  $('q').addEventListener('input', () => {
    $('clearBtn').classList.toggle('hidden', !$('q').value);
    clearTimeout(debounce);
    debounce = setTimeout(() => search($('q').value), 300);
  });
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); search($('q').value); }
    if (e.key === 'Escape') clearSearch();
  });
  $('clearBtn').addEventListener('click', clearSearch);
  function clearSearch() {
    seq++;
    $('q').value = '';
    $('clearBtn').classList.add('hidden');
    $('results').replaceChildren();
    $('hint').textContent = 'Searches everyone registered or checked in. Any number format works.';
    $('recentWrap').classList.toggle('hidden', $('recent').children.length === 0);
    $('q').focus();
  }

  async function search(q) {
    const my = ++seq;
    q = q.trim();
    $('recentWrap').classList.toggle('hidden', q !== '' || $('recent').children.length === 0);
    if (q.length < 2) { $('results').replaceChildren(); $('hint').textContent = 'Searches everyone registered or checked in. Any number format works.'; return; }
    $('hint').textContent = 'Searching…';
    try {
      const r = await rpc('checkout_search', { p_code: ses.code, p_query: q });
      if (my !== seq) return;
      if (r.too_short) { $('hint').textContent = 'Type at least 4 digits of the number.'; $('results').replaceChildren(); return; }
      $('hint').textContent = r.total ? r.total + (r.total === 1 ? ' match' : ' matches') + (r.total > r.results.length ? ', showing ' + r.results.length + '. Type more to narrow down' : '') : '';
      renderResults(r.results);
    } catch (err) {
      if (my !== seq) return;
      if (!handleAuthError(err)) $('hint').textContent = friendly(err);
    }
  }

  function renderResults(list) {
    const box = $('results');
    box.replaceChildren();
    if (!list.length) {
      box.append(el('div', { class: 'empty' }, el('b', { text: 'No one found' }), el('div', { class: 'small', text: 'Try the parent\'s number, or another spelling of the name.' })));
      return;
    }
    for (const p of list) box.append(card(p));
  }

  function card(p) {
    const d = describe(p);
    const c = p.checkout;
    let chip;
    if (c) chip = el('span', { class: 'chip gone', text: 'Left ' + fmtTime(c.at) });
    else if (p.present_at) chip = el('span', { class: 'chip here', text: 'Here since ' + fmtTime(p.present_at) });
    else chip = el('span', { class: 'chip notyet', text: 'Not marked arrived' });

    const node = el('div', { class: 'card' + (c ? ' left' : '') },
      el('div', { class: 'row' },
        el('div', null, el('div', { class: 'name', text: p.name }), d.sub ? el('div', { class: 'sub', text: d.sub }) : null),
        chip),
      d.phones.length ? el('div', { class: 'phones' }, ...d.phones.map((x) => el('span', { text: '☎ ' + x }))) : null);

    if (c) {
      node.append(el('div', { class: 'leftinfo', text: 'Left at ' + fmtTime(c.at) + ' with ' + pickupText(c) + (c.pickup_phone ? ', ' + c.pickup_phone : '') + (c.recorded_by ? '. Recorded by ' + c.recorded_by : '') + (c.note ? '. Note: ' + c.note : '') }));
    }

    const more = el('details', { class: 'more' }, el('summary', { text: 'All details ▾' }),
      el('dl', null, ...d.info.flatMap(([l, v]) => [el('dt', { text: l }), el('dd', { text: v })])));

    const actions = el('div', { class: 'actions' });
    if (!c) actions.append(el('button', { class: 'btn btn-primary', type: 'button', text: 'Check out', onclick: () => openForm(node, p, d, actions) }));
    else if (canUndo(c.at)) actions.append(el('button', { class: 'btn btn-ghost', type: 'button', text: 'Undo check-out', onclick: () => undo(c.id, p.name) }));
    node.append(actions, more);
    return node;
  }

  function openForm(node, p, d, actions) {
    document.querySelectorAll('.co').forEach((f) => f.remove());
    document.querySelectorAll('.actions').forEach((a) => a.classList.remove('hidden'));
    actions.classList.add('hidden');

    let type = 'parent';
    const RELS = { parent: ['Father', 'Mother', 'Guardian'], other: ['Uncle', 'Aunt', 'Grandparent', 'Brother / Sister', 'Driver', 'Family friend'] };
    const nameIn = el('input', { type: 'text', maxlength: 120, autocomplete: 'off' });
    const relIn = el('input', { type: 'text', maxlength: 60, autocomplete: 'off', placeholder: 'or type' });
    const phoneIn = el('input', { type: 'tel', maxlength: 40, autocomplete: 'off', inputmode: 'tel' });
    const noteIn = el('input', { type: 'text', maxlength: 300, autocomplete: 'off', placeholder: 'Optional, e.g. ID checked, mother called ahead' });
    const relChips = el('div', { class: 'chips' });
    const err = el('div', { class: 'error hidden' });
    const nameLabel = el('span', { text: "Parent's name" });
    const btnParent = el('button', { type: 'button', 'aria-pressed': 'true', text: 'Parent' });
    const btnOther = el('button', { type: 'button', 'aria-pressed': 'false', text: 'Someone else' });

    function drawChips() {
      relChips.replaceChildren(...RELS[type].map((r) =>
        el('button', { type: 'button', 'aria-pressed': String(relIn.value === r), text: r, onclick: () => { relIn.value = relIn.value === r ? '' : r; drawChips(); } })));
    }
    relIn.addEventListener('input', drawChips);
    function setType(t) {
      type = t;
      btnParent.setAttribute('aria-pressed', String(t === 'parent'));
      btnOther.setAttribute('aria-pressed', String(t === 'other'));
      nameLabel.textContent = t === 'parent' ? "Parent's name" : 'Name of person picking up *';
      if (t === 'parent') { nameIn.value = d.parentName; phoneIn.value = d.parentPhone; }
      else { nameIn.value = ''; phoneIn.value = ''; }
      relIn.value = '';
      drawChips();
      (t === 'other' ? nameIn : relIn).focus();
    }
    btnParent.onclick = () => setType('parent');
    btnOther.onclick = () => setType('other');

    const confirmBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Confirm ' + p.name + ' left' });
    const form = el('form', { class: 'co', autocomplete: 'off' },
      el('div', { class: 'title', text: 'Who is picking up?' }),
      el('div', { class: 'seg' }, btnParent, btnOther),
      !p.present_at ? el('div', { class: 'warn', text: 'This student was never marked as arrived. You can still record the check-out.' }) : null,
      el('label', { class: 'field' }, nameLabel, nameIn),
      el('div', { class: 'field' }, el('span', { class: 'field', text: 'Relation' }), relChips, relIn),
      el('div', { class: 'two' },
        el('label', { class: 'field' }, el('span', { text: 'Their phone' }), phoneIn),
        el('label', { class: 'field' }, el('span', { text: 'Note' }), noteIn)),
      err,
      el('div', { class: 'actions' }, confirmBtn,
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => { form.remove(); actions.classList.remove('hidden'); } })));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      if (type === 'other' && !nameIn.value.trim()) {
        err.textContent = 'Enter the name of the person picking up.';
        err.classList.remove('hidden');
        nameIn.focus();
        return;
      }
      confirmBtn.disabled = true;
      try {
        const r = await rpc('checkout_record', {
          p_code: ses.code, p_recorded_by: ses.name,
          p_source: p.source, p_source_id: p.source_id, p_member_idx: p.member_idx, p_student_name: p.name,
          p_pickup_type: type, p_pickup_name: nameIn.value, p_pickup_relation: relIn.value,
          p_pickup_phone: phoneIn.value, p_note: noteIn.value,
        });
        if (r.status === 'already') {
          toast(p.name + ' was already checked out at ' + fmtTime(r.at) + (r.recorded_by ? ' by ' + r.recorded_by : ''), false);
          search($('q').value);
          return;
        }
        toast(p.name + ' checked out', true, () => undo(r.id, p.name));
        loadSummary();
        // keep the search so siblings with the same number stay on screen
        search($('q').value);
      } catch (ex) {
        if (handleAuthError(ex)) return;
        err.textContent = friendly(ex);
        err.classList.remove('hidden');
        confirmBtn.disabled = false;
      }
    });

    node.insertBefore(form, node.querySelector('details'));
    setType('parent');
    relIn.blur();
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- admin report ----------
  $('reportBtn').addEventListener('click', async () => {
    try {
      const rows = await rpc('checkout_report', { p_code: ses.code });
      const header = ['Student', 'Status', 'Came via', 'Arrived', 'Left', 'Picked up by', 'Pickup name', 'Relation', 'Pickup phone', 'Note', 'Recorded by', 'Details'];
      const body = rows.map((r) => [
        r.name, r.left_at ? 'Left' : 'Still here', r.from, fmtDateTime(r.arrived_at), fmtDateTime(r.left_at),
        r.left_at ? (r.pickup_type === 'parent' ? 'Parent' : 'Someone else') : '', r.pickup_name || '', r.pickup_relation || '',
        r.pickup_phone || '', r.note || '', r.recorded_by || '',
        (r.info || []).map(([l, v]) => l + ': ' + v).join('; '),
      ]);
      const ws = XLSX.utils.aoa_to_sheet([header, ...body]); // every cell stays text: phone numbers keep their leading 0
      ws['!cols'] = header.map((h) => ({ wch: h === 'Details' ? 60 : 18 }));
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Check-out');
      XLSX.writeFile(wb, 'checkout-report-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    } catch (err) {
      if (!handleAuthError(err)) toast((err.message || '').includes('admin_only') ? 'Log in with the admin code to download the report.' : friendly(err), false);
    }
  });

  // ---------- online state ----------
  function net() { $('offline').classList.toggle('hidden', navigator.onLine); }
  window.addEventListener('online', () => { net(); loadSummary(); });
  window.addEventListener('offline', net);
  net();

  // ---------- start ----------
  if (!cfg) { show('setup'); $('setupUrl').focus(); }
  else if (ses && ses.code) { enterApp(); }
  else { show('login'); $('loginName').focus(); }
})();

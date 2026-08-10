/* ============================================================
   Household Budget Tracker
   Vanilla JS + Supabase. No build step required.
   ============================================================ */

const { createClient } = supabase;
const CONFIG_OK = window.SUPABASE_URL && window.SUPABASE_ANON_KEY &&
  !window.SUPABASE_URL.includes('PASTE_YOUR') && !window.SUPABASE_ANON_KEY.includes('PASTE_YOUR');
let db = null;
let dbInitError = null;
if (CONFIG_OK) {
  try { db = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY); }
  catch (e) { db = null; dbInitError = e.message || String(e); }
}

const PESO = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let state = {
  cards: [],
  periods: [],
  transactions: [],
  installments: [],
  incomeItems: [],
  justineMonths: [],
  justineBills: [],
  profile: 'joven',       // 'joven' or 'justine'
  view: 'summary',
  txnPeriodId: null,
  installCardId: null,
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('active');
  setTimeout(() => t.classList.remove('active'), 2200);
}

/* ---------------- AUTH ---------------- */

async function initAuth() {
  if (!db) {
    if (!CONFIG_OK) {
      $('#login-screen').innerHTML = `
        <div class="eyebrow" style="color:var(--red)">Setup needed</div>
        <h1>config.js isn't filled in</h1>
        <p style="color:var(--text-dim);max-width:360px;font-size:13px;">
          Open <code>config.js</code> in your GitHub repo and make sure
          SUPABASE_URL and SUPABASE_ANON_KEY are your real Supabase values
          (not the placeholder text), then refresh this page.
        </p>`;
    } else {
      $('#login-screen').innerHTML = `
        <div class="eyebrow" style="color:var(--red)">Couldn't start the database client</div>
        <h1>Something's off with config.js</h1>
        <p style="color:var(--text-dim);max-width:360px;font-size:13px;">${escapeHtml(dbInitError || 'Unknown error')}</p>
        <p style="color:var(--text-dim);max-width:360px;font-size:12px;">
          config.js has values, but creating the connection failed. This is
          usually a malformed URL. Double-check there's no trailing slash,
          extra spaces, or stray characters around the URL/key in config.js.
        </p>`;
    }
    return;
  }
  try {
    const { data, error } = await db.from('app_settings').select('*').eq('key', 'password_hash').maybeSingle();
    if (error) throw error;
    if (!data) {
      renderSetupPassword();
    } else if (localStorage.getItem('budget_unlocked') === 'true') {
      enterApp();
    } else {
      renderLogin();
    }
  } catch (e) {
    $('#login-screen').innerHTML = `
      <div class="eyebrow" style="color:var(--red)">Connection problem</div>
      <h1>Can't reach the database</h1>
      <p style="color:var(--text-dim);max-width:360px;font-size:13px;">${escapeHtml(e.message || String(e))}</p>
      <p style="color:var(--text-dim);max-width:360px;font-size:12px;">
        Common causes: the Supabase URL/key in config.js is wrong, the SQL
        schema was never run, or the Supabase project is paused.
      </p>`;
  }
}

function renderSetupPassword() {
  $('#login-screen').innerHTML = `
    <div class="eyebrow">First-time setup</div>
    <h1>Create your shared password</h1>
    <p style="color:var(--text-dim);font-size:13px;max-width:320px;">This is the one password you and your wife will both use to open the tracker.</p>
    <form id="login-form">
      <input type="password" id="pw1" placeholder="New password" minlength="4" required />
      <button type="submit">Save & Enter</button>
    </form>
    <div id="login-error"></div>
  `;
  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    const pw = $('#pw1').value;
    const hash = await sha256(pw);
    const { error } = await db.from('app_settings').insert({ key: 'password_hash', value: hash });
    if (error) { $('#login-error').textContent = error.message; return; }
    localStorage.setItem('budget_unlocked', 'true');
    enterApp();
  };
}

function renderLogin() {
  $('#login-screen').innerHTML = `
    <div class="eyebrow">Private household budget</div>
    <h1>Enter password</h1>
    <form id="login-form">
      <input type="password" id="pw" placeholder="Password" required autofocus />
      <button type="submit">Unlock</button>
    </form>
    <div id="login-error"></div>
  `;
  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    const pw = $('#pw').value;
    const hash = await sha256(pw);
    const { data } = await db.from('app_settings').select('*').eq('key', 'password_hash').maybeSingle();
    if (data && data.value === hash) {
      localStorage.setItem('budget_unlocked', 'true');
      enterApp();
    } else {
      $('#login-error').textContent = 'Wrong password. Try again.';
    }
  };
}

function logout() {
  localStorage.removeItem('budget_unlocked');
  location.reload();
}

/* ---------------- BOOTSTRAP ---------------- */

async function enterApp() {
  $('#login-screen').style.display = 'none';
  $('#app').classList.add('active');
  await loadAll();
  renderSidebar();
  renderView();
}

async function loadAll() {
  const [cards, periods, transactions, installments, incomeItems, justineMonths, justineBills] = await Promise.all([
    db.from('credit_cards').select('*').order('sort_order'),
    db.from('periods').select('*').order('period_date', { ascending: true }),
    db.from('transactions').select('*'),
    db.from('installments').select('*'),
    db.from('income_items').select('*'),
    db.from('justine_months').select('*').order('month_date', { ascending: false }),
    db.from('justine_bills').select('*'),
  ]);
  state.cards = cards.data || [];
  state.periods = periods.data || [];
  state.transactions = transactions.data || [];
  state.installments = (installments.data || []).map(i => ({ ...i, owner: i.owner || 'joven' }));
  state.incomeItems = incomeItems.data || [];
  state.justineMonths = justineMonths.data || [];
  state.justineBills = justineBills.data || [];
}

/* ---------------- SIDEBAR / NAV ---------------- */

function renderSidebar() {
  const jovenNav = `
    <button class="nav-btn" data-view="summary">Summary</button>
    <button class="nav-btn" data-view="transactions">Transactions</button>
    <button class="nav-btn" data-view="installments">Installments</button>
    <button class="nav-btn" data-view="settings">Cards & Settings</button>
  `;
  const justineNav = `
    <button class="nav-btn" data-view="summary">Summary</button>
    <button class="nav-btn" data-view="installments">Installments</button>
  `;
  $('#sidebar').innerHTML = `
    <div class="brand"><span class="dot"></span> Household Budget</div>
    <div class="profile-switch" id="profile-switch">
      <button data-profile="joven" class="${state.profile === 'joven' ? 'active' : ''}"><span class="avatar">J</span>Joven</button>
      <button data-profile="justine" class="${state.profile === 'justine' ? 'active' : ''}"><span class="avatar">J</span>Justine</button>
    </div>
    ${state.profile === 'joven' ? jovenNav : justineNav}
    <div class="footer"><button class="btn secondary" id="logout-btn">Log out</button></div>
  `;
  $$('#profile-switch button').forEach(b => b.onclick = () => {
    state.profile = b.dataset.profile;
    state.view = 'summary';
    renderSidebar();
    renderView();
  });
  $$('.nav-btn').forEach(b => b.onclick = () => { state.view = b.dataset.view; renderView(); });
  $('#logout-btn').onclick = logout;
}

function renderView() {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  if (state.profile === 'justine') {
    if (state.view === 'summary') renderJustineSummary();
    else if (state.view === 'installments') renderInstallments();
    else renderJustineSummary();
    return;
  }
  if (state.view === 'summary') renderSummary();
  else if (state.view === 'transactions') renderTransactions();
  else if (state.view === 'installments') renderInstallments();
  else if (state.view === 'settings') renderSettings();
}

/* ---------------- helpers: computed numbers ---------------- */

function cardTotalForPeriod(cardId, periodId) {
  return state.transactions
    .filter(t => t.card_id === cardId && t.period_id === periodId)
    .reduce((s, t) => s + Number(t.amount), 0);
}

function incomeItemsForPeriod(periodId) {
  return state.incomeItems.filter(i => i.period_id === periodId);
}

function wifeyTotalForPeriod(periodId) {
  return state.transactions
    .filter(t => t.period_id === periodId && t.owner === 'wifey')
    .reduce((s, t) => s + Number(t.amount), 0);
}

function periodTotals(period) {
  const cardTotal = state.cards.reduce((s, c) => s + cardTotalForPeriod(c.id, period.id), 0);
  const wifeyAmount = wifeyTotalForPeriod(period.id);
  const extraIncome = incomeItemsForPeriod(period.id).reduce((s, i) => s + Number(i.amount), 0);
  const income = Number(period.salary) + Number(period.previous_savings) + wifeyAmount + extraIncome;
  const outflow = Number(period.accent) + Number(period.spaylater) + cardTotal;
  const savings = income - outflow;
  return { cardTotal, income, outflow, savings, extraIncome, wifeyAmount };
}

/* ---------------- SUMMARY VIEW ---------------- */

function renderSummary() {
  const main = $('#main');
  const periods = state.periods;
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div><h2>Summary</h2><div class="subtitle">Income, outflow & savings per pay period</div></div>
      <button class="btn" id="add-period-btn">+ New period</button>
    </div>
    <div class="period-grid" id="period-grid"></div>
  `;
  $('#add-period-btn').onclick = () => openPeriodModal();

  const grid = $('#period-grid');
  if (!periods.length) {
    grid.innerHTML = `<div class="empty-state">No periods yet. Click "New period" to add your first 15th or 30th.</div>`;
    return;
  }
  periods.forEach(p => {
    const t = periodTotals(p);
    const el = document.createElement('div');
    el.className = 'period-card';
    el.innerHTML = `
      <div class="ph">
        <div>
          <span class="tag">${p.period_type}</span>
          <div class="date">${new Date(p.period_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <div>
          <button class="icon-btn edit" data-edit="${p.id}" title="Edit">✎</button>
          <button class="icon-btn" data-del="${p.id}" title="Delete">✕</button>
        </div>
      </div>
      <div class="line"><span class="lbl">Salary</span><span class="val">${PESO(p.salary)}</span></div>
      <div class="line"><span class="lbl">Previous savings</span><span class="val">${PESO(p.previous_savings)}</span></div>
      <div class="line"><span class="lbl">Wifey <span class="synced-badge" title="Sum of transactions tagged Wifey across all cards this period">⇄ from transactions</span></span><span class="val">${PESO(t.wifeyAmount)}</span></div>
      ${incomeItemsForPeriod(p.id).map(item => `
        <div class="line">
          <span class="lbl">${escapeHtml(item.label)}
            <button class="icon-btn edit" data-edit-income="${item.id}" style="width:20px;height:20px;font-size:10px;margin-left:4px;">✎</button>
            <button class="icon-btn" data-del-income="${item.id}" style="width:20px;height:20px;font-size:10px;">✕</button>
          </span>
          <span class="val">${PESO(item.amount)}</span>
        </div>`).join('')}
      <div class="line"><span class="lbl"><button class="icon-btn" data-add-income="${p.id}" style="width:auto;padding:2px 8px;font-size:11px;color:var(--gold);border-color:var(--gold);">+ income line</button></span><span class="val"></span></div>
      <div class="line"><span class="lbl">Accent (car)</span><span class="val">${PESO(p.accent)}</span></div>
      ${Number(p.spaylater) ? `<div class="line"><span class="lbl">Spaylater</span><span class="val">${PESO(p.spaylater)}</span></div>` : ''}
      ${state.cards.map(c => {
        const amt = cardTotalForPeriod(c.id, p.id);
        if (!amt) return '';
        return `<div class="line"><span class="lbl card-chip"><span class="sw" style="background:${c.color}"></span>${c.name}</span><span class="val">${PESO(amt)}</span></div>`;
      }).join('')}
      <div class="line outflow total"><span class="lbl">Total outflow</span><span class="val">${PESO(t.outflow)}</span></div>
      <div class="line savings total"><span class="lbl">Savings</span><span class="val">${PESO(t.savings)}</span></div>
    `;
    grid.appendChild(el);
  });
  $$('[data-edit]').forEach(b => b.onclick = () => openPeriodModal(periods.find(p => p.id === b.dataset.edit)));
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this period and all its transactions?')) return;
    await db.from('periods').delete().eq('id', b.dataset.del);
    await loadAll(); renderView();
  });
  $$('[data-add-income]').forEach(b => b.onclick = () => openIncomeItemModal(null, b.dataset.addIncome));
  $$('[data-edit-income]').forEach(b => b.onclick = () => {
    const item = state.incomeItems.find(x => x.id === b.dataset.editIncome);
    openIncomeItemModal(item, item.period_id);
  });
  $$('[data-del-income]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this income line?')) return;
    await db.from('income_items').delete().eq('id', b.dataset.delIncome);
    await loadAll(); renderView();
  });
}

function openIncomeItemModal(item, periodId) {
  const isEdit = !!item;
  const i = item || { label: '', amount: '' };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} income line</h3>
    <div class="field-row">
      <div class="field"><label>Label</label><input type="text" id="f-label" value="${i.label ? escapeHtml(i.label) : ''}" placeholder="e.g. Part Time, JP, Bonus"></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="f-amount" value="${i.amount}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = { label: $('#f-label').value.trim(), amount: +$('#f-amount').value || 0, period_id: periodId };
    if (!payload.label) { toast('Add a label'); return; }
    let error;
    if (isEdit) ({ error } = await db.from('income_items').update(payload).eq('id', i.id));
    else ({ error } = await db.from('income_items').insert(payload));
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

function openPeriodModal(period) {
  const isEdit = !!period;
  const p = period || { period_date: '', period_type: '15th', salary: 0, previous_savings: 0, wifey: 0, spaylater: 0, accent: 0 };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} period</h3>
    <div class="field-row">
      <div class="field"><label>Date</label><input type="date" id="f-date" value="${p.period_date}"></div>
      <div class="field"><label>Type</label>
        <select id="f-type">
          <option value="15th" ${p.period_type === '15th' ? 'selected' : ''}>15th</option>
          <option value="30th" ${p.period_type === '30th' ? 'selected' : ''}>30th</option>
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Salary</label><input type="number" step="0.01" id="f-salary" value="${p.salary}"></div>
      <div class="field"><label>Previous savings</label><input type="number" step="0.01" id="f-prev" value="${p.previous_savings}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Spaylater</label><input type="number" step="0.01" id="f-spay" value="${p.spaylater}"></div>
      <div class="field"><label>Accent (car amort)</label><input type="number" step="0.01" id="f-accent" value="${p.accent}"></div>
    </div>
    <p style="font-size:12px;color:var(--text-dim);">Wifey isn't entered here anymore — tag her transactions as "Wifey's" on the Transactions tab and it totals up automatically.</p>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = {
      period_date: $('#f-date').value,
      period_type: $('#f-type').value,
      salary: +$('#f-salary').value || 0,
      previous_savings: +$('#f-prev').value || 0,
      spaylater: +$('#f-spay').value || 0,
      accent: +$('#f-accent').value || 0,
    };
    if (!payload.period_date) { toast('Pick a date'); return; }
    let error;
    if (isEdit) ({ error } = await db.from('periods').update(payload).eq('id', p.id));
    else ({ error } = await db.from('periods').insert(payload));
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

/* ---------------- TRANSACTIONS VIEW ---------------- */

function renderTransactions() {
  const main = $('#main');
  if (!state.periods.length) {
    main.innerHTML = `<h2>Transactions</h2><div class="empty-state">Add a period first (Summary tab), then come back here.</div>`;
    return;
  }
  if (!state.txnPeriodId || !state.periods.find(p => p.id === state.txnPeriodId)) {
    state.txnPeriodId = state.periods[0].id;
  }
  const period = state.periods.find(p => p.id === state.txnPeriodId);

  main.innerHTML = `
    <h2>Transactions</h2>
    <div class="subtitle">Every charge, grouped by credit card. Statement totals on the Summary tab are calculated from this list.</div>
    <div class="field-row" style="max-width:320px;margin-bottom:18px;">
      <div class="field"><label>Period</label>
        <select id="period-select">
          ${state.periods.map(p => `<option value="${p.id}" ${p.id === state.txnPeriodId ? 'selected' : ''}>${p.period_type} — ${new Date(p.period_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="card-sections"></div>
  `;
  $('#period-select').onchange = e => { state.txnPeriodId = e.target.value; renderTransactions(); };

  const wrap = $('#card-sections');
  if (!state.cards.length) {
    wrap.innerHTML = `<div class="empty-state">No credit cards yet — add one in Cards & Settings.</div>`;
    return;
  }
  state.cards.filter(c => !c.archived).forEach(card => {
    const rows = state.transactions.filter(t => t.card_id === card.id && t.period_id === period.id);
    const total = rows.reduce((s, t) => s + Number(t.amount), 0);
    const sec = document.createElement('div');
    sec.className = 'section-card';
    sec.innerHTML = `
      <div class="sh">
        <h3><span class="card-chip"><span class="sw" style="background:${card.color}"></span>${card.name}</span></h3>
        <div style="display:flex;align-items:center;gap:14px;">
          <span class="total">${PESO(total)}</span>
          <button class="btn secondary" data-add="${card.id}" style="padding:6px 12px;font-size:13px;">+ Add</button>
        </div>
      </div>
      ${rows.length ? `<table>
        <thead><tr><th>Description</th><th>Type</th><th>Whose</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>
          ${rows.map(t => `
            <tr>
              <td>${escapeHtml(t.description)}</td>
              <td><span class="pill ${t.kind}">${t.kind === 'bill' ? 'Bill' : 'Payment plan'}</span></td>
              <td>${t.owner === 'wifey' ? '<span class="pill" style="background:rgba(167,139,250,.15);color:var(--purple);">Wifey</span>' : '<span style="color:var(--text-dim);font-size:12px;">Joven</span>'}</td>
              <td class="num">${PESO(t.amount)}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="icon-btn edit" data-edit-txn="${t.id}">✎</button>
                <button class="icon-btn" data-del-txn="${t.id}">✕</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>` : `<div class="empty-state">No transactions yet for this card in this period.</div>`}
    `;
    wrap.appendChild(sec);
  });

  $$('[data-add]').forEach(b => b.onclick = () => openTxnModal(null, b.dataset.add, period.id));
  $$('[data-edit-txn]').forEach(b => b.onclick = () => {
    const t = state.transactions.find(x => x.id === b.dataset.editTxn);
    openTxnModal(t, t.card_id, t.period_id);
  });
  $$('[data-del-txn]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this transaction?')) return;
    await db.from('transactions').delete().eq('id', b.dataset.delTxn);
    await loadAll(); renderView();
  });
}

function openTxnModal(txn, cardId, periodId) {
  const isEdit = !!txn;
  const t = txn || { description: '', amount: '', kind: 'bill', owner: 'joven' };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} transaction</h3>
    <div class="field-row">
      <div class="field"><label>Description</label><input type="text" id="f-desc" value="${t.description ? escapeHtml(t.description) : ''}" placeholder="e.g. Watsons"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="f-amt" value="${t.amount}"></div>
      <div class="field"><label>Type</label>
        <select id="f-kind">
          <option value="bill" ${t.kind === 'bill' ? 'selected' : ''}>Bill (red)</option>
          <option value="payment_plan" ${t.kind === 'payment_plan' ? 'selected' : ''}>Payment plan (green)</option>
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Whose spending</label>
        <select id="f-owner">
          <option value="joven" ${t.owner === 'joven' ? 'selected' : ''}>Joven's</option>
          <option value="wifey" ${t.owner === 'wifey' ? 'selected' : ''}>Wifey's (adds to her total, owed back to you)</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = {
      description: $('#f-desc').value.trim(),
      amount: +$('#f-amt').value || 0,
      kind: $('#f-kind').value,
      owner: $('#f-owner').value,
      card_id: cardId,
      period_id: periodId,
    };
    if (!payload.description) { toast('Add a description'); return; }
    let error;
    if (isEdit) ({ error } = await db.from('transactions').update(payload).eq('id', t.id));
    else ({ error } = await db.from('transactions').insert(payload));
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

/* ---------------- INSTALLMENTS VIEW ---------------- */

function monthsElapsed(startDate) {
  const start = new Date(startDate + 'T00:00:00');
  const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
}
function endDate(startDate, numMonths) {
  const d = new Date(startDate + 'T00:00:00');
  d.setMonth(d.getMonth() + numMonths - 1);
  return d;
}

function renderInstallments() {
  const main = $('#main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div><h2>Installments</h2><div class="subtitle">Payment plans and when each one finishes</div></div>
      <button class="btn" id="add-install-btn">+ New installment</button>
    </div>
    <div class="card-select-tabs" id="install-tabs"></div>
    <div class="install-grid" id="install-grid"></div>
  `;
  $('#add-install-btn').onclick = () => openInstallModal();

  const tabs = $('#install-tabs');
  tabs.innerHTML = `<button data-c="all" class="${!state.installCardId ? 'active' : ''}" style="${!state.installCardId ? 'background:var(--gold);color:#1a1200;' : ''}">All cards</button>` +
    state.cards.map(c => `<button data-c="${c.id}" class="${state.installCardId === c.id ? 'active' : ''}" style="${state.installCardId === c.id ? `background:${c.color};color:#fff;` : ''}">${c.name}</button>`).join('');
  $$('#install-tabs button').forEach(b => b.onclick = () => { state.installCardId = b.dataset.c === 'all' ? null : b.dataset.c; renderInstallments(); });

  const grid = $('#install-grid');
  let list = state.installments.filter(i => !i.archived && i.owner === state.profile);
  if (state.installCardId) list = list.filter(i => i.card_id === state.installCardId);
  if (!list.length) { grid.innerHTML = `<div class="empty-state">No installments here yet.</div>`; return; }

  list.forEach(i => {
    const card = state.cards.find(c => c.id === i.card_id);
    const elapsed = Math.min(Math.max(monthsElapsed(i.start_date), 0), i.num_months);
    const pct = Math.round((elapsed / i.num_months) * 100);
    const done = elapsed >= i.num_months;
    const end = endDate(i.start_date, i.num_months);
    const el = document.createElement('div');
    el.className = 'install-item' + (done ? ' done' : '');
    el.innerHTML = `
      <div class="name">${escapeHtml(i.name)}</div>
      <div class="meta card-chip"><span class="sw" style="background:${card ? card.color : '#888'}"></span>${card ? card.name : 'Unknown'} • ${PESO(i.monthly_amount)}/mo</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${done ? 'var(--green)' : 'var(--gold)'}"></div></div>
      <div class="foot">
        <span>${done ? 'Completed' : `Month ${elapsed} of ${i.num_months}`}</span>
        <span class="end">${done ? '✓ Paid off' : 'ends ' + end.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}</span>
      </div>
      <div style="margin-top:10px;text-align:right;">
        <button class="icon-btn edit" data-edit-i="${i.id}">✎</button>
        <button class="icon-btn" data-del-i="${i.id}">✕</button>
      </div>
    `;
    grid.appendChild(el);
  });
  $$('[data-edit-i]').forEach(b => b.onclick = () => openInstallModal(state.installments.find(x => x.id === b.dataset.editI)));
  $$('[data-del-i]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this installment plan?')) return;
    await db.from('installments').delete().eq('id', b.dataset.delI);
    await loadAll(); renderView();
  });
}

function openInstallModal(item) {
  const isEdit = !!item;
  const i = item || { card_id: state.cards[0]?.id || '', name: '', principal: '', fee: 0, monthly_amount: '', start_date: '', num_months: 12, payer: '' };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} installment</h3>
    <div class="field-row">
      <div class="field"><label>Card</label>
        <select id="f-card">${state.cards.map(c => `<option value="${c.id}" ${c.id === i.card_id ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Name</label><input type="text" id="f-name" value="${i.name ? escapeHtml(i.name) : ''}" placeholder="e.g. Tanie Tablet"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Principal</label><input type="number" step="0.01" id="f-principal" value="${i.principal}"></div>
      <div class="field"><label>Fee</label><input type="number" step="0.01" id="f-fee" value="${i.fee}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Monthly amount</label><input type="number" step="0.01" id="f-monthly" value="${i.monthly_amount}"></div>
      <div class="field"><label># of months</label><input type="number" id="f-months" value="${i.num_months}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Start date</label><input type="date" id="f-start" value="${i.start_date}"></div>
      <div class="field"><label>Payer / note</label><input type="text" id="f-payer" value="${i.payer ? escapeHtml(i.payer) : ''}" placeholder="e.g. Justine"></div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = {
      card_id: $('#f-card').value,
      name: $('#f-name').value.trim(),
      principal: +$('#f-principal').value || null,
      fee: +$('#f-fee').value || 0,
      monthly_amount: +$('#f-monthly').value || 0,
      num_months: +$('#f-months').value || 1,
      start_date: $('#f-start').value,
      payer: $('#f-payer').value.trim(),
    };
    if (!payload.name || !payload.start_date) { toast('Fill in name and start date'); return; }
    let error;
    if (isEdit) ({ error } = await db.from('installments').update(payload).eq('id', i.id));
    else ({ error } = await db.from('installments').insert({ ...payload, owner: state.profile }));
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

/* ---------------- SETTINGS VIEW ---------------- */

function renderSettings() {
  const main = $('#main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div><h2>Cards & Settings</h2><div class="subtitle">Manage your credit cards and shared password</div></div>
      <button class="btn" id="add-card-btn">+ Add card</button>
    </div>
    <div class="section-card">
      <table>
        <thead><tr><th>Card</th><th>Statement day</th><th></th><th></th></tr></thead>
        <tbody>
          ${state.cards.map(c => `
            <tr>
              <td><span class="card-chip"><span class="sw" style="background:${c.color}"></span>${c.name}</span>${c.archived ? ' <span style="color:var(--text-dim)">(archived)</span>' : ''}</td>
              <td>${c.statement_day || '—'}</td>
              <td style="text-align:right;">
                <button class="icon-btn edit" data-edit-c="${c.id}">✎</button>
                <button class="icon-btn" data-del-c="${c.id}">✕</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="section-card" style="max-width:420px;">
      <h3 style="font-family:'Space Grotesk',sans-serif;margin-top:0;">Change shared password</h3>
      <div class="field-row">
        <div class="field"><label>New password</label><input type="password" id="new-pw" placeholder="New password"></div>
      </div>
      <button class="btn" id="change-pw-btn">Update password</button>
    </div>
  `;
  $('#add-card-btn').onclick = () => openCardModal();
  $$('[data-edit-c]').forEach(b => b.onclick = () => openCardModal(state.cards.find(c => c.id === b.dataset.editC)));
  $$('[data-del-c]').forEach(b => b.onclick = async () => {
    if (!confirm('This will also delete this card\'s transactions and installments. Continue?')) return;
    await db.from('credit_cards').delete().eq('id', b.dataset.delC);
    await loadAll(); renderView();
  });
  $('#change-pw-btn').onclick = async () => {
    const pw = $('#new-pw').value;
    if (pw.length < 4) { toast('Password too short'); return; }
    const hash = await sha256(pw);
    await db.from('app_settings').update({ value: hash }).eq('key', 'password_hash');
    toast('Password updated');
    $('#new-pw').value = '';
  };
}

function openCardModal(card) {
  const isEdit = !!card;
  const c = card || { name: '', color: '#5b9df9', statement_day: '', sort_order: state.cards.length + 1 };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} card</h3>
    <div class="field-row">
      <div class="field"><label>Name</label><input type="text" id="f-name" value="${c.name ? escapeHtml(c.name) : ''}"></div>
      <div class="field"><label>Color</label><input type="color" id="f-color" value="${c.color}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Statement day (optional)</label><input type="text" id="f-sd" value="${c.statement_day || ''}" placeholder="e.g. 27th"></div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = { name: $('#f-name').value.trim(), color: $('#f-color').value, statement_day: $('#f-sd').value.trim() };
    if (!payload.name) { toast('Name required'); return; }
    let error;
    if (isEdit) ({ error } = await db.from('credit_cards').update(payload).eq('id', c.id));
    else ({ error } = await db.from('credit_cards').insert({ ...payload, sort_order: c.sort_order }));
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

/* ---------------- JUSTINE'S BUDGET (monthly, simpler) ---------------- */

function monthKey(dateStr) { return dateStr.slice(0, 7); } // "2026-08"

function jovenAccentForMonth(monthDate) {
  // Pulls "Accent" from Joven's 15th and 30th periods in the same calendar month
  const mk = monthKey(monthDate);
  const p15 = state.periods.find(p => p.period_type === '15th' && monthKey(p.period_date) === mk);
  const p30 = state.periods.find(p => p.period_type === '30th' && monthKey(p.period_date) === mk);
  return { kuya15: p15 ? Number(p15.accent) : 0, kuya30: p30 ? Number(p30.accent) : 0, hasP15: !!p15, hasP30: !!p30 };
}

function justineBillsForMonth(monthId) {
  return state.justineBills.filter(b => b.month_id === monthId);
}

function justineTotals(m) {
  const { kuya15, kuya30 } = jovenAccentForMonth(m.month_date);
  const billsTotal = justineBillsForMonth(m.id).reduce((s, b) => s + Number(b.amount), 0);
  const payablesTotal = Number(m.bpi_total) + Number(m.eastwest_total) + billsTotal + kuya15 + kuya30;
  const totalOutflow = Number(m.joven_cc_total) + payablesTotal;
  const savings = Number(m.paycheck_budget) - totalOutflow;
  return { kuya15, kuya30, billsTotal, payablesTotal, totalOutflow, savings };
}

function renderJustineSummary() {
  const main = $('#main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div><h2>Justine's Budget</h2><div class="subtitle">Monthly paycheck budget & payables</div></div>
      <button class="btn" id="add-month-btn">+ New month</button>
    </div>
    <div class="period-grid" id="month-grid"></div>
  `;
  $('#add-month-btn').onclick = () => openJustineMonthModal();

  const grid = $('#month-grid');
  if (!state.justineMonths.length) {
    grid.innerHTML = `<div class="empty-state">No months yet. Click "New month" to add August.</div>`;
    return;
  }
  state.justineMonths.forEach(m => {
    const t = justineTotals(m);
    const monthLabel = new Date(m.month_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    const acc = jovenAccentForMonth(m.month_date);
    const el = document.createElement('div');
    el.className = 'period-card';
    el.innerHTML = `
      <div class="ph">
        <div><span class="tag">${monthLabel}</span></div>
        <div>
          <button class="icon-btn edit" data-edit-m="${m.id}" title="Edit">✎</button>
          <button class="icon-btn" data-del-m="${m.id}" title="Delete">✕</button>
        </div>
      </div>
      <div class="line"><span class="lbl">15th Paycheck Budget</span><span class="val">${PESO(m.paycheck_budget)}</span></div>
      <div class="line"><span class="lbl">Previous savings</span><span class="val">${PESO(m.previous_savings)}</span></div>
      <div class="line"><span class="lbl">Joven CC Total</span><span class="val">${PESO(m.joven_cc_total)}</span></div>
      <div class="line"><span class="lbl">BPI</span><span class="val">${PESO(m.bpi_total)}</span></div>
      <div class="line"><span class="lbl">Eastwest</span><span class="val">${PESO(m.eastwest_total)}</span></div>
      ${justineBillsForMonth(m.id).map(b => `
        <div class="line">
          <span class="lbl">${escapeHtml(b.label)}
            <button class="icon-btn edit" data-edit-bill="${b.id}" style="width:20px;height:20px;font-size:10px;margin-left:4px;">✎</button>
            <button class="icon-btn" data-del-bill="${b.id}" style="width:20px;height:20px;font-size:10px;">✕</button>
          </span>
          <span class="val">${PESO(b.amount)}</span>
        </div>`).join('')}
      <div class="line"><span class="lbl"><button class="icon-btn" data-add-bill="${m.id}" style="width:auto;padding:2px 8px;font-size:11px;color:var(--gold);border-color:var(--gold);">+ bill</button></span><span class="val"></span></div>
      <div class="line"><span class="lbl">Kuya Edrian 15 <span class="synced-badge" title="Same as Joven's Accent, pulled automatically">⇄ synced</span></span><span class="val">${acc.hasP15 ? PESO(t.kuya15) : '<span style="color:var(--text-dim)">no 15th period yet</span>'}</span></div>
      <div class="line"><span class="lbl">Kuya Edrian 30 <span class="synced-badge" title="Same as Joven's Accent, pulled automatically">⇄ synced</span></span><span class="val">${acc.hasP30 ? PESO(t.kuya30) : '<span style="color:var(--text-dim)">no 30th period yet</span>'}</span></div>
      <div class="line"><span class="lbl">Payables total</span><span class="val">${PESO(t.payablesTotal)}</span></div>
      <div class="line outflow total"><span class="lbl">Total outflow</span><span class="val">${PESO(t.totalOutflow)}</span></div>
      <div class="line savings total"><span class="lbl">Savings</span><span class="val">${PESO(t.savings)}</span></div>
    `;
    grid.appendChild(el);
  });
  $$('[data-edit-m]').forEach(b => b.onclick = () => openJustineMonthModal(state.justineMonths.find(m => m.id === b.dataset.editM)));
  $$('[data-del-m]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this month?')) return;
    await db.from('justine_months').delete().eq('id', b.dataset.delM);
    await loadAll(); renderView();
  });
  $$('[data-add-bill]').forEach(b => b.onclick = () => openJustineBillModal(null, b.dataset.addBill));
  $$('[data-edit-bill]').forEach(b => b.onclick = () => {
    const bill = state.justineBills.find(x => x.id === b.dataset.editBill);
    openJustineBillModal(bill, bill.month_id);
  });
  $$('[data-del-bill]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this bill?')) return;
    await db.from('justine_bills').delete().eq('id', b.dataset.delBill);
    await loadAll(); renderView();
  });
}

function openJustineMonthModal(month) {
  const isEdit = !!month;
  const m = month || { month_date: '', paycheck_budget: 0, previous_savings: 0, joven_cc_total: 0, bpi_total: 0, eastwest_total: 0 };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} month</h3>
    <div class="field-row">
      <div class="field"><label>Month</label><input type="month" id="f-month" value="${m.month_date ? m.month_date.slice(0, 7) : ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>15th Paycheck Budget</label><input type="number" step="0.01" id="f-budget" value="${m.paycheck_budget}"></div>
      <div class="field"><label>Previous savings</label><input type="number" step="0.01" id="f-prev" value="${m.previous_savings}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Joven CC Total</label><input type="number" step="0.01" id="f-joven" value="${m.joven_cc_total}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>BPI</label><input type="number" step="0.01" id="f-bpi" value="${m.bpi_total}"></div>
      <div class="field"><label>Eastwest</label><input type="number" step="0.01" id="f-ew" value="${m.eastwest_total}"></div>
    </div>
    <p style="font-size:12px;color:var(--text-dim);">Kuya Edrian 15/30 aren't entered here — they're pulled automatically from Joven's Accent on his 15th/30th periods for this same month.</p>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const monthVal = $('#f-month').value; // "2026-08"
    if (!monthVal) { toast('Pick a month'); return; }
    const payload = {
      month_date: monthVal + '-01',
      paycheck_budget: +$('#f-budget').value || 0,
      previous_savings: +$('#f-prev').value || 0,
      joven_cc_total: +$('#f-joven').value || 0,
      bpi_total: +$('#f-bpi').value || 0,
      eastwest_total: +$('#f-ew').value || 0,
    };
    let error;
    if (isEdit) ({ error } = await db.from('justine_months').update(payload).eq('id', m.id));
    else ({ error } = await db.from('justine_months').insert(payload));
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

function openJustineBillModal(bill, monthId) {
  const isEdit = !!bill;
  const b = bill || { label: '', amount: '' };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} bill</h3>
    <div class="field-row">
      <div class="field"><label>Label</label><input type="text" id="f-label" value="${b.label ? escapeHtml(b.label) : ''}" placeholder="e.g. Cat Food, PLDT, St. Peter"></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="f-amount" value="${b.amount}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = { label: $('#f-label').value.trim(), amount: +$('#f-amount').value || 0, month_id: monthId };
    if (!payload.label) { toast('Add a label'); return; }
    let error;
    if (isEdit) ({ error } = await db.from('justine_bills').update(payload).eq('id', b.id));
    else ({ error } = await db.from('justine_bills').insert(payload));
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

/* ---------------- MODAL / UTIL ---------------- */

function showModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal-backdrop').classList.add('active');
  $('#modal-cancel').onclick = closeModal;
}
function closeModal() { $('#modal-backdrop').classList.remove('active'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ---------------- INIT ---------------- */
document.addEventListener('DOMContentLoaded', initAuth);

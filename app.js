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
const salaryDisplay = n => state.revealSalary ? PESO(n) : '₱••••••••';
function wireRevealToggles() {
  $$('[data-reveal-toggle]').forEach(b => b.onclick = () => { state.revealSalary = !state.revealSalary; renderView(); });
}

function parseStatementDay(text) {
  if (!text) return null;
  const m = String(text).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}
function hasStatementArrived(card, periodDate) {
  const day = parseStatementDay(card.statement_day);
  if (!day) return false;
  const today = new Date();
  const pd = new Date(periodDate + 'T00:00:00');
  if (pd.getFullYear() !== today.getFullYear() || pd.getMonth() !== today.getMonth()) return false;
  return today.getDate() >= day;
}
function statementBadge(card, periodDate) {
  if (!hasStatementArrived(card, periodDate)) return '';
  return ` <span class="synced-badge" style="color:var(--gold);background:rgba(227,177,88,.15);" title="Statement day (${card.statement_day}) has passed this month">🧾 statement in</span>`;
}
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let state = {
  cards: [],
  periods: [],
  transactions: [],
  installments: [],
  installmentSchedule: [],
  incomeItems: [],
  justineMonths: [],
  justineBills: [],
  wifeyAdjustments: [],
  profile: 'joven',       // 'joven' or 'justine'
  view: 'summary',
  txnPeriodId: null,
  installCardId: null,
  revealSalary: false,
  showArchivedPeriods: false,
  showArchivedMonths: false,
  showArchivedInstallments: false,
  showInstallDashboard: true,
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
  applyProfileTheme();
  renderSidebar();
  renderView();
}

async function loadAll() {
  const [cards, periods, transactions, installments, incomeItems, justineMonths, justineBills, schedule, wifeyAdjustments] = await Promise.all([
    db.from('credit_cards').select('*').order('sort_order'),
    db.from('periods').select('*').order('period_date', { ascending: true }),
    db.from('transactions').select('*'),
    db.from('installments').select('*'),
    db.from('income_items').select('*'),
    db.from('justine_months').select('*').order('month_date', { ascending: false }),
    db.from('justine_bills').select('*'),
    db.from('installment_schedule').select('*').order('due_date', { ascending: true }),
    db.from('wifey_adjustments').select('*'),
  ]);
  state.cards = cards.data || [];
  state.periods = periods.data || [];
  state.transactions = transactions.data || [];
  state.installments = (installments.data || []).map(i => ({ ...i, owner: i.owner || 'joven' }));
  state.incomeItems = incomeItems.data || [];
  state.justineMonths = justineMonths.data || [];
  state.justineBills = justineBills.data || [];
  state.installmentSchedule = schedule.data || [];
  state.wifeyAdjustments = wifeyAdjustments.data || [];
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
    applyProfileTheme();
    renderSidebar();
    renderView();
  });
  $$('.nav-btn').forEach(b => b.onclick = () => { state.view = b.dataset.view; renderView(); closeMobileSidebar(); });
  $('#logout-btn').onclick = logout;
}

function applyProfileTheme() {
  $('#app').classList.toggle('theme-justine', state.profile === 'justine');
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
  const real = state.transactions
    .filter(t => t.card_id === cardId && t.period_id === periodId)
    .reduce((s, t) => s + Number(t.amount), 0);
  const virtual = virtualEntriesForPeriod(periodId)
    .filter(e => e.card_id === cardId)
    .reduce((s, e) => s + e.amount, 0);
  return real + virtual;
}

/* ---- linking Justine's "billed to Joven" installments into Joven's periods ---- */

function periodKeyForDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { mk, type: d.getDate() <= 15 ? '15th' : '30th' };
}
function periodIdForDate(dateStr) {
  const { mk, type } = periodKeyForDate(dateStr);
  const p = state.periods.find(p => monthKey(p.period_date) === mk && p.period_type === type);
  return p ? p.id : null;
}
function scheduleForInstallment(installId) {
  return state.installmentSchedule.filter(s => s.installment_id === installId).sort((a, b) => a.due_date < b.due_date ? -1 : 1);
}
// Always adds the fee (and its share) on top of the row's base amount when
// this is the fee row - computed fresh every time, so it can never go stale
// even if the fee is edited without a full schedule regeneration. The base
// `row.amount` / `row.wifey_share` stay directly editable in "View schedule"
// for plans where the payment isn't the same every period.
function totalAmountForRow(inst, row) {
  return Number(row.amount) + (row.is_fee_row ? Number(inst.fee || 0) : 0);
}
function totalWifeyShareForRow(inst, row) {
  return Number(row.wifey_share || 0) + (row.is_fee_row ? Number(inst.wifey_fee_share || 0) : 0);
}

// Joven's own installments surface automatically as a pinned, read-only
// "payment plan" row on the matching card + period, sourced live from the
// schedule - no manual re-entry needed. (Justine's installments are kept
// fully separate from his tracker - see her tab.)
function virtualEntriesForPeriod(periodId) {
  const entries = [];
  state.installments.filter(i => !i.archived && i.owner === 'joven').forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      if (periodIdForDate(row.due_date) === periodId) {
        entries.push({
          id: 'virtual-' + row.id,
          description: inst.name,
          amount: totalAmountForRow(inst, row),
          wifey_share: totalWifeyShareForRow(inst, row),
          kind: 'payment_plan',
          card_id: inst.card_id,
          installmentId: inst.id,
          virtual: true,
        });
      }
    });
  });
  return entries;
}

// Justine-owned installments where Joven covers some/all of a period's
// payment ("Joven's share" on her schedule) pin automatically into HIS
// General Ledger - not tied to any card - as a negative entry, since he's
// the one paying that amount (it reduces what she owes him overall).
function justineSharedLedgerEntriesForPeriod(periodId) {
  const entries = [];
  state.installments.filter(i => !i.archived && i.owner === 'justine').forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      const share = totalWifeyShareForRow(inst, row);
      if (periodIdForDate(row.due_date) === periodId && share > 0) {
        entries.push({
          id: 'ledger-virtual-' + row.id,
          description: inst.name,
          amount: -share,
          installmentId: inst.id,
          virtual: true,
        });
      }
    });
  });
  return entries;
}

// Joven's own installments assigned to "General Ledger" (no specific card) -
// their full amount counts toward his outflow (replacing what Accent used
// to do), and pins into the General Ledger list alongside manual entries
// and Justine's shared-installment deductions.
function generalLedgerInstallmentEntriesForPeriod(periodId) {
  const entries = [];
  state.installments.filter(i => !i.archived && i.owner === 'joven' && !i.card_id).forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      if (periodIdForDate(row.due_date) === periodId) {
        entries.push({
          id: 'gl-virtual-' + row.id,
          description: inst.name,
          amount: totalAmountForRow(inst, row),
          wifey_share: totalWifeyShareForRow(inst, row),
          installmentId: inst.id,
          virtual: true,
        });
      }
    });
  });
  return entries;
}
function generalLedgerInstallmentTotalForPeriod(periodId) {
  return generalLedgerInstallmentEntriesForPeriod(periodId).reduce((s, e) => s + e.amount, 0);
}
// Everything shown in the General Ledger section, net - used for the total
// shown on both the Transactions tab and the Summary card.
function generalLedgerTotalForPeriod(periodId) {
  const adjustments = state.wifeyAdjustments.filter(a => a.period_id === periodId).reduce((s, a) => s + Number(a.amount), 0);
  const shared = justineSharedLedgerEntriesForPeriod(periodId).reduce((s, e) => s + e.amount, 0);
  const ownInstallments = generalLedgerInstallmentTotalForPeriod(periodId);
  return adjustments + shared + ownInstallments;
}

function toLocalISODate(d) {
  // Avoids the classic toISOString() UTC-shift bug that pushes dates back a
  // day for timezones ahead of UTC (like the Philippines).
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function generateScheduleRows(inst) {
  const rows = [];
  const start = new Date(inst.start_date + 'T00:00:00');
  for (let i = 0; i < inst.num_months; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    rows.push({
      due_date: toLocalISODate(d),
      amount: Number(inst.monthly_amount),          // base amount only - fee is added on top at display time
      wifey_share: Number(inst.wifey_monthly_share || 0),  // base share only - fee share added on top at display time
    });
  }
  return rows;
}

function incomeItemsForPeriod(periodId) {
  return state.incomeItems.filter(i => i.period_id === periodId);
}

function wifeyTotalForPeriod(periodId) {
  const real = state.transactions
    .filter(t => t.period_id === periodId)
    .reduce((s, t) => s + Number(t.wifey_share || 0), 0);
  const virtual = virtualEntriesForPeriod(periodId).reduce((s, e) => s + e.wifey_share, 0);
  const glInstallments = generalLedgerInstallmentEntriesForPeriod(periodId).reduce((s, e) => s + e.wifey_share, 0);
  const adjustments = state.wifeyAdjustments
    .filter(a => a.period_id === periodId)
    .reduce((s, a) => s + Number(a.amount), 0);
  const sharedLedger = justineSharedLedgerEntriesForPeriod(periodId).reduce((s, e) => s + e.amount, 0);
  return real + virtual + glInstallments + adjustments + sharedLedger;
}

function periodTotals(period) {
  const cardTotal = state.cards.reduce((s, c) => s + cardTotalForPeriod(c.id, period.id), 0);
  const wifeyAmount = wifeyTotalForPeriod(period.id);
  const extraIncome = incomeItemsForPeriod(period.id).reduce((s, i) => s + Number(i.amount), 0);
  const income = Number(period.salary) + Number(period.previous_savings) + wifeyAmount + extraIncome;
  const outflow = cardTotal + generalLedgerInstallmentTotalForPeriod(period.id);
  const savings = income - outflow;
  return { cardTotal, income, outflow, savings, extraIncome, wifeyAmount };
}

/* ---------------- SUMMARY VIEW ---------------- */

function renderSummary() {
  const main = $('#main');
  const periods = state.periods.filter(p => !p.archived);
  const archivedPeriods = state.periods.filter(p => p.archived);
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div><h2>Joven</h2><div class="subtitle">Income, outflow & savings per pay period</div></div>
      <div style="display:flex;gap:8px;">
        ${state.showArchivedPeriods ? `<button class="btn secondary" id="toggle-archived-periods">← Back to active</button>` : archivedPeriods.length ? `<button class="btn secondary" id="toggle-archived-periods">Show archived (${archivedPeriods.length})</button>` : ''}
        <button class="btn" id="add-period-btn">+ New period</button>
      </div>
    </div>
    <div id="period-groups"></div>
    ${state.showArchivedPeriods && archivedPeriods.length ? `<h3 style="font-family:'Space Grotesk',sans-serif;font-size:15px;margin:24px 0 12px;color:var(--text-dim);">Archived</h3><div class="period-grid" id="archived-period-grid"></div>` : ''}
  `;
  $('#add-period-btn').onclick = () => openNewMonthPeriodModal();
  if ($('#toggle-archived-periods')) $('#toggle-archived-periods').onclick = () => { state.showArchivedPeriods = !state.showArchivedPeriods; renderSummary(); };

  const groupsWrap = $('#period-groups');
  if (!periods.length) {
    groupsWrap.innerHTML = `<div class="empty-state">No periods yet. Click "New period" to add your first month.</div>`;
    return;
  }

  // Group by calendar month, newest month first; 15th always sits left of 30th within a group.
  const byMonth = new Map();
  periods.forEach(p => {
    const mk = monthKey(p.period_date);
    if (!byMonth.has(mk)) byMonth.set(mk, {});
    byMonth.get(mk)[p.period_type] = p;
  });
  const monthKeys = Array.from(byMonth.keys()).sort((a, b) => b.localeCompare(a));

  function periodBoxHtml(p) {
    const t = periodTotals(p);
    return `
      <div class="period-card period-subcard">
        <div class="ph">
          <div><span class="tag">${p.period_type}</span></div>
          <div>
            <button class="icon-btn edit" data-edit="${p.id}" title="Edit">✎</button>
            <button class="icon-btn" data-archive="${p.id}" title="Archive">📦</button>
          </div>
        </div>
        <div class="line"><span class="lbl">💰</span><span class="val">${salaryDisplay(p.salary)} <button class="icon-btn" data-reveal-toggle style="width:22px;height:22px;font-size:11px;vertical-align:middle;">${state.revealSalary ? '🙈' : '👁'}</button></span></div>
        <div class="line"><span class="lbl">Previous savings</span><span class="val">${PESO(p.previous_savings)}</span></div>
        <div class="line"><span class="lbl">Justine <span class="synced-badge" title="Sum of transactions tagged Justine across all cards this period">⇄ from transactions</span></span><span class="val">${PESO(t.wifeyAmount)}</span></div>
        ${incomeItemsForPeriod(p.id).map(item => `
          <div class="line">
            <span class="lbl">${escapeHtml(item.label)}
              <button class="icon-btn edit" data-edit-income="${item.id}" style="width:20px;height:20px;font-size:10px;margin-left:4px;">✎</button>
              <button class="icon-btn" data-del-income="${item.id}" style="width:20px;height:20px;font-size:10px;">✕</button>
            </span>
            <span class="val">${PESO(item.amount)}</span>
          </div>`).join('')}
        <div class="line"><span class="lbl"><button class="icon-btn" data-add-income="${p.id}" style="width:auto;padding:2px 8px;font-size:11px;color:var(--gold);border-color:var(--gold);">+ income line</button></span><span class="val"></span></div>
        <div class="line"><span class="lbl">General ledger</span><span class="val">${PESO(generalLedgerTotalForPeriod(p.id))}</span></div>
        ${state.cards.map(c => {
          const amt = cardTotalForPeriod(c.id, p.id);
          if (!amt) return '';
          return `<div class="line"><span class="lbl card-chip"><span class="sw" style="background:${c.color}"></span>${c.name}${statementBadge(c, p.period_date)}</span><span class="val">${PESO(amt)}</span></div>`;
        }).join('')}
        <div class="line outflow total"><span class="lbl">Total outflow</span><span class="val">${PESO(t.outflow)}</span></div>
        <div class="line savings total"><span class="lbl">Savings</span><span class="val" style="color:${t.savings < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(t.savings)}</span></div>
      </div>`;
  }
  function emptyBoxHtml(type, mk) {
    return `
      <div class="period-card period-subcard" style="display:flex;align-items:center;justify-content:center;min-height:140px;">
        <button class="btn secondary" data-add-single="${mk}|${type}">+ Add ${type}</button>
      </div>`;
  }

  monthKeys.forEach(mk => {
    const pair = byMonth.get(mk);
    const monthLabel = new Date(mk + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    const el = document.createElement('div');
    el.className = 'period-group-card';
    el.innerHTML = `
      <div class="pg-header">${monthLabel}</div>
      <div class="period-subgrid">
        ${pair['15th'] ? periodBoxHtml(pair['15th']) : emptyBoxHtml('15th', mk)}
        ${pair['30th'] ? periodBoxHtml(pair['30th']) : emptyBoxHtml('30th', mk)}
      </div>
    `;
    groupsWrap.appendChild(el);
  });

  $$('[data-add-single]').forEach(b => b.onclick = () => {
    const [mk, type] = b.dataset.addSingle.split('|');
    const day = type === '15th' ? '15' : String(Math.min(30, new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0).getDate())).padStart(2, '0');
    openPeriodModal(null, `${mk}-${day}`, type);
  });
  $$('[data-edit]').forEach(b => b.onclick = () => openPeriodModal(periods.find(p => p.id === b.dataset.edit)));
  wireRevealToggles();
  $$('[data-archive]').forEach(b => b.onclick = async () => {
    await db.from('periods').update({ archived: true }).eq('id', b.dataset.archive);
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

  if (state.showArchivedPeriods && archivedPeriods.length) {
    const ag = $('#archived-period-grid');
    archivedPeriods.forEach(p => {
      const el = document.createElement('div');
      el.className = 'period-card';
      el.style.opacity = '.6';
      el.innerHTML = `
        <div class="ph">
          <div>
            <span class="tag">${p.period_type}</span>
            <div class="date">${new Date(p.period_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</div>
          </div>
          <div><button class="icon-btn edit" data-restore="${p.id}" title="Restore">♻️</button></div>
        </div>
        <div class="line"><span class="lbl">💰</span><span class="val">${salaryDisplay(p.salary)}</span></div>
      `;
      ag.appendChild(el);
    });
    $$('[data-restore]').forEach(b => b.onclick = async () => {
      await db.from('periods').update({ archived: false }).eq('id', b.dataset.restore);
      await loadAll(); renderView();
    });
  }
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

function openNewMonthPeriodModal() {
  showModal(`
    <h3>New period</h3>
    <div class="field-row">
      <div class="field"><label>Month</label><input type="month" id="f-month"></div>
    </div>
    <p style="font-size:12px;color:var(--text-dim);">Creates both the 15th and 30th boxes for this month (skips any that already exist) — edit each one afterward to fill in the details.</p>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Create</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const monthVal = $('#f-month').value; // "2026-08"
    if (!monthVal) { toast('Pick a month'); return; }
    const [y, m] = monthVal.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const day30 = String(Math.min(30, lastDay)).padStart(2, '0');
    const date15 = `${monthVal}-15`;
    const date30 = `${monthVal}-${day30}`;
    const has15 = state.periods.some(p => p.period_date === date15 && p.period_type === '15th');
    const has30 = state.periods.some(p => p.period_date === date30 && p.period_type === '30th');
    const rows = [];
    if (!has15) rows.push({ period_date: date15, period_type: '15th', salary: 0, previous_savings: 0 });
    if (!has30) rows.push({ period_date: date30, period_type: '30th', salary: 0, previous_savings: 0 });
    if (!rows.length) { toast('Both periods already exist for this month'); return; }
    const { error } = await db.from('periods').insert(rows);
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

function openPeriodModal(period, defaultDate, defaultType) {
  const isEdit = !!period;
  const p = period || { period_date: defaultDate || '', period_type: defaultType || '15th', salary: 0, previous_savings: 0, wifey: 0 };
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
    <p style="font-size:12px;color:var(--text-dim);">Justine isn't entered here anymore — tag her transactions as "Justine's" on the Transactions tab and it totals up automatically. Spaylater isn't here either — add it as a General Ledger installment instead.</p>
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
  const activePeriods = state.periods.filter(p => !p.archived);
  if (!activePeriods.length) {
    main.innerHTML = `<h2>Transactions</h2><div class="empty-state">Add a period first (Summary tab), then come back here.</div>`;
    return;
  }
  if (!state.txnPeriodId || !activePeriods.find(p => p.id === state.txnPeriodId)) {
    state.txnPeriodId = activePeriods[0].id;
  }
  const period = activePeriods.find(p => p.id === state.txnPeriodId);

  main.innerHTML = `
    <h2>Transactions</h2>
    <div class="subtitle">Every charge, grouped by credit card. Statement totals on the Summary tab are calculated from this list.</div>
    <div class="field-row" style="max-width:320px;margin-bottom:18px;">
      <div class="field"><label>Period</label>
        <select id="period-select">
          ${activePeriods.map(p => `<option value="${p.id}" ${p.id === state.txnPeriodId ? 'selected' : ''}>${p.period_type} — ${new Date(p.period_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="section-card" id="general-ledger-section">
      <div class="sh">
        <h3>General ledger <span class="synced-badge" title="Not tied to any card">not card-specific</span></h3>
        <span class="total" id="general-ledger-total"></span>
      </div>
      <p style="font-size:12px;color:var(--text-dim);margin-top:-4px;">Split into two groups below: real spending that adds to what you owe, and adjustments to what Justine owes you.</p>
      <div id="gl-outflow-group" style="margin-top:14px;"></div>
      <div id="gl-balance-group" style="margin-top:18px;"></div>
    </div>
    <div id="card-sections"></div>
  `;
  $('#period-select').onchange = e => { state.txnPeriodId = e.target.value; renderTransactions(); };

  const adjustments = state.wifeyAdjustments.filter(a => a.period_id === period.id);
  const sharedEntries = justineSharedLedgerEntriesForPeriod(period.id);
  const glInstallments = generalLedgerInstallmentEntriesForPeriod(period.id);
  const ledgerTotal = generalLedgerTotalForPeriod(period.id);
  $('#general-ledger-total').textContent = (ledgerTotal >= 0 ? '+' : '-') + PESO(Math.abs(ledgerTotal));

  const outflowSubtotal = glInstallments.reduce((s, e) => s + e.amount, 0);
  const balanceSubtotal = adjustments.reduce((s, a) => s + Number(a.amount), 0) + sharedEntries.reduce((s, e) => s + e.amount, 0);

  const outflowGroup = $('#gl-outflow-group');
  outflowGroup.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:12px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.4px;">Adds to your outflow</span>
      <span style="font-size:12px;color:var(--text-dim);">Subtotal: <b style="color:var(--text);">${PESO(outflowSubtotal)}</b> → feeds Total Outflow</span>
    </div>
    ${glInstallments.length ? `<table>
      <tbody>
        ${glInstallments.map(e => `
          <tr>
            <td>${escapeHtml(e.description)} <button class="synced-badge" data-edit-inst-sched="${e.installmentId}" style="border:none;cursor:pointer;background:rgba(244,117,111,.15);color:var(--red);" title="From your installment schedule - click to edit this period's split">⇄ adds to outflow</button></td>
            <td class="num">${PESO(e.amount)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : `<div class="empty-state" style="padding:14px;font-size:13px;">Nothing here — installments assigned to General Ledger show up in this group.</div>`}
  `;

  const balanceGroup = $('#gl-balance-group');
  balanceGroup.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:12px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.4px;">Adjusts what Justine owes you</span>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:12px;color:var(--text-dim);">Subtotal: <b style="color:var(--text);">${(balanceSubtotal >= 0 ? '+' : '-') + PESO(Math.abs(balanceSubtotal))}</b> → feeds the Justine line</span>
        <button class="btn secondary" id="add-adjustment-btn" style="padding:6px 12px;font-size:13px;">+ Add</button>
      </div>
    </div>
    ${(sharedEntries.length || adjustments.length) ? `<table>
      <tbody>
        ${sharedEntries.map(e => `
          <tr>
            <td>${escapeHtml(e.description)} <button class="synced-badge" data-edit-inst-sched="${e.installmentId}" style="border:none;cursor:pointer;" title="From Justine's installment schedule - Joven's share on this plan. Click to edit.">⇄ adjusts balance</button></td>
            <td class="num" style="color:var(--green);">-${PESO(Math.abs(e.amount))}</td>
            <td></td>
          </tr>`).join('')}
        ${adjustments.map(a => `
          <tr>
            <td>${escapeHtml(a.description)}</td>
            <td class="num" style="color:${Number(a.amount) < 0 ? 'var(--green)' : 'var(--text)'};">${Number(a.amount) >= 0 ? '+' : '-'}${PESO(Math.abs(a.amount))}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="icon-btn edit" data-edit-adj="${a.id}">✎</button>
              <button class="icon-btn" data-del-adj="${a.id}">✕</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>` : `<div class="empty-state" style="padding:14px;font-size:13px;">Nothing here yet.</div>`}
  `;
  $('#add-adjustment-btn').onclick = () => openAdjustmentModal(null, period.id);
  $$('[data-edit-adj]').forEach(b => b.onclick = () => {
    const a = state.wifeyAdjustments.find(x => x.id === b.dataset.editAdj);
    openAdjustmentModal(a, a.period_id);
  });
  $$('[data-del-adj]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this entry?')) return;
    await db.from('wifey_adjustments').delete().eq('id', b.dataset.delAdj);
    await loadAll(); renderView();
  });
  $$('#gl-outflow-group [data-edit-inst-sched], #gl-balance-group [data-edit-inst-sched]').forEach(b => b.onclick = () => {
    const inst = state.installments.find(x => x.id === b.dataset.editInstSched);
    openScheduleModal(inst);
  });

  const wrap = $('#card-sections');
  if (!state.cards.length) {
    wrap.innerHTML = `<div class="empty-state">No credit cards yet — add one in Cards & Settings.</div>`;
    return;
  }
  state.cards.filter(c => !c.archived).forEach(card => {
    const rows = state.transactions.filter(t => t.card_id === card.id && t.period_id === period.id);
    const virtualRows = virtualEntriesForPeriod(period.id).filter(e => e.card_id === card.id);
    const total = rows.reduce((s, t) => s + Number(t.amount), 0) + virtualRows.reduce((s, e) => s + e.amount, 0);
    const sec = document.createElement('div');
    sec.className = 'section-card';
    sec.innerHTML = `
      <div class="sh">
        <h3><span class="card-chip"><span class="sw" style="background:${card.color}"></span>${card.name}${statementBadge(card, period.period_date)}</span></h3>
        <div style="display:flex;align-items:center;gap:14px;">
          <span class="total">${PESO(total)}</span>
          <button class="btn secondary" data-add="${card.id}" style="padding:6px 12px;font-size:13px;">+ Add</button>
        </div>
      </div>
      ${(rows.length || virtualRows.length) ? `<table>
        <thead><tr><th>Description</th><th>Type</th><th>Split</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>
          ${virtualRows.map(e => {
            const jShare = e.amount - e.wifey_share;
            let splitHtml;
            if (e.wifey_share <= 0) splitHtml = '<span style="color:var(--text-dim);font-size:12px;">All Joven\'s</span>';
            else if (jShare <= 0) splitHtml = '<span class="pill" style="background:rgba(167,139,250,.15);color:var(--purple);">All Justine\'s</span>';
            else splitHtml = `<span style="font-size:12px;">You ${PESO(jShare)} <span style="color:var(--purple);">+ Justine ${PESO(e.wifey_share)}</span></span>`;
            return `
            <tr style="background:rgba(227,177,88,.05);">
              <td>${escapeHtml(e.description)} <button class="synced-badge" data-edit-inst-sched="${e.installmentId}" style="border:none;cursor:pointer;" title="From the installment schedule - click to edit this period's split">⇄ payment plan, edit split</button></td>
              <td><span class="pill payment_plan">Payment plan</span></td>
              <td>${splitHtml}</td>
              <td class="num">${PESO(e.amount)}</td>
              <td></td>
            </tr>`;
          }).join('')}
          ${rows.map(t => {
            const wShare = Number(t.wifey_share || 0);
            const jShare = Number(t.amount) - wShare;
            let splitHtml;
            if (wShare <= 0) splitHtml = '<span style="color:var(--text-dim);font-size:12px;">All Joven\'s</span>';
            else if (jShare <= 0) splitHtml = '<span class="pill" style="background:rgba(167,139,250,.15);color:var(--purple);">All Justine\'s</span>';
            else splitHtml = `<span style="font-size:12px;">You ${PESO(jShare)} <span style="color:var(--purple);">+ Justine ${PESO(wShare)}</span></span>`;
            return `
            <tr>
              <td>${escapeHtml(t.description)}</td>
              <td><span class="pill ${t.kind}">${t.kind === 'bill' ? 'Bill' : 'Payment plan'}</span></td>
              <td>${splitHtml}</td>
              <td class="num">${PESO(t.amount)}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="icon-btn edit" data-edit-txn="${t.id}">✎</button>
                <button class="icon-btn" data-del-txn="${t.id}">✕</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">No transactions yet for this card in this period.</div>`}
    `;
    wrap.appendChild(sec);
  });
  $$('[data-edit-inst-sched]').forEach(b => b.onclick = () => {
    const inst = state.installments.find(x => x.id === b.dataset.editInstSched);
    if (inst) openScheduleModal(inst);
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

function openAdjustmentModal(adj, periodId) {
  const isEdit = !!adj;
  const a = adj || { description: '', amount: '' };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} general ledger entry</h3>
    <div class="field-row">
      <div class="field"><label>Description</label><input type="text" id="f-desc" value="${a.description ? escapeHtml(a.description) : ''}" placeholder="e.g. Lent her cash for groceries"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="f-amt" value="${a.amount}" placeholder="positive = she owes you more"></div>
    </div>
    <p style="font-size:12px;color:var(--text-dim);">Positive amount = adds to what she owes you (e.g. cash you lent her). Negative amount = reduces it (e.g. you covered something for her). Type a minus sign for negative, like -500.</p>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = { description: $('#f-desc').value.trim(), amount: +$('#f-amt').value || 0, period_id: periodId };
    if (!payload.description) { toast('Add a description'); return; }
    let error;
    if (isEdit) ({ error } = await db.from('wifey_adjustments').update(payload).eq('id', a.id));
    else ({ error } = await db.from('wifey_adjustments').insert(payload));
    if (error) { toast(error.message); return; }
    closeModal(); await loadAll(); renderView();
  };
}

function openTxnModal(txn, cardId, periodId) {
  const isEdit = !!txn;
  const t = txn || { description: '', amount: '', kind: 'bill', wifey_share: 0 };
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
    <div class="field-row" style="align-items:center;gap:6px;">
      <button type="button" class="btn secondary" id="split-all-mine" style="padding:6px 10px;font-size:12px;">All mine</button>
      <button type="button" class="btn secondary" id="split-half" style="padding:6px 10px;font-size:12px;">Split 50/50</button>
      <button type="button" class="btn secondary" id="split-all-hers" style="padding:6px 10px;font-size:12px;">All hers</button>
    </div>
    <div class="field-row">
      <div class="field"><label>Justine's share (₱)</label><input type="number" step="0.01" id="f-wshare" value="${t.wifey_share || 0}"></div>
      <div class="field"><label>Your share (auto)</label><input type="text" id="f-jshare" value="" disabled style="opacity:.7;"></div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  const updateJShare = () => {
    const amt = +$('#f-amt').value || 0;
    const w = +$('#f-wshare').value || 0;
    $('#f-jshare').value = PESO(amt - w);
  };
  $('#f-amt').oninput = updateJShare;
  $('#f-wshare').oninput = updateJShare;
  $('#split-all-mine').onclick = () => { $('#f-wshare').value = 0; updateJShare(); };
  $('#split-half').onclick = () => { $('#f-wshare').value = (( +$('#f-amt').value || 0) / 2).toFixed(2); updateJShare(); };
  $('#split-all-hers').onclick = () => { $('#f-wshare').value = (+$('#f-amt').value || 0).toFixed(2); updateJShare(); };
  updateJShare();

  $('#modal-save').onclick = async () => {
    const amount = +$('#f-amt').value || 0;
    const wifeyShare = +$('#f-wshare').value || 0;
    if (wifeyShare < 0 || wifeyShare > amount) { toast("Justine's share can't be negative or more than the total amount"); return; }
    const payload = {
      description: $('#f-desc').value.trim(),
      amount,
      kind: $('#f-kind').value,
      wifey_share: wifeyShare,
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

function installmentMetrics(i) {
  const schedule = scheduleForInstallment(i.id);
  const principal = Number(i.principal) || 0;
  const fee = Number(i.fee) || 0;
  const totalToPay = schedule.reduce((s, r) => s + totalAmountForRow(i, r), 0);
  const interest = Math.max(totalToPay - principal - fee, 0);   // pure installment interest, excluding the one-time fee
  const financeCharge = interest + fee;                          // total cost of credit for this plan
  const remaining = schedule.filter(r => scheduleStatus(r.due_date) !== 'paid').reduce((s, r) => s + totalAmountForRow(i, r), 0);
  const paidCount = schedule.filter(r => scheduleStatus(r.due_date) === 'paid').length;
  const done = schedule.length > 0 && paidCount >= schedule.length;
  const endDate = schedule.length ? schedule[schedule.length - 1].due_date : null;
  const card = state.cards.find(c => c.id === i.card_id) || null;
  return { schedule, principal, fee, totalToPay, interest, financeCharge, remaining, done, endDate, card, monthly: Number(i.monthly_amount) || 0 };
}

// Rough monthly income used for the debt-to-income stat: Joven's latest two
// periods (a 15th + 30th pair), or Justine's latest month's paycheck budget.
function estimateMonthlyIncome() {
  if (state.profile === 'joven') {
    const sorted = state.periods.filter(p => !p.archived).slice().sort((a, b) => b.period_date.localeCompare(a.period_date));
    if (!sorted.length) return null;
    return sorted.slice(0, 2).reduce((s, p) => s + Number(p.salary), 0);
  }
  const sorted = state.justineMonths.filter(m => !m.archived).slice().sort((a, b) => b.month_date.localeCompare(a.month_date));
  return sorted.length ? Number(sorted[0].paycheck_budget) : null;
}

function renderInstallmentsDashboard(list) {
  const wrap = $('#install-dashboard');
  if (!list.length) {
    wrap.innerHTML = `<div class="section-card"><div class="empty-state">No installments yet — add one to see your dashboard.</div></div>`;
    return;
  }
  const metricsList = list.map(i => ({ i, m: installmentMetrics(i) }));
  const activeMetrics = metricsList.filter(x => !x.m.done);

  const totalPrincipal = metricsList.reduce((s, x) => s + x.m.principal, 0);
  const totalOutstanding = activeMetrics.reduce((s, x) => s + x.m.remaining, 0);
  const totalMonthlyObligation = activeMetrics.reduce((s, x) => s + x.m.monthly, 0);
  const totalInterest = metricsList.reduce((s, x) => s + x.m.interest, 0);
  const totalFee = metricsList.reduce((s, x) => s + x.m.fee, 0);
  const totalFinanceCharge = totalInterest + totalFee;
  const costOfCredit = totalPrincipal > 0 ? (totalFinanceCharge / totalPrincipal * 100) : 0;
  const perPlanRates = metricsList.filter(x => x.m.principal > 0).map(x => (x.m.interest + x.m.fee) / x.m.principal * 100);
  const avgPlanRate = perPlanRates.length ? perPlanRates.reduce((a, b) => a + b, 0) / perPlanRates.length : 0;
  const income = estimateMonthlyIncome();
  const totalToPayAll = metricsList.reduce((s, x) => s + x.m.totalToPay, 0);
  const totalPaidSoFar = metricsList.reduce((s, x) => s + (x.m.totalToPay - x.m.remaining), 0);
  const overallPaidPct = totalToPayAll > 0 ? (totalPaidSoFar / totalToPayAll * 100) : 0;

  // Split with the other spouse - how much of these plans is actually theirs,
  // not yours, based on the same per-period split used in "View schedule".
  const counterpartLabel = state.profile === 'joven' ? 'Justine' : 'Joven';
  const counterpartMonthly = activeMetrics.reduce((s, x) => s + Number(x.i.wifey_monthly_share || 0), 0);
  const counterpartRemaining = metricsList.reduce((s, x) => {
    const cpRem = x.m.schedule.filter(r => scheduleStatus(r.due_date) !== 'paid').reduce((ss, r) => ss + totalWifeyShareForRow(x.i, r), 0);
    return s + cpRem;
  }, 0);
  const counterpartLifetime = metricsList.reduce((s, x) => {
    const cpAll = x.m.schedule.reduce((ss, r) => ss + totalWifeyShareForRow(x.i, r), 0);
    return s + cpAll;
  }, 0);
  const yourNetMonthly = Math.max(totalMonthlyObligation - counterpartMonthly, 0);
  const yourNetOutstanding = Math.max(totalOutstanding - counterpartRemaining, 0);
  const dtiNet = income ? (yourNetMonthly / income * 100) : null;

  const endDates = activeMetrics.map(x => x.m.endDate).filter(Boolean).sort();
  const debtFreeDate = endDates.length ? endDates[endDates.length - 1] : null;

  // Aggregate by bank (card), including a "General Ledger" bucket
  const byBank = new Map();
  metricsList.forEach(({ i, m }) => {
    const key = m.card ? m.card.id : 'general';
    if (!byBank.has(key)) byBank.set(key, { name: m.card ? m.card.name : 'General Ledger', color: m.card ? m.card.color : 'var(--blue)', count: 0, principal: 0, interest: 0, fee: 0 });
    const b = byBank.get(key);
    b.count++; b.principal += m.principal; b.interest += m.interest; b.fee += m.fee;
  });
  const banks = Array.from(byBank.values()).map(b => ({
    ...b,
    interestRate: b.principal > 0 ? (b.interest / b.principal * 100) : 0,
    feeRate: b.principal > 0 ? (b.fee / b.principal * 100) : 0,
  }));
  const byUsage = [...banks].sort((a, b) => a.principal - b.principal);
  const byInterest = [...banks].sort((a, b) => a.interestRate - b.interestRate);
  const byFee = [...banks].sort((a, b) => a.feeRate - b.feeRate);

  function rankListHtml(items, valueFn, fmt) {
    if (!items.length) return `<div class="empty-state" style="padding:16px;font-size:13px;">No data yet.</div>`;
    return items.map((b, idx) => `
      <div class="rank-row">
        <span class="rank-num">#${idx + 1}</span>
        <span class="card-chip" style="flex:1;"><span class="sw" style="background:${b.color}"></span>${escapeHtml(b.name)}</span>
        <span class="rank-val">${fmt(valueFn(b))}</span>
      </div>`).join('');
  }

  // Payoff timeline - each active plan as a bar from today to its end date
  const timelineItems = activeMetrics.filter(x => x.m.endDate).sort((a, b) => a.m.endDate.localeCompare(b.m.endDate));
  let timelineHtml = `<div class="empty-state" style="padding:16px;font-size:13px;">Nothing active to project.</div>`;
  if (timelineItems.length) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const maxD = new Date(timelineItems[timelineItems.length - 1].m.endDate + 'T00:00:00');
    const totalSpan = Math.max(maxD - today, 1);
    timelineHtml = timelineItems.map(({ i, m }) => {
      const end = new Date(m.endDate + 'T00:00:00');
      const pct = Math.min(100, Math.max(3, ((end - today) / totalSpan) * 100));
      return `
        <div class="timeline-row">
          <div class="timeline-label">${escapeHtml(i.name)} <span style="color:var(--text-dim);font-size:11px;">${m.card ? m.card.name : 'General Ledger'}</span></div>
          <div class="timeline-track"><div class="timeline-fill" style="width:${pct}%;background:${m.card ? m.card.color : 'var(--blue)'}"></div></div>
          <div class="timeline-date">${end.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}</div>
        </div>`;
    }).join('');
  }

  wrap.innerHTML = `
    <div class="dash-stats">
      <div class="stat-card"><div class="stat-label">Active plans</div><div class="stat-value">${activeMetrics.length}</div></div>
      <div class="stat-card"><div class="stat-label">Outstanding balance</div><div class="stat-value">${PESO(totalOutstanding)}</div></div>
      <div class="stat-card"><div class="stat-label">Monthly obligation</div><div class="stat-value">${PESO(totalMonthlyObligation)}</div></div>
      <div class="stat-card"><div class="stat-label">Debt-to-income (net)</div><div class="stat-value">${dtiNet !== null ? dtiNet.toFixed(1) + '%' : '—'}</div><div class="stat-note">${dtiNet !== null ? `net of ${counterpartLabel}'s share` : 'add a period first'}</div></div>
      <div class="stat-card"><div class="stat-label">Avg plan rate</div><div class="stat-value">${avgPlanRate.toFixed(1)}%</div><div class="stat-note">mean across plans</div></div>
      <div class="stat-card"><div class="stat-label">Cost of credit</div><div class="stat-value">${costOfCredit.toFixed(1)}%</div><div class="stat-note">₱-weighted overall</div></div>
      <div class="stat-card"><div class="stat-label">Paid off so far</div><div class="stat-value">${overallPaidPct.toFixed(1)}%</div><div class="stat-note">of lifetime total</div></div>
      <div class="stat-card"><div class="stat-label">Debt-free by</div><div class="stat-value">${debtFreeDate ? new Date(debtFreeDate + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : '—'}</div></div>
    </div>

    <div class="dash-timeline" style="margin-bottom:22px;">
      <h4>Split with ${counterpartLabel} <span>how much of these plans is actually theirs, not yours</span></h4>
      <div class="dash-stats" style="margin-bottom:0;">
        <div class="stat-card"><div class="stat-label">Your net monthly</div><div class="stat-value">${PESO(yourNetMonthly)}</div><div class="stat-note">what you actually carry</div></div>
        <div class="stat-card"><div class="stat-label">${counterpartLabel}'s monthly share</div><div class="stat-value">${PESO(counterpartMonthly)}</div><div class="stat-note">owed back to you each period</div></div>
        <div class="stat-card"><div class="stat-label">Your net outstanding</div><div class="stat-value">${PESO(yourNetOutstanding)}</div></div>
        <div class="stat-card"><div class="stat-label">${counterpartLabel} owes (remaining)</div><div class="stat-value">${PESO(counterpartRemaining)}</div></div>
        <div class="stat-card"><div class="stat-label">${counterpartLabel}'s lifetime share</div><div class="stat-value">${PESO(counterpartLifetime)}</div><div class="stat-note">across all these plans, paid + unpaid</div></div>
      </div>
    </div>

    <div class="dash-rankings">
      <div class="rank-col">
        <h4>Bank usage <span>low → high, by principal</span></h4>
        ${rankListHtml(byUsage, b => b.principal, PESO)}
      </div>
      <div class="rank-col">
        <h4>Interest rate <span>low → high</span></h4>
        ${rankListHtml(byInterest, b => b.interestRate, v => v.toFixed(1) + '%')}
      </div>
      <div class="rank-col">
        <h4>Fee rate <span>low → high</span></h4>
        ${rankListHtml(byFee, b => b.feeRate, v => v.toFixed(1) + '%')}
      </div>
    </div>

    <div class="dash-timeline">
      <h4>Payoff timeline <span>when each active plan finishes</span></h4>
      ${timelineHtml}
    </div>
  `;
}

function scheduleStatus(dueDateStr) {
  const due = new Date(dueDateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (due < today) return 'paid';
  return 'upcoming';
}
function nextDueRowId(schedule) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const future = schedule.filter(r => new Date(r.due_date + 'T00:00:00') >= today);
  return future.length ? future[0].id : null;
}

function renderInstallments() {
  const main = $('#main');
  const ownAll = state.installments.filter(i => i.owner === state.profile);
  const archivedList = ownAll.filter(i => i.archived);
  const activeAll = ownAll.filter(i => !i.archived);
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div><h2>Installments</h2><div class="subtitle">Payment plans, split by period, and when each one finishes</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary" id="toggle-dashboard">${state.showInstallDashboard ? 'Hide' : 'Show'} dashboard</button>
        ${state.showArchivedInstallments ? `<button class="btn secondary" id="toggle-archived-installments">← Back to active</button>` : archivedList.length ? `<button class="btn secondary" id="toggle-archived-installments">Show archived (${archivedList.length})</button>` : ''}
        <button class="btn" id="add-install-btn">+ New installment</button>
      </div>
    </div>
    <div id="install-dashboard"></div>
    <div class="card-select-tabs" id="install-tabs"></div>
    <div class="install-grid" id="install-grid"></div>
  `;
  $('#add-install-btn').onclick = () => openInstallModal();
  $('#toggle-dashboard').onclick = () => { state.showInstallDashboard = !state.showInstallDashboard; renderInstallments(); };
  if (state.showInstallDashboard) renderInstallmentsDashboard(activeAll);
  if ($('#toggle-archived-installments')) $('#toggle-archived-installments').onclick = () => { state.showArchivedInstallments = !state.showArchivedInstallments; renderInstallments(); };

  const ownList = ownAll.filter(i => state.showArchivedInstallments ? i.archived : !i.archived);
  const cardIdsInUse = new Set(ownList.map(i => i.card_id).filter(Boolean));
  const hasGeneralLedger = ownList.some(i => !i.card_id);
  const cardsInUse = state.cards.filter(c => cardIdsInUse.has(c.id));

  const tabs = $('#install-tabs');
  tabs.innerHTML = `<button data-c="all" class="${!state.installCardId ? 'active' : ''}" style="${!state.installCardId ? 'background:var(--gold);color:#1a1200;' : ''}">All</button>` +
    cardsInUse.map(c => `<button data-c="${c.id}" class="${state.installCardId === c.id ? 'active' : ''}" style="${state.installCardId === c.id ? `background:${c.color};color:#fff;` : ''}">${c.name}</button>`).join('') +
    (hasGeneralLedger ? `<button data-c="general" class="${state.installCardId === 'general' ? 'active' : ''}" style="${state.installCardId === 'general' ? 'background:var(--blue);color:#fff;' : ''}">General Ledger</button>` : '');
  $$('#install-tabs button').forEach(b => b.onclick = () => { state.installCardId = b.dataset.c === 'all' ? null : b.dataset.c; renderInstallments(); });

  const grid = $('#install-grid');
  let list = ownList;
  if (state.installCardId === 'general') list = list.filter(i => !i.card_id);
  else if (state.installCardId) list = list.filter(i => i.card_id === state.installCardId);
  if (!list.length) { grid.innerHTML = `<div class="empty-state">${state.showArchivedInstallments ? 'No archived installments.' : 'No installments here yet.'}</div>`; return; }

  list.forEach(i => {
    const card = state.cards.find(c => c.id === i.card_id);
    const schedule = scheduleForInstallment(i.id);
    const paidCount = schedule.filter(r => scheduleStatus(r.due_date) === 'paid').length;
    const pct = schedule.length ? Math.round((paidCount / schedule.length) * 100) : 0;
    const done = schedule.length > 0 && paidCount >= schedule.length;
    const nextId = nextDueRowId(schedule);
    const lastRow = schedule[schedule.length - 1];
    const totalToPay = schedule.reduce((s, r) => s + totalAmountForRow(i, r), 0);
    const principal = Number(i.principal) || 0;
    const interest = Math.max(totalToPay - principal, 0);
    const interestPct = totalToPay > 0 ? Math.round((interest / totalToPay) * 100) : 0;

    const el = document.createElement('div');
    el.className = 'install-item' + (done ? ' done' : '');
    if (i.archived) el.style.opacity = '.6';
    el.innerHTML = `
      <div class="name">${escapeHtml(i.name)}</div>
      <div class="meta card-chip"><span class="sw" style="background:${card ? card.color : 'var(--blue)'}"></span>${card ? card.name : 'General Ledger'} • ${PESO(i.monthly_amount)}/mo</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${done ? 'var(--green)' : 'var(--gold)'}"></div></div>
      <div class="foot">
        <span>${done ? 'Completed' : `${paidCount} of ${schedule.length} paid`}</span>
        <span class="end">${done ? '✓ Paid off' : lastRow ? 'ends ' + new Date(lastRow.due_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : ''}</span>
      </div>
      ${principal > 0 ? `
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);margin-bottom:3px;">
          <span>Principal ${PESO(principal)}</span><span>Interest/fee ${PESO(interest)} (${interestPct}%)</span>
        </div>
        <div class="progress-track" style="height:8px;">
          <div style="height:100%;width:${100 - interestPct}%;background:var(--blue);float:left;"></div>
          <div style="height:100%;width:${interestPct}%;background:var(--red);float:left;"></div>
        </div>
      </div>` : ''}
      <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;">
        <button class="btn secondary" data-view-sched="${i.id}" style="padding:6px 12px;font-size:12px;">View schedule</button>
        <div>
          ${i.archived ? `
            <button class="icon-btn edit" data-restore-i="${i.id}" title="Restore">♻️</button>
            <button class="icon-btn" data-del-i="${i.id}" title="Delete permanently">✕</button>
          ` : `
            <button class="icon-btn edit" data-edit-i="${i.id}">✎</button>
            <button class="icon-btn" data-archive-i="${i.id}" title="Archive">📦</button>
          `}
        </div>
      </div>
    `;
    grid.appendChild(el);
  });
  $$('[data-edit-i]').forEach(b => b.onclick = () => openInstallModal(state.installments.find(x => x.id === b.dataset.editI)));
  $$('[data-view-sched]').forEach(b => b.onclick = () => openScheduleModal(state.installments.find(x => x.id === b.dataset.viewSched)));
  $$('[data-archive-i]').forEach(b => b.onclick = async () => {
    await db.from('installments').update({ archived: true }).eq('id', b.dataset.archiveI);
    await loadAll(); renderView();
  });
  $$('[data-restore-i]').forEach(b => b.onclick = async () => {
    await db.from('installments').update({ archived: false }).eq('id', b.dataset.restoreI);
    await loadAll(); renderView();
  });
  $$('[data-del-i]').forEach(b => b.onclick = async () => {
    if (!confirm('Permanently delete this installment plan and its schedule? This can\'t be undone.')) return;
    await db.from('installments').delete().eq('id', b.dataset.delI);
    await loadAll(); renderView();
  });
}

async function regenerateSchedule(inst) {
  await db.from('installment_schedule').delete().eq('installment_id', inst.id);
  const rows = generateScheduleRows(inst).map((r, idx) => ({
    installment_id: inst.id, due_date: r.due_date, amount: r.amount, wifey_share: r.wifey_share, is_fee_row: idx === 0,
  }));
  if (rows.length) await db.from('installment_schedule').insert(rows);
}

function openScheduleModal(inst) {
  const schedule = scheduleForInstallment(inst.id);
  const nextId = nextDueRowId(schedule);
  const counterpartLabel = inst.owner === 'joven' ? "Justine's share" : "Joven's share";
  showModal(`
    <h3>${escapeHtml(inst.name)} — schedule</h3>
    <p style="font-size:12px;color:var(--text-dim);margin-top:-8px;">Green = already paid. Gold = next due. Edit ${counterpartLabel.toLowerCase()} per period if it ever changes.</p>
    <div style="max-height:50vh;overflow-y:auto;">
    <table>
      <thead><tr><th>Due</th><th class="num">Amount</th><th class="num">${counterpartLabel}</th><th></th></tr></thead>
      <tbody id="sched-body">
        ${schedule.map(r => {
          const status = scheduleStatus(r.due_date);
          const isNext = r.id === nextId;
          const rowColor = status === 'paid' ? 'rgba(79,216,151,.08)' : isNext ? 'rgba(227,177,88,.12)' : 'transparent';
          return `
          <tr style="background:${rowColor};">
            <td>${new Date(r.due_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })} ${isNext ? '<span class="synced-badge" style="color:var(--gold);background:rgba(227,177,88,.15);">next due</span>' : status === 'paid' ? '<span class="synced-badge">paid</span>' : ''}${r.is_fee_row && Number(inst.fee) > 0 ? ` <span class="synced-badge" style="color:var(--red);background:rgba(244,117,111,.15);">+₱${Number(inst.fee).toFixed(2)} fee</span>` : ''}</td>
            <td class="num">
              <input type="number" step="0.01" data-row-id="${r.id}" data-field="amount" value="${r.amount}" style="width:100px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;text-align:right;">
              ${r.is_fee_row && Number(inst.fee) > 0 ? `<div style="font-size:10px;color:var(--text-dim);margin-top:3px;">= ${PESO(totalAmountForRow(inst, r))} total w/ fee</div>` : ''}
            </td>
            <td class="num">
              <input type="number" step="0.01" data-row-id="${r.id}" data-field="wifey_share" value="${r.wifey_share}" style="width:100px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;text-align:right;">
              ${r.is_fee_row && Number(inst.wifey_fee_share) > 0 ? `<div style="font-size:10px;color:var(--text-dim);margin-top:3px;">= ${PESO(totalWifeyShareForRow(inst, r))} total w/ fee</div>` : ''}
            </td>
            <td></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
    <p style="font-size:11px;color:var(--text-dim);">Amount is editable too - useful for plans where the payment isn't the same every period (like a declining balance).</p>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Close</button>
      <button class="btn" id="modal-save">Save changes</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const rowIds = [...new Set($$('#sched-body input[data-row-id]').map(inp => inp.dataset.rowId))];
    for (const id of rowIds) {
      const amt = $(`#sched-body input[data-row-id="${id}"][data-field="amount"]`);
      const wsh = $(`#sched-body input[data-row-id="${id}"][data-field="wifey_share"]`);
      await db.from('installment_schedule').update({ amount: +amt.value || 0, wifey_share: +wsh.value || 0 }).eq('id', id);
    }
    closeModal(); await loadAll(); renderView();
  };
}

function openInstallModal(item) {
  const isEdit = !!item;
  const i = item || {
    card_id: state.cards[0]?.id || '', name: '', principal: '', fee: 0, monthly_amount: '', start_date: '',
    num_months: 12, payer: '', wifey_monthly_share: 0, wifey_fee_share: 0,
  };
  const counterpartLabel = state.profile === 'joven' ? "Justine's" : "Joven's";
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} installment</h3>
    <div class="field-row">
      <div class="field"><label>Card</label>
        <select id="f-card">
          <option value="" ${!i.card_id ? 'selected' : ''}>General Ledger (not tied to a card)</option>
          ${state.cards.map(c => `<option value="${c.id}" ${c.id === i.card_id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Name</label><input type="text" id="f-name" value="${i.name ? escapeHtml(i.name) : ''}" placeholder="e.g. Tanie Tablet"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Principal</label><input type="number" step="0.01" id="f-principal" value="${i.principal}"></div>
      <div class="field"><label>Fee</label><input type="number" step="0.01" id="f-fee" value="${i.fee}"></div>
      <div class="field"><label>${counterpartLabel} share of the fee</label><input type="number" step="0.01" id="f-feeshare" value="${i.wifey_fee_share}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Monthly amount</label><input type="number" step="0.01" id="f-monthly" value="${i.monthly_amount}"></div>
      <div class="field"><label># of months</label><input type="number" id="f-months" value="${i.num_months}"></div>
      <div class="field"><label>${counterpartLabel} share (per month)</label><input type="number" step="0.01" id="f-monthlyshare" value="${i.wifey_monthly_share}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Start date</label><input type="date" id="f-start" value="${i.start_date}"></div>
      <div class="field"><label>Payer / note</label><input type="text" id="f-payer" value="${i.payer ? escapeHtml(i.payer) : ''}" placeholder="e.g. Justine"></div>
    </div>
    ${isEdit ? `<p style="font-size:12px;color:var(--text-dim);">Changing amount/months/start date regenerates the schedule and resets any per-period edits you made in "View schedule".</p>` : ''}
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = {
      card_id: $('#f-card').value || null,
      name: $('#f-name').value.trim(),
      principal: +$('#f-principal').value || null,
      fee: +$('#f-fee').value || 0,
      wifey_fee_share: +$('#f-feeshare').value || 0,
      monthly_amount: +$('#f-monthly').value || 0,
      wifey_monthly_share: +$('#f-monthlyshare').value || 0,
      num_months: +$('#f-months').value || 1,
      start_date: $('#f-start').value,
      payer: $('#f-payer').value.trim(),
    };
    if (!payload.name || !payload.start_date) { toast('Fill in name and start date'); return; }
    let error, savedId = i.id;
    const scheduleAffectingFieldsChanged = isEdit && (
      Number(payload.monthly_amount) !== Number(i.monthly_amount) ||
      Number(payload.num_months) !== Number(i.num_months) ||
      payload.start_date !== i.start_date ||
      Number(payload.fee) !== Number(i.fee || 0)
    );
    if (isEdit) {
      ({ error } = await db.from('installments').update(payload).eq('id', i.id));
    } else {
      const res = await db.from('installments').insert({ ...payload, owner: state.profile }).select().single();
      error = res.error; savedId = res.data ? res.data.id : null;
    }
    if (error) { toast(error.message); return; }
    // Only wipe/regenerate the schedule on a brand-new installment, or when a
    // field that actually changes the schedule's shape was edited. Editing
    // unrelated fields (name, payer, billed-to-card) leaves your per-period
    // edits in "View schedule" untouched.
    if (savedId && (!isEdit || scheduleAffectingFieldsChanged)) {
      await regenerateSchedule({ ...payload, id: savedId });
    }
    closeModal(); await loadAll(); renderView();
  };
}

/* ---------------- SETTINGS VIEW ---------------- */

function renderSettings() {
  const main = $('#main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
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

// Sum of Joven's 15th + 30th "Justine" line (what he says she owes him) for
// the same calendar month - this becomes her "Joven CC Total" automatically.
function jovenJustineTotalForMonth(monthDate) {
  const mk = monthKey(monthDate);
  const p15 = state.periods.find(p => p.period_type === '15th' && monthKey(p.period_date) === mk);
  const p30 = state.periods.find(p => p.period_type === '30th' && monthKey(p.period_date) === mk);
  let total = 0;
  if (p15) total += wifeyTotalForPeriod(p15.id);
  if (p30) total += wifeyTotalForPeriod(p30.id);
  return { total, hasP15: !!p15, hasP30: !!p30 };
}

// Her installments assigned to "General Ledger" (no specific card) - just a
// running total on her Summary, no line-item breakdown since she has no
// Transactions tab.
function justineGeneralLedgerTotalForMonth(monthDate) {
  const mk = monthKey(monthDate);
  let total = 0;
  state.installments.filter(i => !i.archived && i.owner === 'justine' && !i.card_id).forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      if (monthKey(row.due_date) === mk) total += totalAmountForRow(inst, row);
    });
  });
  return total;
}

function justineBillsForMonth(monthId) {
  return state.justineBills.filter(b => b.month_id === monthId);
}

function justineTotals(m) {
  const jovenCc = jovenJustineTotalForMonth(m.month_date);
  const billsTotal = justineBillsForMonth(m.id).reduce((s, b) => s + Number(b.amount), 0);
  const generalLedger = justineGeneralLedgerTotalForMonth(m.month_date);
  const payablesTotal = Number(m.bpi_total) + Number(m.eastwest_total) + billsTotal + generalLedger;
  const totalOutflow = jovenCc.total + payablesTotal;
  const savings = Number(m.paycheck_budget) - totalOutflow;
  return { billsTotal, payablesTotal, totalOutflow, savings, jovenCc, generalLedger };
}

function renderJustineSummary() {
  const main = $('#main');
  const months = state.justineMonths.filter(m => !m.archived);
  const archivedMonths = state.justineMonths.filter(m => m.archived);
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div><h2>Justine</h2><div class="subtitle">Monthly paycheck budget & payables</div></div>
      <div style="display:flex;gap:8px;">
        ${state.showArchivedMonths ? `<button class="btn secondary" id="toggle-archived-months">← Back to active</button>` : archivedMonths.length ? `<button class="btn secondary" id="toggle-archived-months">Show archived (${archivedMonths.length})</button>` : ''}
        <button class="btn" id="add-month-btn">+ New month</button>
      </div>
    </div>
    <div class="period-grid" id="month-grid"></div>
    ${state.showArchivedMonths && archivedMonths.length ? `<h3 style="font-family:'Space Grotesk',sans-serif;font-size:15px;margin:24px 0 12px;color:var(--text-dim);">Archived</h3><div class="period-grid" id="archived-month-grid"></div>` : ''}
  `;
  $('#add-month-btn').onclick = () => openJustineMonthModal();
  if ($('#toggle-archived-months')) $('#toggle-archived-months').onclick = () => { state.showArchivedMonths = !state.showArchivedMonths; renderJustineSummary(); };

  const grid = $('#month-grid');
  if (!months.length) {
    grid.innerHTML = `<div class="empty-state">No months yet. Click "New month" to add August.</div>`;
    return;
  }
  months.forEach(m => {
    const t = justineTotals(m);
    const monthLabel = new Date(m.month_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    const el = document.createElement('div');
    el.className = 'period-card';
    el.innerHTML = `
      <div class="ph">
        <div><span class="tag">${monthLabel}</span></div>
        <div>
          <button class="icon-btn edit" data-edit-m="${m.id}" title="Edit">✎</button>
          <button class="icon-btn" data-archive-m="${m.id}" title="Archive">📦</button>
        </div>
      </div>
      <div class="line"><span class="lbl">💰</span><span class="val">${salaryDisplay(m.paycheck_budget)} <button class="icon-btn" data-reveal-toggle style="width:22px;height:22px;font-size:11px;vertical-align:middle;">${state.revealSalary ? '🙈' : '👁'}</button></span></div>
      <div class="line"><span class="lbl">Joven CC Total <span class="synced-badge" title="Sum of Joven's Justine line on his 15th + 30th periods this month">⇄ synced</span></span><span class="val">${(t.jovenCc.hasP15 || t.jovenCc.hasP30) ? PESO(t.jovenCc.total) : '<span style="color:var(--text-dim)">no periods yet</span>'}</span></div>
      <div class="line"><span class="lbl">BPI</span><span class="val">${PESO(m.bpi_total)}</span></div>
      <div class="line"><span class="lbl">Eastwest</span><span class="val">${PESO(m.eastwest_total)}</span></div>
      <div class="line"><span class="lbl">General ledger</span><span class="val">${PESO(t.generalLedger)}</span></div>
      ${justineBillsForMonth(m.id).map(b => `
        <div class="line">
          <span class="lbl">${escapeHtml(b.label)}
            <button class="icon-btn edit" data-edit-bill="${b.id}" style="width:20px;height:20px;font-size:10px;margin-left:4px;">✎</button>
            <button class="icon-btn" data-del-bill="${b.id}" style="width:20px;height:20px;font-size:10px;">✕</button>
          </span>
          <span class="val">${PESO(b.amount)}</span>
        </div>`).join('')}
      <div class="line"><span class="lbl"><button class="icon-btn" data-add-bill="${m.id}" style="width:auto;padding:2px 8px;font-size:11px;color:var(--gold);border-color:var(--gold);">+ bill</button></span><span class="val"></span></div>
      <div class="line outflow total"><span class="lbl">Total outflow</span><span class="val">${PESO(t.totalOutflow)}</span></div>
      <div class="line savings total"><span class="lbl">Savings</span><span class="val" style="color:${t.savings < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(t.savings)}</span></div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
        <label style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.4px;">Notes</label>
        <textarea data-notes-for="${m.id}" placeholder="Jot anything down here…" style="width:100%;min-height:60px;margin-top:6px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:8px;font-family:inherit;font-size:13px;resize:vertical;">${m.notes ? escapeHtml(m.notes) : ''}</textarea>
      </div>
    `;
    grid.appendChild(el);
  });
  $$('[data-notes-for]').forEach(t => {
    t.onblur = async () => {
      await db.from('justine_months').update({ notes: t.value }).eq('id', t.dataset.notesFor);
      const m = state.justineMonths.find(x => x.id === t.dataset.notesFor);
      if (m) m.notes = t.value; // keep local state in sync without a full reload/re-render
    };
  });
  $$('[data-edit-m]').forEach(b => b.onclick = () => openJustineMonthModal(state.justineMonths.find(m => m.id === b.dataset.editM)));
  wireRevealToggles();
  $$('[data-archive-m]').forEach(b => b.onclick = async () => {
    await db.from('justine_months').update({ archived: true }).eq('id', b.dataset.archiveM);
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

  if (state.showArchivedMonths && archivedMonths.length) {
    const ag = $('#archived-month-grid');
    archivedMonths.forEach(m => {
      const monthLabel = new Date(m.month_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
      const el = document.createElement('div');
      el.className = 'period-card';
      el.style.opacity = '.6';
      el.innerHTML = `
        <div class="ph">
          <div><span class="tag">${monthLabel}</span></div>
          <div><button class="icon-btn edit" data-restore-m="${m.id}" title="Restore">♻️</button></div>
        </div>
        <div class="line"><span class="lbl">💰</span><span class="val">${salaryDisplay(m.paycheck_budget)}</span></div>
      `;
      ag.appendChild(el);
    });
    $$('[data-restore-m]').forEach(b => b.onclick = async () => {
      await db.from('justine_months').update({ archived: false }).eq('id', b.dataset.restoreM);
      await loadAll(); renderView();
    });
  }
}

function openJustineMonthModal(month) {
  const isEdit = !!month;
  const m = month || { month_date: '', paycheck_budget: 0, bpi_total: 0, eastwest_total: 0 };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} month</h3>
    <div class="field-row">
      <div class="field"><label>Month</label><input type="month" id="f-month" value="${m.month_date ? m.month_date.slice(0, 7) : ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>💰 Paycheck Budget</label><input type="number" step="0.01" id="f-budget" value="${m.paycheck_budget}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>BPI</label><input type="number" step="0.01" id="f-bpi" value="${m.bpi_total}"></div>
      <div class="field"><label>Eastwest</label><input type="number" step="0.01" id="f-ew" value="${m.eastwest_total}"></div>
    </div>
    <p style="font-size:12px;color:var(--text-dim);">Joven CC Total isn't entered here — it's automatically the sum of Joven's "Justine" line on his 15th + 30th periods for this same month. Savings = 💰 minus everything below.</p>
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
  $('#modal-backdrop').onclick = e => { if (e.target.id === 'modal-backdrop') closeModal(); };
}
function closeModal() { $('#modal-backdrop').classList.remove('active'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ---------------- INIT ---------------- */
/* ---------- Mobile drawer ---------- */
function closeMobileSidebar() {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  if (sb) sb.classList.remove('open');
  if (bd) bd.classList.remove('open');
}
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('mobile-menu-btn');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (btn) btn.onclick = () => {
    document.getElementById('sidebar').classList.toggle('open');
    backdrop.classList.toggle('open');
  };
  if (backdrop) backdrop.onclick = closeMobileSidebar;
});

document.addEventListener('DOMContentLoaded', initAuth);

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
// Each card reveals its own salary/paycheck - the eye on one card never
// unhides the others. `key` is 'period:<id>' or 'jmonth:<id>'.
const isRevealed = key => !!key && state.revealed.has(key);
const salaryDisplay = (n, key) => isRevealed(key) ? PESO(n) : '₱••••••••';
const revealBtn = key => `<button class="icon-btn" data-reveal-toggle="${key}" title="${isRevealed(key) ? 'Hide' : 'Show'}" aria-label="${isRevealed(key) ? 'Hide' : 'Show'}" style="width:22px;height:22px;font-size:11px;vertical-align:middle;">${isRevealed(key) ? '🙈' : '👁'}</button>`;
function wireRevealToggles() {
  $$('[data-reveal-toggle]').forEach(b => b.onclick = () => {
    const k = b.dataset.revealToggle;
    if (state.revealed.has(k)) state.revealed.delete(k); else state.revealed.add(k);
    renderView();
  });
}

function parseStatementDay(text) {
  if (!text) return null;
  const m = String(text).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// The statement relevant to a given period is whichever occurrence of the
// card's statement day most recently CLOSED before that period's own date -
// not necessarily one in the same calendar month. E.g. with a statement day
// of the 27th, the "Sep 15" period reflects the statement that closed on
// Aug 27 (last month), since Sep 27 hasn't happened yet by the 15th. A "30th"
// period, on the other hand, reflects that same month's 27th, since by the
// 30th this month's statement has already closed.
function statementCloseDateForPeriod(card, periodDate) {
  const day = parseStatementDay(card.statement_day);
  if (!day) return null;
  const pd = new Date(periodDate + 'T00:00:00');
  let candidate = new Date(pd.getFullYear(), pd.getMonth(), day);
  if (candidate >= pd) candidate = new Date(pd.getFullYear(), pd.getMonth() - 1, day);
  return candidate;
}
// The due date is the card's due day, in the month AFTER that statement closed.
function dueDateForPeriod(card, periodDate) {
  const closeDate = statementCloseDateForPeriod(card, periodDate);
  const dueDay = parseStatementDay(card.due_day);
  if (!closeDate || !dueDay) return null;
  return new Date(closeDate.getFullYear(), closeDate.getMonth() + 1, dueDay);
}
function hasStatementArrived(card, periodDate) {
  const closeDate = statementCloseDateForPeriod(card, periodDate);
  if (!closeDate) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return today >= closeDate; // once true, stays true forever - it's now a historical fact
}
function statementBadge(card, periodDate) {
  if (!hasStatementArrived(card, periodDate)) return '';
  const closeDate = statementCloseDateForPeriod(card, periodDate);
  const closeLabel = closeDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  const due = dueDateForPeriod(card, periodDate);
  const dueBadge = due ? ` <span class="synced-badge" style="color:var(--red);background:rgba(244,117,111,.15);" title="Due date, computed from the statement close date + due day">📅 due ${due.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>` : '';
  return ` <span class="synced-badge" style="color:var(--gold);background:rgba(227,177,88,.15);" title="Statement closed ${closeLabel}">🧾 statement in (${closeLabel})</span>${dueBadge}`;
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
  revealed: new Set(),   // which cards currently show their salary / paycheck
  showArchivedPeriods: false,
  showArchivedMonths: false,
  showArchivedInstallments: false,
  showInstallDashboard: pref('show_install_dash', true),
  expandedMonths: new Set(),   // older months on the Summary that were expanded by hand
  quickFocusCardId: null,      // card whose quick-add row should get focus after the next render
  visionBoards: [],
  visionBoardChecklist: [],
  visionBoardImages: [],
  inVisionBoard: false,
  activeVisionBoardId: null,
  showArchivedVisionBoards: false,
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Small per-browser UI preferences (which panels are open etc.) - not data.
function pref(key, fallback) {
  try { const v = localStorage.getItem('budget_pref_' + key); return v === null ? fallback : v === 'true'; }
  catch (e) { return fallback; }
}
function setPref(key, val) {
  try { localStorage.setItem('budget_pref_' + key, String(!!val)); } catch (e) { /* private mode etc. */ }
}

let toastTimer = null;
// opts.error -> red + stays longer. opts.undo -> adds an Undo button.
function toast(msg, opts = {}) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', !!opts.error);
  if (opts.undo) {
    const b = document.createElement('button');
    b.className = 'toast-undo';
    b.textContent = 'Undo';
    b.onclick = () => { t.classList.remove('active'); opts.undo(); };
    t.appendChild(b);
  }
  t.classList.add('active');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('active'), opts.undo ? 6000 : opts.error ? 5000 : 2200);
}

// Every database write goes through this: shows the error if it failed (and
// returns false so the caller stops), or an optional confirmation if it worked.
function dbOk(res, okMsg) {
  if (res && res.error) {
    toast("Couldn't save: " + (res.error.message || 'unknown error'), { error: true });
    return false;
  }
  if (okMsg) toast(okMsg);
  return true;
}

// Archive / restore several rows at once (a whole month = its 15th + 30th).
async function setArchivedMany(table, ids, archived, label) {
  const results = await Promise.all(ids.map(id => db.from(table).update({ archived }).eq('id', id)));
  const bad = results.find(r => r.error);
  await loadAll(); renderView();
  if (bad) { dbOk(bad); return; }
  if (archived) toast(`${label} archived`, { undo: () => setArchivedMany(table, ids, false, label) });
  else toast(`${label} restored`);
}

// ---- Received / Paid ticks on Summary lines ----
// scope 'period' = one of Joven's pay periods, 'jmonth' = one of Justine's months.
function lineDone(scope, ref, key) {
  return (state.lineStatus || []).some(x => x.scope === scope && x.ref_id === ref && x.line_key === key && x.done);
}
async function toggleLineStatus(scope, ref, key, done) {
  let row = state.lineStatus.find(x => x.scope === scope && x.ref_id === ref && x.line_key === key);
  if (row) row.done = done; else state.lineStatus.push(row = { scope, ref_id: ref, line_key: key, done });
  renderView(); // instant; the save happens in the background
  const res = await db.from('line_status').upsert({ scope, ref_id: ref, line_key: key, done, updated_at: new Date().toISOString() }, { onConflict: 'scope,ref_id,line_key' });
  if (!dbOk(res)) { row.done = !done; renderView(); }
}
// One Money in / Money out line, with a tick box when it's something that
// actually arrives or gets paid. `acc` collects amounts for the section header.
function flowLine(acc, { scope, ref, key, kind, label, amount, valHtml, valStyle, secret }) {
  const tickable = state.lineStatusOk && !!key && Number(amount) !== 0;
  const done = tickable && lineDone(scope, ref, key);
  if (tickable) acc.push({ amount: Number(amount), done, secret: secret || '' });
  const word = kind === 'in' ? 'received' : 'paid';
  const box = tickable
    ? `<input type="checkbox" class="line-chk" data-ls="${scope}|${ref}|${key}" ${done ? 'checked' : ''} title="Mark as ${word}" aria-label="${word}">`
    : (state.lineStatusOk ? '<span class="line-chk-pad"></span>' : '');
  return `<div class="line${done ? ' is-done' : ''}"><span class="lbl">${box}${label}</span><span class="val"${valStyle ? ` style="${valStyle}"` : ''}>${valHtml ?? PESO(amount)}</span></div>`;
}
function flowProgress(acc, kind) {
  if (!state.lineStatusOk || !acc.length) return '';
  const word = kind === 'in' ? 'received' : 'paid';
  const doneN = acc.filter(x => x.done).length;
  if (doneN === acc.length) return `<span class="flow-prog all">✓ all ${word}</span>`;
  const pending = acc.filter(x => !x.done);
  const left = pending.reduce((sum, x) => sum + x.amount, 0);
  // Don't leak a hidden salary through the "still to come in" figure.
  const leftTxt = pending.some(x => x.secret && !isRevealed(x.secret)) ? '₱••••••' : PESO(left);
  return `<span class="flow-prog">${doneN}/${acc.length} ${word} · ${leftTxt} ${kind === 'in' ? 'to come in' : 'left to pay'}</span>`;
}
function wireLineTicks() {
  $$('.line-chk').forEach(cb => cb.onchange = () => {
    const [scope, ref, ...rest] = cb.dataset.ls.split('|');
    toggleLineStatus(scope, ref, rest.join('|'), cb.checked);
  });
}

// Archive / restore with an Undo on the toast, instead of a confirm dialog.
async function setArchived(table, id, archived, label) {
  if (!dbOk(await db.from(table).update({ archived }).eq('id', id))) return;
  await loadAll(); renderView();
  if (archived) toast(`${label} archived`, { undo: () => setArchived(table, id, false, label) });
  else toast(`${label} restored`);
}

/* ---------------- AUTH ---------------- */

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // auto-logout after 1 day since last unlock

function markSessionActive() {
  localStorage.setItem('budget_unlock_time', String(Date.now()));
}
function isSessionExpired() {
  const t = localStorage.getItem('budget_unlock_time');
  if (!t) return true; // no recorded unlock time - treat as expired, safer default
  return (Date.now() - Number(t)) > SESSION_TIMEOUT_MS;
}

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
    } else if (localStorage.getItem('budget_unlocked') === 'true' && !isSessionExpired()) {
      enterApp();
    } else {
      if (localStorage.getItem('budget_unlocked') === 'true') {
        // Was unlocked, but it's been over a day - force back through the password screen.
        localStorage.removeItem('budget_unlocked');
        localStorage.removeItem('budget_unlock_time');
      }
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
    markSessionActive();
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
      markSessionActive();
      enterApp();
    } else {
      $('#login-error').textContent = 'Wrong password. Try again.';
    }
  };
}

function logout() {
  localStorage.removeItem('budget_unlocked');
  localStorage.removeItem('budget_unlock_time');
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
  // Catches the case where the tab is simply left open across the 24h mark,
  // rather than closed and reopened later.
  setInterval(() => { if (isSessionExpired()) logout(); }, 5 * 60 * 1000);
}

async function loadAll() {
  const [cards, periods, transactions, installments, incomeItems, justineMonths, justineBills, schedule, wifeyAdjustments, visionBoards, visionBoardChecklist, visionBoardImages, installmentItems, justineIncome, lineStatus] = await Promise.all([
    db.from('credit_cards').select('*').order('sort_order'),
    db.from('periods').select('*').order('period_date', { ascending: true }),
    db.from('transactions').select('*'),
    db.from('installments').select('*'),
    db.from('income_items').select('*'),
    db.from('justine_months').select('*').order('month_date', { ascending: false }),
    db.from('justine_bills').select('*'),
    db.from('installment_schedule').select('*').order('due_date', { ascending: true }),
    db.from('wifey_adjustments').select('*'),
    db.from('vision_boards').select('*').order('sort_order'),
    db.from('vision_board_checklist').select('*').order('sort_order'),
    db.from('vision_board_images').select('*').order('sort_order'),
    db.from('installment_items').select('*').order('sort_order'),
    db.from('justine_income_items').select('*'),
    db.from('line_status').select('*'),
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
  state.visionBoards = visionBoards.data || [];
  state.visionBoardChecklist = visionBoardChecklist.data || [];
  state.visionBoardImages = visionBoardImages.data || [];
  // The breakdown feature switches itself on once migration_installment_items.sql has been run.
  state.itemsTableOk = !installmentItems.error;
  state.installmentItems = installmentItems.data || [];
  // Justine's income lines switch on once migration_justine_income.sql has been run.
  state.justineIncomeOk = !justineIncome.error;
  state.justineIncomeItems = justineIncome.data || [];
  // Received / Paid ticks switch on once migration_line_status.sql has been run.
  state.lineStatusOk = !lineStatus.error;
  state.lineStatus = lineStatus.data || [];
}

/* ---------------- SIDEBAR / NAV ---------------- */

function renderSidebar() {
  const jovenNav = `
    <button class="nav-btn" data-view="summary">Summary</button>
    <button class="nav-btn" data-view="transactions">Transactions</button>
    <button class="nav-btn" data-view="installments">Installments</button>
    <button class="nav-btn" data-view="forecast">Forecast</button>
    <button class="nav-btn" data-view="settings">Cards & Settings</button>
  `;
  const justineNav = `
    <button class="nav-btn" data-view="summary">Summary</button>
    <button class="nav-btn" data-view="installments">Installments</button>
    <button class="nav-btn" data-view="forecast">Forecast</button>
  `;
  $('#sidebar').innerHTML = `
    <div class="brand"><span class="dot"></span> Household Budget</div>
    <button class="nav-btn vision-nav-btn ${state.inVisionBoard ? 'active' : ''}" id="vision-board-nav">✨ Vision Board</button>
    <div class="profile-switch" id="profile-switch">
      <button data-profile="joven" class="${!state.inVisionBoard && state.profile === 'joven' ? 'active' : ''}"><span class="avatar">J</span>Joven</button>
      <button data-profile="justine" class="${!state.inVisionBoard && state.profile === 'justine' ? 'active' : ''}"><span class="avatar">J</span>Justine</button>
    </div>
    ${state.profile === 'joven' ? jovenNav : justineNav}
    <div class="footer"><button class="btn secondary" id="logout-btn">Log out</button></div>
  `;
  $('#vision-board-nav').onclick = () => {
    state.inVisionBoard = true;
    applyProfileTheme();
    renderSidebar();
    renderView();
    closeMobileSidebar();
  };
  $$('#profile-switch button').forEach(b => b.onclick = () => {
    state.profile = b.dataset.profile;
    state.view = 'summary';
    state.inVisionBoard = false;
    applyProfileTheme();
    renderSidebar();
    renderView();
  });
  $$('.nav-btn[data-view]').forEach(b => b.onclick = () => {
    state.view = b.dataset.view;
    state.inVisionBoard = false;
    renderSidebar();
    renderView();
    closeMobileSidebar();
  });
  $('#logout-btn').onclick = logout;
}

function applyProfileTheme() {
  $('#app').classList.toggle('theme-justine', !state.inVisionBoard && state.profile === 'justine');
  $('#app').classList.toggle('theme-vision', state.inVisionBoard);
}

function renderView() {
  $$('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', !state.inVisionBoard && b.dataset.view === state.view));
  if (state.inVisionBoard) { renderVisionBoardView(); return; }
  if (state.profile === 'justine') {
    if (state.view === 'summary') renderJustineSummary();
    else if (state.view === 'installments') renderInstallments();
    else if (state.view === 'forecast') renderForecast();
    else renderJustineSummary();
    return;
  }
  if (state.view === 'summary') renderSummary();
  else if (state.view === 'transactions') renderTransactions();
  else if (state.view === 'installments') renderInstallments();
  else if (state.view === 'forecast') renderForecast();
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

// Who pays back the shared part of an installment ("Shared with"). Blank means
// the other spouse - every plan made before this field existed was shared
// between the two of them: Justine on Joven's plans, Joven on Justine's.
const defaultSharerFor = owner => owner === 'justine' ? 'Joven' : 'Justine';
function shareHolder(inst) {
  return (inst.share_with || '').trim() || defaultSharerFor(inst.owner);
}
// Joven's plan, shared with Justine -> goes into her total.
function isJustineShare(inst) {
  return inst.owner !== 'justine' && shareHolder(inst).toLowerCase() === 'justine';
}
// Justine's plan, part covered by Joven -> reduces what she owes him.
function isJovenShare(inst) {
  return inst.owner === 'justine' && shareHolder(inst).toLowerCase() === 'joven';
}
const possessive = name => name + (/s$/i.test(name) ? "'" : "'s");
// When the share holder is the other spouse but someone else actually pays
// them back (e.g. Joven's plan, Justine's share, Tanie pays Justine), this is
// who. Returns '' when the spouse pays it themselves.
function collectsFrom(inst) {
  if (shareHolder(inst).toLowerCase() !== defaultSharerFor(inst.owner).toLowerCase()) return '';
  return (inst.collect_from || '').trim();
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
          holder: shareHolder(inst),
          toJustine: isJustineShare(inst),
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
  state.installments.filter(i => !i.archived && isJovenShare(i)).forEach(inst => {
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
          holder: shareHolder(inst),
          toJustine: isJustineShare(inst),
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
  const [sy, sm, sd] = inst.start_date.split('-').map(Number);
  for (let i = 0; i < inst.num_months; i++) {
    // Same day each month, clamped to the month's last day - a plan due on the
    // 30th falls on Feb 28, not March 2 (which setMonth() would roll over to).
    const lastDay = new Date(sy, sm - 1 + i + 1, 0).getDate();
    const d = new Date(sy, sm - 1 + i, Math.min(sd, lastDay));
    rows.push({
      due_date: toLocalISODate(d),
      amount: Number(inst.monthly_amount),          // base amount only - fee is added on top at display time
      wifey_share: Number(inst.wifey_monthly_share || 0),  // base share only - fee share added on top at display time
    });
  }
  return rows;
}

function datePassed(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}
// A schedule row is paid if you said so (row.paid true/false). If you've never
// touched it (null), it falls back to the old rule: paid once its date passes.
function isRowPaid(row) {
  if (row.paid === true || row.paid === false) return row.paid;
  return datePassed(row.due_date);
}
function rowStatus(row) {
  if (isRowPaid(row)) return 'paid';
  return datePassed(row.due_date) ? 'overdue' : 'upcoming';
}

// The period you're most likely working on: the next one that hasn't passed
// yet, or the latest one if they're all in the past.
function currentPeriodId(periods) {
  const today = toLocalISODate(new Date());
  const sorted = periods.slice().sort((a, b) => a.period_date.localeCompare(b.period_date));
  const upcoming = sorted.find(p => p.period_date >= today);
  return (upcoming || sorted[sorted.length - 1]).id;
}
// The period right before a given date - its ending savings is what carries
// over as "Previous savings".
function previousPeriodOf(dateStr, excludeId) {
  if (!dateStr) return null;
  return state.periods
    .filter(p => !p.archived && p.id !== excludeId && p.period_date < dateStr)
    .sort((a, b) => b.period_date.localeCompare(a.period_date))[0] || null;
}
function shortDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}
const round2 = n => Math.round(Number(n) * 100) / 100;

function incomeItemsForPeriod(periodId) {
  return state.incomeItems.filter(i => i.period_id === periodId);
}

function wifeyTotalForPeriod(periodId) {
  const real = state.transactions
    .filter(t => t.period_id === periodId)
    .reduce((s, t) => s + Number(t.wifey_share || 0), 0);
  // Card-pinned plans here; General Ledger plans (no card) come from the line
  // below - virtualEntriesForPeriod returns both, so filtering by card avoids
  // counting a General Ledger plan's share twice.
  const virtual = virtualEntriesForPeriod(periodId).filter(e => e.card_id && e.toJustine).reduce((s, e) => s + e.wifey_share, 0);
  const glInstallments = generalLedgerInstallmentEntriesForPeriod(periodId).filter(e => e.toJustine).reduce((s, e) => s + e.wifey_share, 0);
  const adjustments = state.wifeyAdjustments
    .filter(a => a.period_id === periodId)
    .reduce((s, a) => s + Number(a.amount), 0);
  const sharedLedger = justineSharedLedgerEntriesForPeriod(periodId).reduce((s, e) => s + e.amount, 0);
  return real + virtual + glInstallments + adjustments + sharedLedger;
}

// Shares owed by anyone other than Justine (Mama, JP, ...) on Joven's
// installments. Each person's share lands as money in on the period the
// payment is due, one line per person.
function otherShareIncomeForPeriod(periodId) {
  const byPerson = new Map();
  const add = (who, amount, planLabel, via) => {
    const key = who.toLowerCase();
    if (!byPerson.has(key)) byPerson.set(key, { person: who, amount: 0, plans: [], via: false });
    const g = byPerson.get(key);
    g.amount += amount;
    g.plans.push(`${planLabel}: ${PESO(amount)}`);
    if (via) g.via = true;
  };
  virtualEntriesForPeriod(periodId).filter(e => !e.toJustine && e.wifey_share > 0).forEach(e => add(e.holder, e.wifey_share, e.description));
  // Justine's plans where Joven covers a share but someone else pays Joven back.
  state.installments.filter(i => !i.archived && isJovenShare(i) && collectsFrom(i)).forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      const share = totalWifeyShareForRow(inst, row);
      if (share > 0 && periodIdForDate(row.due_date) === periodId) add(collectsFrom(inst), share, `${inst.name} (Justine's plan)`, true);
    });
  });
  return [...byPerson.values()].sort((a, b) => a.person.localeCompare(b.person));
}

function periodTotals(period) {
  const cardTotal = state.cards.reduce((s, c) => s + cardTotalForPeriod(c.id, period.id), 0);
  const wifeyAmount = wifeyTotalForPeriod(period.id);   // what she owes from THIS period's charges
  // Justine settles once a month, on the 30th. So the 15th's share is tracked
  // but never counted in the 15th's savings - the 30th counts both halves.
  let wifeyCounted = 0;
  if (period.period_type === '30th') {
    const p15 = state.periods.find(p => p.period_type === '15th' && monthKey(p.period_date) === monthKey(period.period_date));
    wifeyCounted = wifeyAmount + (p15 ? wifeyTotalForPeriod(p15.id) : 0);
  }
  const extraIncome = incomeItemsForPeriod(period.id).reduce((s, i) => s + Number(i.amount), 0);
  const otherShares = otherShareIncomeForPeriod(period.id);
  const otherShareIncome = otherShares.reduce((s, o) => s + o.amount, 0);
  const income = Number(period.salary) + Number(period.previous_savings) + wifeyCounted + extraIncome + otherShareIncome;
  const outflow = cardTotal + generalLedgerInstallmentTotalForPeriod(period.id);
  const savings = income - outflow;
  return { cardTotal, income, outflow, savings, extraIncome, wifeyAmount, wifeyCounted, otherShares, otherShareIncome };
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

  function periodBoxHtml(p, pairForMonth) {
    const t = periodTotals(p);
    const sc = 'period', ref = p.id;
    const inAcc = [], outAcc = [];
    const is30 = p.period_type === '30th';
    const inLines = [
      flowLine(inAcc, { scope: sc, ref, key: 'salary', kind: 'in', label: '💰 Salary', amount: Number(p.salary), secret: 'period:' + p.id,
        valHtml: `${salaryDisplay(p.salary, 'period:' + p.id)} ${revealBtn('period:' + p.id)}` }),
      flowLine(inAcc, { label: 'Previous savings', amount: Number(p.previous_savings) }),
      flowLine(inAcc, { label: `Justine <span class="synced-badge" title="Sum of transactions tagged Justine across all cards this period">⇄ from transactions</span>${!is30 ? `<span class="synced-badge" style="color:var(--text-dim);background:rgba(141,149,171,.14);" title="She pays on the 30th, so this is shown for reference only - it's added to the 30th's savings instead">not counted · paid on 30th</span>` : ''}`,
        amount: t.wifeyAmount, valStyle: !is30 ? 'color:var(--text-dim);font-weight:400;' : '' }),
      is30 ? flowLine(inAcc, { scope: sc, ref, key: 'justine_total', kind: 'in', amount: t.wifeyCounted,
        label: `Justine total (15th + 30th) <span class="synced-badge" style="color:var(--green);background:rgba(79,216,151,.14);" title="She pays you in one lump sum on the 30th, so this combined amount is what's added to this period's savings">✓ counted in savings</span>` }) : '',
      ...t.otherShares.map(o => flowLine(inAcc, { scope: sc, ref, key: 'share:' + o.person.toLowerCase(), kind: 'in', amount: o.amount,
        label: `${escapeHtml(o.person)} <span class="synced-badge" title="Their share of: ${escapeHtml(o.plans.join(', '))}">⇄ from installments</span>` })),
      ...incomeItemsForPeriod(p.id).map(item => flowLine(inAcc, { scope: sc, ref, key: 'income:' + item.id, kind: 'in', amount: Number(item.amount),
        label: `${escapeHtml(item.label)}
                <button class="icon-btn edit" data-edit-income="${item.id}" style="margin-left:6px;" title="Edit" aria-label="Edit">✎</button>
                <button class="icon-btn" data-del-income="${item.id}" title="Delete" aria-label="Delete">✕</button>` })),
    ].join('');
    const gl = generalLedgerInstallmentTotalForPeriod(p.id);
    const outLines = [
      flowLine(outAcc, { scope: sc, ref, key: 'gl', kind: 'out', amount: gl,
        label: `General ledger <span class="synced-badge" title="Only counts general-ledger installments that add to your outflow - balance adjustments with Justine don't count here, see the Justine line for those">outflow only</span>` }),
      ...state.cards.map(c => {
        const amt = cardTotalForPeriod(c.id, p.id);
        if (!amt) return '';
        return flowLine(outAcc, { scope: sc, ref, key: 'card:' + c.id, kind: 'out', amount: amt,
          label: `<span class="card-chip"><span class="sw" style="background:${c.color}"></span>${c.name}${statementBadge(c, p.period_date)}</span>` });
      }),
    ].join('');
    return `
      <div class="period-card period-subcard">
        <div class="ph">
          <div><span class="tag">${p.period_type}</span></div>
          <div>
            <button class="icon-btn edit" data-edit="${p.id}" title="Edit" aria-label="Edit">✎</button>
          </div>
        </div>

        <div class="flow flow-in">
          <div class="flow-head">↓ Money in ${flowProgress(inAcc, 'in')}</div>
          ${inLines}
          <div class="line"><span class="lbl"><button class="icon-btn" data-add-income="${p.id}" style="width:auto;padding:2px 8px;font-size:11px;color:var(--gold);border-color:var(--gold);">+ income line</button></span><span class="val"></span></div>
          <div class="line flow-total"><span class="lbl">Total in</span><span class="val">${PESO(t.income)}</span></div>
        </div>

        <div class="flow flow-out">
          <div class="flow-head">↑ Money out ${flowProgress(outAcc, 'out')}</div>
          ${outLines}
          <div class="line flow-total"><span class="lbl">Total out</span><span class="val">${PESO(t.outflow)}</span></div>
        </div>

        <div class="line savings total"><span class="lbl">Savings <span class="flow-formula">in − out</span></span><span class="val" style="color:${t.savings < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(t.savings)}</span></div>
        <div class="notes-block">
          <label>Notes</label>
          <textarea data-pnotes-for="${p.id}" placeholder="Jot anything down here…">${p.notes ? escapeHtml(p.notes) : ''}</textarea>
        </div>
      </div>`;
  }
  function emptyBoxHtml(type, mk) {
    return `
      <div class="period-card period-subcard" style="display:flex;align-items:center;justify-content:center;min-height:140px;">
        <button class="btn secondary" data-add-single="${mk}|${type}">+ Add ${type}</button>
      </div>`;
  }

  // Only the newest few months are shown in full; older ones fold down to a
  // one-line total you can click open.
  const RECENT_MONTHS_SHOWN = 3;
  monthKeys.forEach((mk, idx) => {
    const pair = byMonth.get(mk);
    const monthLabel = new Date(mk + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    const el = document.createElement('div');
    el.className = 'period-group-card';
    const collapsible = idx >= RECENT_MONTHS_SHOWN;
    if (collapsible && !state.expandedMonths.has(mk)) {
      const ps = ['15th', '30th'].map(t => pair[t]).filter(Boolean);
      const outflow = ps.reduce((sum, p) => sum + periodTotals(p).outflow, 0);
      const endSavings = periodTotals(ps[ps.length - 1]).savings;
      el.classList.add('collapsed');
      el.innerHTML = `
        <button class="pg-toggle" data-toggle-month="${mk}" title="Show this month">
          <span class="pg-header">▸ ${monthLabel}</span>
          <span class="pg-mini">Outflow <b>${PESO(outflow)}</b><span class="pg-sep">·</span>Ended with <b style="color:${endSavings < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(endSavings)}</b></span>
        </button>`;
      groupsWrap.appendChild(el);
      return;
    }
    el.innerHTML = `
      <div class="pg-head-row">
        ${collapsible
          ? `<button class="pg-toggle" data-toggle-month="${mk}" title="Collapse this month"><span class="pg-header">▾ ${monthLabel}</span></button>`
          : `<div class="pg-header">${monthLabel}</div>`}
        <button class="icon-btn" data-archive-month="${mk}" title="Archive this month (15th + 30th)" aria-label="Archive this month">📦</button>
      </div>
      <div class="period-subgrid">
        ${pair['15th'] ? periodBoxHtml(pair['15th'], pair) : emptyBoxHtml('15th', mk)}
        ${pair['30th'] ? periodBoxHtml(pair['30th'], pair) : emptyBoxHtml('30th', mk)}
      </div>
    `;
    groupsWrap.appendChild(el);
  });

  $$('[data-toggle-month]').forEach(b => b.onclick = () => {
    const mk = b.dataset.toggleMonth;
    if (state.expandedMonths.has(mk)) state.expandedMonths.delete(mk); else state.expandedMonths.add(mk);
    renderSummary();
  });
  $$('[data-add-single]').forEach(b => b.onclick = () => {
    const [mk, type] = b.dataset.addSingle.split('|');
    const day = type === '15th' ? '15' : String(Math.min(30, new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0).getDate())).padStart(2, '0');
    openPeriodModal(null, `${mk}-${day}`, type);
  });
  $$('[data-edit]').forEach(b => b.onclick = () => openPeriodModal(periods.find(p => p.id === b.dataset.edit)));
  wireRevealToggles();
  $$('[data-archive-month]').forEach(b => b.onclick = () => {
    const ids = periods.filter(p => monthKey(p.period_date) === b.dataset.archiveMonth).map(p => p.id);
    setArchivedMany('periods', ids, true, new Date(b.dataset.archiveMonth + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }));
  });
  $$('[data-pnotes-for]').forEach(ta => ta.onblur = async () => {
    const per = state.periods.find(x => x.id === ta.dataset.pnotesFor);
    if (per && ta.value === (per.notes || '')) return; // nothing changed
    if (!dbOk(await db.from('periods').update({ notes: ta.value }).eq('id', ta.dataset.pnotesFor), 'Notes saved')) return;
    if (per) per.notes = ta.value;
  });
  wireLineTicks();
  $$('[data-add-income]').forEach(b => b.onclick = () => openIncomeItemModal(null, b.dataset.addIncome));
  $$('[data-edit-income]').forEach(b => b.onclick = () => {
    const item = state.incomeItems.find(x => x.id === b.dataset.editIncome);
    openIncomeItemModal(item, item.period_id);
  });
  $$('[data-del-income]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this income line?')) return;
    if (!dbOk(await db.from('income_items').delete().eq('id', b.dataset.delIncome))) return;
    await loadAll(); renderView();
  });

  if (state.showArchivedPeriods && archivedPeriods.length) {
    const ag = $('#archived-period-grid');
    const archByMonth = new Map();
    archivedPeriods.forEach(p => {
      const mk = monthKey(p.period_date);
      if (!archByMonth.has(mk)) archByMonth.set(mk, []);
      archByMonth.get(mk).push(p);
    });
    [...archByMonth.keys()].sort((x, y) => y.localeCompare(x)).forEach(mk => {
      const ps = archByMonth.get(mk).sort((x, y) => x.period_date.localeCompare(y.period_date));
      const label = new Date(mk + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
      const el = document.createElement('div');
      el.className = 'period-card';
      el.style.opacity = '.6';
      el.innerHTML = `
        <div class="ph">
          <div><span class="tag">${label}</span><div class="date">${ps.map(p => p.period_type).join(' + ')}</div></div>
          <div><button class="icon-btn edit" data-restore-month="${ps.map(p => p.id).join(',')}" data-label="${label}" title="Restore this month" aria-label="Restore this month">♻️</button></div>
        </div>`;
      ag.appendChild(el);
    });
    $$('[data-restore-month]').forEach(b => b.onclick = () => setArchivedMany('periods', b.dataset.restoreMonth.split(','), false, b.dataset.label));
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
    if (error) { toast(error.message, { error: true }); return; }
    closeModal(); await loadAll(); renderView();
  };
}

function openNewMonthPeriodModal() {
  showModal(`
    <h3>New period</h3>
    <div class="field-row">
      <div class="field"><label>Month</label><input type="month" id="f-month"></div>
    </div>
    <p style="font-size:12px;color:var(--text-dim);">Creates both the 15th and 30th boxes for this month (skips any that already exist) — edit each one afterward to fill in the details. The 15th starts with whatever your last period ended with; the 30th's "Previous savings" has a one-click carry-over button once the 15th is filled in.</p>
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
    const before15 = previousPeriodOf(date15);
    if (!has15) rows.push({ period_date: date15, period_type: '15th', salary: 0, previous_savings: before15 ? round2(periodTotals(before15).savings) : 0 });
    if (!has30) rows.push({ period_date: date30, period_type: '30th', salary: 0, previous_savings: 0 });
    if (!rows.length) { toast('Both periods already exist for this month'); return; }
    const { error } = await db.from('periods').insert(rows);
    if (error) { toast(error.message, { error: true }); return; }
    closeModal(); await loadAll(); renderView();
  };
}

function openPeriodModal(period, defaultDate, defaultType) {
  const isEdit = !!period;
  const p = period || { period_date: defaultDate || '', period_type: defaultType || '15th', salary: 0, previous_savings: 0, wifey: 0 };
  if (!isEdit) {
    // Brand-new period: start from what the period before it ended with.
    const before = previousPeriodOf(p.period_date);
    if (before) p.previous_savings = round2(periodTotals(before).savings);
  }
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
    <div id="carry-wrap"></div>
    <p style="font-size:12px;color:var(--text-dim);">Justine isn't entered here anymore — tag her transactions as "Justine's" on the Transactions tab and it totals up automatically. Spaylater isn't here either — add it as a General Ledger installment instead.</p>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  // Offers the previous period's ending savings whenever the field doesn't
  // already match it - one click instead of copying the number by hand.
  const updateCarry = () => {
    const before = previousPeriodOf($('#f-date').value, p.id);
    const wrap = $('#carry-wrap');
    if (!before) { wrap.innerHTML = ''; return; }
    const carry = round2(periodTotals(before).savings);
    if (round2(+$('#f-prev').value || 0) === carry) {
      wrap.innerHTML = `<div class="carry-note">✓ Matches what ${shortDate(before.period_date)} ended with</div>`;
      return;
    }
    wrap.innerHTML = `<button type="button" class="carry-btn" id="carry-btn">↩ Use ${PESO(carry)} — what ${shortDate(before.period_date)} ended with</button>`;
    $('#carry-btn').onclick = () => { $('#f-prev').value = carry; updateCarry(); };
  };
  $('#f-date').onchange = updateCarry;
  $('#f-prev').oninput = updateCarry;
  updateCarry();

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
    if (error) { toast(error.message, { error: true }); return; }
    // A new 15th always gets its 30th too - Justine's 15th amount only counts
    // on the 30th, so a month without one would silently drop it.
    let added30 = false;
    if (!isEdit && payload.period_type === '15th') {
      const mk = monthKey(payload.period_date);
      if (!state.periods.some(x => x.period_type === '30th' && monthKey(x.period_date) === mk)) {
        const [y, m] = mk.split('-').map(Number);
        const day30 = String(Math.min(30, new Date(y, m, 0).getDate())).padStart(2, '0');
        added30 = dbOk(await db.from('periods').insert({ period_date: `${mk}-${day30}`, period_type: '30th', salary: 0, previous_savings: 0 }));
      }
    }
    closeModal(); await loadAll(); renderView();
    if (added30) toast('15th added, plus an empty 30th for the same month');
  };
}

/* ---------------- TRANSACTIONS VIEW ---------------- */

// Sort order for each card's list (payment-plan rows always stay pinned on
// top). Remembered per browser.
const TXN_SORTS = [
  ['added-asc', 'Date added (oldest first)'],
  ['added-desc', 'Date added (newest first)'],
  ['amount-desc', 'Amount (highest first)'],
  ['amount-asc', 'Amount (lowest first)'],
  ['name-asc', 'Name (A → Z)'],
  ['split-justine', "Split: Justine's first"],
  ['split-mine', 'Split: yours first'],
  ['type', 'Type: bills, then credits'],
];
function txnSort() {
  let v = 'added-asc';
  try { v = localStorage.getItem('budget_txn_sort') || v; } catch (e) { /* private mode */ }
  return TXN_SORTS.some(([k]) => k === v) ? v : 'added-asc';
}
function sortTransactions(list) {
  const added = t => t.created_at || '';
  const share = t => { const a = Number(t.amount); return a ? Number(t.wifey_share || 0) / a : 0; }; // 0 = all yours, 1 = all hers
  const byAdded = (a, b) => added(a).localeCompare(added(b));
  const cmp = {
    'added-asc': byAdded,
    'added-desc': (a, b) => byAdded(b, a),
    'amount-desc': (a, b) => Number(b.amount) - Number(a.amount) || byAdded(a, b),
    'amount-asc': (a, b) => Number(a.amount) - Number(b.amount) || byAdded(a, b),
    'name-asc': (a, b) => (a.description || '').localeCompare(b.description || '', undefined, { sensitivity: 'base' }) || byAdded(a, b),
    'split-justine': (a, b) => share(b) - share(a) || byAdded(a, b),
    'split-mine': (a, b) => share(a) - share(b) || byAdded(a, b),
    'type': (a, b) => (Number(a.amount) < 0) - (Number(b.amount) < 0) || byAdded(a, b),
  }[txnSort()];
  return list.slice().sort(cmp);
}

// Which pay period a card's bill is settled in: '15th', '30th', or blank/'both'
// (shows in every period - also the fallback before the pay_period column exists).
function cardPaidInPeriod(card, period) {
  return !card.pay_period || card.pay_period === 'both' || card.pay_period === period.period_type;
}

function renderTransactions() {
  const main = $('#main');
  const activePeriods = state.periods.filter(p => !p.archived);
  if (!activePeriods.length) {
    main.innerHTML = `<h2>Transactions</h2><div class="empty-state">Add a period first (Summary tab), then come back here.</div>`;
    return;
  }
  if (!state.txnPeriodId || !activePeriods.find(p => p.id === state.txnPeriodId)) {
    state.txnPeriodId = currentPeriodId(activePeriods);
  }
  const period = activePeriods.find(p => p.id === state.txnPeriodId);

  main.innerHTML = `
    <h2>Transactions</h2>
    <div class="subtitle">Every charge, grouped by credit card. Statement totals on the Summary tab are calculated from this list.</div>
    <div class="field-row" style="max-width:560px;margin-bottom:18px;">
      <div class="field"><label>Period</label>
        <select id="period-select">
          ${activePeriods.map(p => `<option value="${p.id}" ${p.id === state.txnPeriodId ? 'selected' : ''}>${p.period_type} — ${new Date(p.period_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Sort by</label>
        <select id="txn-sort">
          ${TXN_SORTS.map(([v, l]) => `<option value="${v}" ${v === txnSort() ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="snapshot-card" id="txn-snapshot">
      <div class="snapshot-heading">Justine Summary</div>
    </div>
    <div class="section-card" id="general-ledger-section">
      <div class="sh">
        <h3>General ledger <span class="synced-badge" title="Not tied to any card">not card-specific</span></h3>
        <span class="total" id="general-ledger-total"></span>
      </div>
      <p style="font-size:12px;color:var(--text-dim);margin-top:-4px;">Your own installments assigned to General Ledger instead of a card - these add straight to your outflow. (Everything Justine-related now lives in the Justine Summary above.)</p>
      <div id="gl-outflow-group" style="margin-top:14px;"></div>
    </div>
    <div id="card-sections"></div>
  `;
  $('#period-select').onchange = e => { state.txnPeriodId = e.target.value; renderTransactions(); };
  $('#txn-sort').onchange = e => { try { localStorage.setItem('budget_txn_sort', e.target.value); } catch (err) { /* private mode */ } renderTransactions(); };

  const adjustments = state.wifeyAdjustments.filter(a => a.period_id === period.id);
  const sharedEntries = justineSharedLedgerEntriesForPeriod(period.id);
  const glInstallments = generalLedgerInstallmentEntriesForPeriod(period.id);
  const outflowSubtotal = glInstallments.reduce((s, e) => s + e.amount, 0);
  $('#general-ledger-total').textContent = PESO(outflowSubtotal);

  // One unified list: what she owes you, broken down by card, then other
  // sources, then what you owe her (subtracted at the end) - each row
  // tagged with its type so the whole picture reads in a single glance.
  const perCardShare = state.cards.map(c => {
    const real = state.transactions.filter(t => t.period_id === period.id && t.card_id === c.id).reduce((s, t) => s + Number(t.wifey_share || 0), 0);
    const virt = virtualEntriesForPeriod(period.id).filter(e => e.card_id === c.id && e.toJustine).reduce((s, e) => s + e.wifey_share, 0);
    return { card: c, amount: real + virt };
  }).filter(x => x.amount !== 0);
  const otherOwed = [
    ...glInstallments.filter(e => e.wifey_share !== 0 && e.toJustine).map(e => ({ description: e.description, amount: e.wifey_share })),
    ...adjustments.filter(a => Number(a.amount) >= 0).map(a => ({ description: a.description, amount: Number(a.amount), id: a.id, editable: true })),
  ];
  const youCover = [
    ...sharedEntries.map(e => ({ description: e.description, amount: Math.abs(e.amount), installmentId: e.installmentId })),
    ...adjustments.filter(a => Number(a.amount) < 0).map(a => ({ description: a.description, amount: Math.abs(Number(a.amount)), id: a.id, editable: true })),
  ];
  const cardShare = perCardShare.reduce((s, x) => s + x.amount, 0);
  const otherShare = otherOwed.reduce((s, x) => s + x.amount, 0);
  const owedTotal = cardShare + otherShare;
  const coverTotal = youCover.reduce((s, x) => s + x.amount, 0);
  const netTotal = owedTotal - coverTotal;

  function editButtons(row) {
    if (row.installmentId) return `<button class="synced-badge" data-edit-inst-sched="${row.installmentId}" style="border:none;cursor:pointer;" title="From an installment schedule - click to edit this period's split">⇄ edit split</button>`;
    if (row.editable) return `<button class="icon-btn edit" data-edit-adj="${row.id}" title="Edit" aria-label="Edit">✎</button><button class="icon-btn" data-del-adj="${row.id}" title="Delete" aria-label="Delete">✕</button>`;
    return '';
  }

  $('#txn-snapshot').innerHTML = `
    <div class="snapshot-heading">Justine Summary</div>
    <table>
      <thead><tr><th>Description</th><th>Type</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>
        ${perCardShare.map(x => `
          <tr>
            <td>${escapeHtml(x.card.name)}</td>
            <td><span class="card-chip"><span class="sw" style="background:${x.card.color}"></span>Card</span></td>
            <td class="num" style="color:var(--green);">+${PESO(x.amount)}</td>
            <td></td>
          </tr>`).join('')}
        ${otherOwed.map(x => `
          <tr>
            <td>${escapeHtml(x.description)}</td>
            <td><span class="synced-badge">Other</span></td>
            <td class="num" style="color:var(--green);">+${PESO(x.amount)}</td>
            <td style="text-align:right;white-space:nowrap;">${editButtons(x)}</td>
          </tr>`).join('')}
        ${youCover.map(x => `
          <tr>
            <td>${escapeHtml(x.description)}</td>
            <td><span class="synced-badge" style="color:var(--red);background:rgba(244,117,111,.15);">Plan you cover</span></td>
            <td class="num">-${PESO(x.amount)}</td>
            <td style="text-align:right;white-space:nowrap;">${editButtons(x)}</td>
          </tr>`).join('')}
        ${(!perCardShare.length && !otherOwed.length && !youCover.length) ? `<tr><td colspan="4"><div class="empty-state" style="padding:10px 0;font-size:13px;">Nothing here yet.</div></td></tr>` : ''}
      </tbody>
    </table>
    <div class="snapshot-row" style="margin-top:10px;">
      <span class="snapshot-label">Justine owes you</span>
      <span class="snapshot-val" style="font-size:14px;color:var(--green);">+${PESO(owedTotal)}</span>
    </div>
    <div class="snapshot-row">
      <span class="snapshot-label">− You owe Justine</span>
      <span class="snapshot-val" style="font-size:14px;">${PESO(coverTotal)}</span>
    </div>
    <div class="snapshot-row snapshot-total" style="margin-top:6px;">
      <span class="snapshot-label">Net: ${netTotal >= 0 ? 'Justine owes you' : 'You owe Justine'}</span>
      <span class="snapshot-val">${PESO(Math.abs(netTotal))}</span>
    </div>
    <div style="text-align:right;margin-top:10px;">
      <button class="btn secondary" id="add-adjustment-btn" style="padding:6px 12px;font-size:13px;">+ Add cash lent/covered</button>
    </div>
  `;
  $('#add-adjustment-btn').onclick = () => openAdjustmentModal(null, period.id);
  $$('#txn-snapshot [data-edit-adj]').forEach(b => b.onclick = () => {
    const a = state.wifeyAdjustments.find(x => x.id === b.dataset.editAdj);
    openAdjustmentModal(a, a.period_id);
  });
  $$('#txn-snapshot [data-del-adj]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this entry?')) return;
    if (!dbOk(await db.from('wifey_adjustments').delete().eq('id', b.dataset.delAdj))) return;
    await loadAll(); renderView();
  });
  $$('#txn-snapshot [data-edit-inst-sched]').forEach(b => b.onclick = () => {
    const inst = state.installments.find(x => x.id === b.dataset.editInstSched);
    openScheduleModal(inst);
  });

  const outflowGroup = $('#gl-outflow-group');
  outflowGroup.innerHTML = glInstallments.length ? `<table>
      <tbody>
        ${glInstallments.map(e => `
          <tr>
            <td>${escapeHtml(e.description)} <button class="synced-badge" data-edit-inst-sched="${e.installmentId}" style="border:none;cursor:pointer;background:rgba(244,117,111,.15);color:var(--red);" title="From your installment schedule - click to edit this period's split">⇄ adds to outflow</button></td>
            <td class="num">${PESO(e.amount)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : `<div class="empty-state" style="padding:14px;font-size:13px;">Nothing here — installments assigned to General Ledger show up in this group.</div>`;
  $$('#gl-outflow-group [data-edit-inst-sched]').forEach(b => b.onclick = () => {
    const inst = state.installments.find(x => x.id === b.dataset.editInstSched);
    openScheduleModal(inst);
  });

  const wrap = $('#card-sections');
  if (!state.cards.length) {
    wrap.innerHTML = `<div class="empty-state">No credit cards yet — add one in Cards & Settings.</div>`;
    return;
  }
  state.cards.filter(c => !c.archived).forEach(card => {
    const rows = sortTransactions(state.transactions.filter(t => t.card_id === card.id && t.period_id === period.id));
    const virtualRows = virtualEntriesForPeriod(period.id).filter(e => e.card_id === card.id);
    // A card only gets a section in the period it's actually paid in (its
    // "Paid on" setting). If something IS recorded against it in the other
    // period, the section still shows (flagged) so nothing that counts toward
    // the Summary totals is ever hidden.
    const offCycle = !cardPaidInPeriod(card, period);
    if (offCycle && !rows.length && !virtualRows.length) return;
    const total = rows.reduce((s, t) => s + Number(t.amount), 0) + virtualRows.reduce((s, e) => s + e.amount, 0);
    const sec = document.createElement('div');
    sec.className = 'section-card';
    sec.innerHTML = `
      <div class="sh">
        <h3><span class="card-chip"><span class="sw" style="background:${card.color}"></span>${card.name}${statementBadge(card, period.period_date)}${offCycle ? ` <span class="synced-badge" style="color:var(--red);background:rgba(244,117,111,.15);" title="This card is set to be paid on the ${card.pay_period}, but it has entries in this period">⚠ normally a ${card.pay_period} card</span>` : ''}</span></h3>
        <div style="display:flex;align-items:center;gap:14px;">
          <span class="total">${PESO(total)}</span>
          <button class="btn secondary" data-add="${card.id}" style="padding:6px 12px;font-size:13px;" title="Full form: type and Justine's split">+ Add with split</button>
        </div>
      </div>
      ${(rows.length || virtualRows.length) ? `<table>
        <thead><tr><th>Description</th><th>Type</th><th>Split</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>
          ${virtualRows.map(e => {
            const jShare = e.amount - e.wifey_share;
            let splitHtml;
            const who = escapeHtml(e.holder);
            if (e.wifey_share <= 0) splitHtml = '<span style="color:var(--text-dim);font-size:12px;">All Joven\'s</span>';
            else if (jShare <= 0) splitHtml = `<span class="pill" style="background:rgba(167,139,250,.15);color:var(--purple);">All ${possessive(who)}</span>`;
            else splitHtml = `<span style="font-size:12px;">You ${PESO(jShare)} <span style="color:var(--purple);">+ ${who} ${PESO(e.wifey_share)}</span></span>`;
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
            const isCredit = Number(t.amount) < 0;
            let splitHtml;
            if (wShare === 0) splitHtml = '<span style="color:var(--text-dim);font-size:12px;">All Joven\'s</span>';
            else if (jShare === 0) splitHtml = '<span class="pill" style="background:rgba(167,139,250,.15);color:var(--purple);">All Justine\'s</span>';
            else splitHtml = `<span style="font-size:12px;">You ${PESO(jShare)} <span style="color:var(--purple);">+ Justine ${PESO(wShare)}</span></span>`;
            return `
            <tr>
              <td>${escapeHtml(t.description)}</td>
              <td>${isCredit ? '<span class="pill credit" title="Negative amount - cashback, points or a refund; it lowers this card\'s total">Credit</span>' : `<span class="pill ${t.kind}">${t.kind === 'bill' ? 'Bill' : 'Payment plan'}</span>`}</td>
              <td>${splitHtml}</td>
              <td class="num"${isCredit ? ' style="color:var(--green);"' : ''}>${PESO(t.amount)}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="icon-btn edit" data-edit-txn="${t.id}" title="Edit" aria-label="Edit">✎</button>
                <button class="icon-btn" data-del-txn="${t.id}" title="Delete" aria-label="Delete">✕</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state" style="padding:14px;font-size:13px;">No transactions yet for this card in this period.</div>`}
      <form class="quick-add" data-quick="${card.id}" autocomplete="off">
        <input type="text" data-quick-desc placeholder="Quick add — description" aria-label="Description">
        <input type="number" step="0.01" data-quick-amt placeholder="Amount" aria-label="Amount" inputmode="decimal">
        <button type="submit" class="btn secondary">Add ↵</button>
      </form>
    `;
    wrap.appendChild(sec);
  });
  $$('[data-edit-inst-sched]').forEach(b => b.onclick = () => {
    const inst = state.installments.find(x => x.id === b.dataset.editInstSched);
    if (inst) openScheduleModal(inst);
  });

  // Quick add: type, Enter, type the next one. Saves as a plain bill that's all
  // yours (use the pencil or "+ Add with split" for anything else). The new row
  // is added locally instead of reloading everything, so it's instant.
  $$('form[data-quick]').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const desc = f.querySelector('[data-quick-desc]');
    const amt = f.querySelector('[data-quick-amt]');
    const description = desc.value.trim();
    const amount = +amt.value;
    if (!description) { desc.focus(); return; }
    if (!amt.value || !amount) { amt.focus(); return; }
    const btn = f.querySelector('button');
    btn.disabled = true;
    const res = await db.from('transactions').insert({
      description, amount, kind: 'bill', wifey_share: 0, card_id: f.dataset.quick, period_id: period.id,
    }).select().single();
    if (!dbOk(res) || !res.data) { btn.disabled = false; return; }
    state.transactions.push(res.data);
    state.quickFocusCardId = f.dataset.quick;
    renderTransactions();
  });
  if (state.quickFocusCardId) {
    const next = $(`form[data-quick="${state.quickFocusCardId}"] [data-quick-desc]`);
    state.quickFocusCardId = null;
    if (next) next.focus();
  }

  $$('[data-add]').forEach(b => b.onclick = () => openTxnModal(null, b.dataset.add, period.id));
  $$('[data-edit-txn]').forEach(b => b.onclick = () => {
    const t = state.transactions.find(x => x.id === b.dataset.editTxn);
    openTxnModal(t, t.card_id, t.period_id);
  });
  $$('[data-del-txn]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this transaction?')) return;
    if (!dbOk(await db.from('transactions').delete().eq('id', b.dataset.delTxn))) return;
    state.transactions = state.transactions.filter(t => t.id !== b.dataset.delTxn);
    renderView();
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
    if (error) { toast(error.message, { error: true }); return; }
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
    <p style="font-size:12px;color:var(--text-dim);margin-top:-4px;">Cashback, redeemed points or a refund? Enter it as a negative amount (e.g. -750). It lowers the card's total.</p>
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
    // Credits (cashback, points, refunds) are negative; Justine's share then
    // has to be negative too, between 0 and the amount.
    const shareOk = amount >= 0 ? (wifeyShare >= 0 && wifeyShare <= amount) : (wifeyShare <= 0 && wifeyShare >= amount);
    if (!shareOk) { toast(`Justine's share has to be between ₱0 and ${PESO(amount)}`, { error: true }); return; }
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
    if (error) { toast(error.message, { error: true }); return; }
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
  const remaining = schedule.filter(r => !isRowPaid(r)).reduce((s, r) => s + totalAmountForRow(i, r), 0);
  const paidCount = schedule.filter(r => isRowPaid(r)).length;
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
  const more = $('#install-dashboard-more');
  more.innerHTML = '';
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
  // On Joven's side a plan can be shared with Justine or anyone else, so name
  // whoever is actually involved instead of assuming Justine.
  const sharers = [...new Set(list.filter(x => Number(x.wifey_monthly_share || 0) > 0 || Number(x.wifey_fee_share || 0) > 0).map(shareHolder))];
  const counterpartLabel = sharers.length ? sharers.join(', ') : defaultSharerFor(state.profile);
  const theirs = sharers.length > 1 ? 'Their' : possessive(counterpartLabel);
  const counterpartMonthly = activeMetrics.reduce((s, x) => s + Number(x.i.wifey_monthly_share || 0), 0);
  const counterpartRemaining = metricsList.reduce((s, x) => {
    const cpRem = x.m.schedule.filter(r => !isRowPaid(r)).reduce((ss, r) => ss + totalWifeyShareForRow(x.i, r), 0);
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

  // Payoff timeline - one row per month, listing the plans whose LAST payment
  // falls in that month, how much monthly obligation that frees up, and what
  // you're still carrying per month afterward (the bar shrinks toward zero).
  const timelineItems = activeMetrics.filter(x => x.m.endDate).sort((a, b) => a.m.endDate.localeCompare(b.m.endDate));
  let timelineHtml = `<div class="empty-state" style="padding:16px;font-size:13px;">Nothing active to project.</div>`;
  if (timelineItems.length) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startingMonthly = timelineItems.reduce((s, x) => s + x.m.monthly, 0);
    const byEndMonth = new Map();
    timelineItems.forEach(x => {
      const mk = monthKey(x.m.endDate);
      if (!byEndMonth.has(mk)) byEndMonth.set(mk, []);
      byEndMonth.get(mk).push(x);
    });
    let stillCarrying = startingMonthly;
    const monthRows = Array.from(byEndMonth.keys()).sort().map(mk => {
      const plans = byEndMonth.get(mk);
      const freed = plans.reduce((s, x) => s + x.m.monthly, 0);
      stillCarrying = Math.max(stillCarrying - freed, 0);
      const isLast = stillCarrying < 0.005;
      const [y, mo] = mk.split('-').map(Number);
      const monthsAway = (y - today.getFullYear()) * 12 + (mo - 1 - today.getMonth());
      const awayLabel = monthsAway <= 0 ? 'this month' : monthsAway === 1 ? 'next month' : `in ${monthsAway} months`;
      const leftPct = startingMonthly > 0 ? (stillCarrying / startingMonthly) * 100 : 0;
      return `
        <div class="payoff-month${isLast ? ' payoff-last' : ''}">
          <div class="payoff-when">
            <div class="payoff-mon">${new Date(y, mo - 1, 1).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}</div>
            <div class="payoff-away">${awayLabel}</div>
          </div>
          <div class="payoff-plans">
            ${plans.map(({ i, m }) => `
              <span class="payoff-chip">
                <span class="sw" style="background:${m.card ? m.card.color : 'var(--blue)'}"></span>
                <span class="payoff-chip-name">${escapeHtml(i.name)}</span>
                <span class="payoff-chip-bank">${m.card ? escapeHtml(m.card.name) : 'General Ledger'}</span>
                <span class="payoff-chip-amt">${PESO(m.monthly)}</span>
              </span>`).join('')}
          </div>
          <div class="payoff-impact">
            <div class="payoff-freed">+${PESO(freed)}/mo freed</div>
            <div class="payoff-track"><div class="payoff-fill" style="width:${leftPct}%"></div></div>
            <div class="payoff-left">${isLast ? '🎉 Debt-free' : `${PESO(stillCarrying)}/mo still to pay`}</div>
          </div>
        </div>`;
    }).join('');
    timelineHtml = `
      <div class="payoff-start">Today: <b>${PESO(startingMonthly)}/mo</b> across ${timelineItems.length} active plan${timelineItems.length === 1 ? '' : 's'}</div>
      ${monthRows}`;
  }

  // Above the plan list: just the four numbers you check most.
  wrap.innerHTML = `
    <div class="dash-stats">
      <div class="stat-card"><div class="stat-label">Active plans</div><div class="stat-value">${activeMetrics.length}</div></div>
      <div class="stat-card"><div class="stat-label">Outstanding balance</div><div class="stat-value">${PESO(totalOutstanding)}</div></div>
      <div class="stat-card"><div class="stat-label">Monthly obligation</div><div class="stat-value">${PESO(totalMonthlyObligation)}</div></div>
      <div class="stat-card"><div class="stat-label">Debt-free by</div><div class="stat-value">${debtFreeDate ? new Date(debtFreeDate + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : '—'}</div></div>
    </div>
  `;

  // Below the plan list: the payoff timeline, then everything else folded away.
  more.innerHTML = `
    <div class="dash-timeline" style="margin-top:22px;">
      <h4>Payoff timeline <span>what finishes each month, and what that frees up</span></h4>
      ${timelineHtml}
    </div>

    <details class="dash-more" id="dash-more" ${pref('dash_more_open', false) ? 'open' : ''}>
    <summary>More stats, split with ${counterpartLabel} &amp; bank rankings</summary>
    <div class="dash-stats">
      <div class="stat-card"><div class="stat-label">Debt-to-income (net)</div><div class="stat-value">${dtiNet !== null ? dtiNet.toFixed(1) + '%' : '—'}</div><div class="stat-note">${dtiNet !== null ? `net of shared portions` : 'add a period first'}</div></div>
      <div class="stat-card"><div class="stat-label">Avg plan rate</div><div class="stat-value">${avgPlanRate.toFixed(1)}%</div><div class="stat-note">mean across plans</div></div>
      <div class="stat-card"><div class="stat-label">Cost of credit</div><div class="stat-value">${costOfCredit.toFixed(1)}%</div><div class="stat-note">₱-weighted overall</div></div>
      <div class="stat-card"><div class="stat-label">Paid off so far</div><div class="stat-value">${overallPaidPct.toFixed(1)}%</div><div class="stat-note">of lifetime total</div></div>
    </div>

    <div class="dash-timeline" style="margin-bottom:22px;">
      <h4>Split with ${counterpartLabel} <span>how much of these plans is actually theirs, not yours</span></h4>
      <div class="dash-stats" style="margin-bottom:0;">
        <div class="stat-card"><div class="stat-label">Your net monthly</div><div class="stat-value">${PESO(yourNetMonthly)}</div><div class="stat-note">what you actually carry</div></div>
        <div class="stat-card"><div class="stat-label">${theirs} monthly share</div><div class="stat-value">${PESO(counterpartMonthly)}</div><div class="stat-note">owed back to you each period</div></div>
        <div class="stat-card"><div class="stat-label">Your net outstanding</div><div class="stat-value">${PESO(yourNetOutstanding)}</div></div>
        <div class="stat-card"><div class="stat-label">${sharers.length > 1 ? 'They owe' : counterpartLabel + ' owes'} (remaining)</div><div class="stat-value">${PESO(counterpartRemaining)}</div></div>
        <div class="stat-card"><div class="stat-label">${theirs} lifetime share</div><div class="stat-value">${PESO(counterpartLifetime)}</div><div class="stat-note">across all these plans, paid + unpaid</div></div>
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
    </details>
  `;
  $('#dash-more').ontoggle = e => setPref('dash_more_open', e.target.open);
}

// "Next due" = the first upcoming row that isn't paid yet (overdue rows get
// their own red badge instead).
function nextDueRowId(schedule) {
  const next = schedule.find(r => rowStatus(r) === 'upcoming');
  return next ? next.id : null;
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
    <div id="install-dashboard-more"></div>
  `;
  $('#add-install-btn').onclick = () => openInstallModal();
  $('#toggle-dashboard').onclick = () => {
    state.showInstallDashboard = !state.showInstallDashboard;
    setPref('show_install_dash', state.showInstallDashboard);
    renderInstallments();
  };
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
    const paidCount = schedule.filter(r => isRowPaid(r)).length;
    const overdueCount = schedule.filter(r => rowStatus(r) === 'overdue').length;
    const pct = schedule.length ? Math.round((paidCount / schedule.length) * 100) : 0;
    const done = schedule.length > 0 && paidCount >= schedule.length;
    const nextId = nextDueRowId(schedule);
    const lastRow = schedule[schedule.length - 1];
    const totalToPay = schedule.reduce((s, r) => s + totalAmountForRow(i, r), 0);
    const principal = Number(i.principal) || 0;
    const interest = Math.max(totalToPay - principal, 0);
    const interestPct = totalToPay > 0 ? Math.round((interest / totalToPay) * 100) : 0;
    // What's still unpaid on this plan (follows the Paid ticks in "View schedule"),
    // and how much of that is the other person's share.
    const unpaidRows = schedule.filter(r => !isRowPaid(r));
    const leftToPay = unpaidRows.reduce((s2, r) => s2 + totalAmountForRow(i, r), 0);
    const leftShare = unpaidRows.reduce((s2, r) => s2 + totalWifeyShareForRow(i, r), 0);
    const selfName = i.owner === 'justine' ? 'Justine' : 'Joven';

    const el = document.createElement('div');
    el.className = 'install-item' + (done ? ' done' : '');
    if (i.archived) el.style.opacity = '.6';
    el.innerHTML = `
      <div class="name">${escapeHtml(i.name)}</div>
      <div class="meta card-chip"><span class="sw" style="background:${card ? card.color : 'var(--blue)'}"></span>${card ? card.name : 'General Ledger'} • ${PESO(i.monthly_amount)}/mo${Number(i.wifey_monthly_share) > 0 ? ` • <span style="color:var(--purple);">${escapeHtml(shareHolder(i))} pays ${PESO(i.wifey_monthly_share)}${collectsFrom(i) ? ` (from ${escapeHtml(collectsFrom(i))})` : ''}</span>` : ''}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${done ? 'var(--green)' : 'var(--gold)'}"></div></div>
      <div class="foot">
        <span>${done ? 'Completed' : `${paidCount} of ${schedule.length} paid`}${overdueCount ? ` <b style="color:var(--red);">· ${overdueCount} overdue</b>` : ''}</span>
        <span class="end">${done ? '✓ Paid off' : lastRow ? 'ends ' + new Date(lastRow.due_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : ''}</span>
      </div>
      ${!done && leftToPay > 0 ? `
      <div class="left-to-pay">
        <span>Left to pay <em>${unpaidRows.length} payment${unpaidRows.length === 1 ? '' : 's'}</em></span>
        <b>${PESO(leftToPay)}</b>
      </div>
      ${leftShare > 0 ? `<div class="left-split">${selfName} ${PESO(leftToPay - leftShare)} · <span style="color:var(--purple);">${escapeHtml(shareHolder(i))} ${PESO(leftShare)}</span></div>` : ''}` : ''}
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
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn secondary" data-view-sched="${i.id}" style="padding:6px 12px;font-size:12px;">View schedule</button>
          ${itemsForInstallment(i.id).length ? `<button class="btn secondary" data-view-items="${i.id}" style="padding:6px 12px;font-size:12px;" title="See and copy the item breakdown">🧾 Breakdown (${itemsForInstallment(i.id).length})</button>` : ''}
        </div>
        <div>
          ${i.archived ? `
            <button class="icon-btn edit" data-restore-i="${i.id}" title="Restore" aria-label="Restore">♻️</button>
            <button class="icon-btn" data-del-i="${i.id}" title="Delete permanently" aria-label="Delete permanently">✕</button>
          ` : `
            <button class="icon-btn edit" data-edit-i="${i.id}" title="Edit" aria-label="Edit">✎</button>
            <button class="icon-btn" data-archive-i="${i.id}" title="Archive" aria-label="Archive">📦</button>
          `}
        </div>
      </div>
    `;
    grid.appendChild(el);
  });
  $$('[data-edit-i]').forEach(b => b.onclick = () => openInstallModal(state.installments.find(x => x.id === b.dataset.editI)));
  $$('[data-view-sched]').forEach(b => b.onclick = () => openScheduleModal(state.installments.find(x => x.id === b.dataset.viewSched)));
  $$('[data-view-items]').forEach(b => b.onclick = () => openBreakdownModal(state.installments.find(x => x.id === b.dataset.viewItems)));
  $$('[data-archive-i]').forEach(b => b.onclick = () => setArchived('installments', b.dataset.archiveI, true, 'Installment'));
  $$('[data-restore-i]').forEach(b => b.onclick = () => setArchived('installments', b.dataset.restoreI, false, 'Installment'));
  $$('[data-del-i]').forEach(b => b.onclick = async () => {
    if (!confirm('Permanently delete this installment plan and its schedule? This can\'t be undone.')) return;
    if (!dbOk(await db.from('installments').delete().eq('id', b.dataset.delI), 'Installment deleted')) return;
    await loadAll(); renderView();
  });
}

async function regenerateSchedule(inst) {
  if (!dbOk(await db.from('installment_schedule').delete().eq('installment_id', inst.id))) return;
  const rows = generateScheduleRows(inst).map((r, idx) => ({
    installment_id: inst.id, due_date: r.due_date, amount: r.amount, wifey_share: r.wifey_share, is_fee_row: idx === 0,
  }));
  if (rows.length) dbOk(await db.from('installment_schedule').insert(rows));
}

function openScheduleModal(inst) {
  const schedule = scheduleForInstallment(inst.id);
  const nextId = nextDueRowId(schedule);
  const counterpartLabel = `${possessive(escapeHtml(shareHolder(inst)))} share`;
  // The Paid column only appears once migration_schedule_paid.sql has been run.
  const hasPaidCol = state.installmentSchedule.some(r => 'paid' in r);
  const inputStyle = 'width:100px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;text-align:right;';
  showModal(`
    <h3>${escapeHtml(inst.name)} — schedule</h3>
    <p style="font-size:12px;color:var(--text-dim);margin-top:-8px;">${hasPaidCol
      ? `Rows tick themselves as paid once the due date passes. Untick one you missed (it turns red and counts as still owed), or tick a future one you paid early.`
      : `Green = already paid (by date). Gold = next due.`} Edit ${counterpartLabel.toLowerCase()} per period if it ever changes.</p>
    <div style="max-height:50vh;overflow-y:auto;">
    <table>
      <thead><tr>${hasPaidCol ? '<th>Paid</th>' : ''}<th>Due</th><th class="num">Amount</th><th class="num">${counterpartLabel}</th></tr></thead>
      <tbody id="sched-body">
        ${schedule.map(r => {
          const status = rowStatus(r);
          const isNext = r.id === nextId;
          const rowColor = status === 'paid' ? 'rgba(79,216,151,.08)' : status === 'overdue' ? 'rgba(244,117,111,.10)' : isNext ? 'rgba(227,177,88,.12)' : 'transparent';
          const badge = status === 'overdue' ? '<span class="synced-badge" style="color:var(--red);background:rgba(244,117,111,.15);">overdue</span>'
            : isNext ? '<span class="synced-badge" style="color:var(--gold);background:rgba(227,177,88,.15);">next due</span>'
            : status === 'paid' ? '<span class="synced-badge">paid</span>' : '';
          return `
          <tr style="background:${rowColor};">
            ${hasPaidCol ? `<td><input type="checkbox" data-row-id="${r.id}" data-field="paid" ${status === 'paid' ? 'checked' : ''} aria-label="Paid" style="width:18px;height:18px;accent-color:var(--green);cursor:pointer;"></td>` : ''}
            <td>${new Date(r.due_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })} ${badge}${r.is_fee_row && Number(inst.fee) > 0 ? ` <span class="synced-badge" style="color:var(--red);background:rgba(244,117,111,.15);">+₱${Number(inst.fee).toFixed(2)} fee</span>` : ''}</td>
            <td class="num">
              <input type="number" step="0.01" data-row-id="${r.id}" data-field="amount" value="${r.amount}" style="${inputStyle}">
              ${r.is_fee_row && Number(inst.fee) > 0 ? `<div style="font-size:10px;color:var(--text-dim);margin-top:3px;">= ${PESO(totalAmountForRow(inst, r))} total w/ fee</div>` : ''}
            </td>
            <td class="num">
              <input type="number" step="0.01" data-row-id="${r.id}" data-field="wifey_share" value="${r.wifey_share}" style="${inputStyle}">
              ${r.is_fee_row && Number(inst.wifey_fee_share) > 0 ? `<div style="font-size:10px;color:var(--text-dim);margin-top:3px;">= ${PESO(totalWifeyShareForRow(inst, r))} total w/ fee</div>` : ''}
            </td>
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
    // Only rows you actually changed get written, all at once.
    const updates = [];
    schedule.forEach(r => {
      const amount = +$(`#sched-body input[data-row-id="${r.id}"][data-field="amount"]`).value || 0;
      const wifey_share = +$(`#sched-body input[data-row-id="${r.id}"][data-field="wifey_share"]`).value || 0;
      const patch = {};
      if (amount !== Number(r.amount)) patch.amount = amount;
      if (wifey_share !== Number(r.wifey_share || 0)) patch.wifey_share = wifey_share;
      if (hasPaidCol) {
        const checked = $(`#sched-body input[data-row-id="${r.id}"][data-field="paid"]`).checked;
        // Store an explicit value only when it differs from the by-date default,
        // so untouched future rows keep ticking themselves when their date passes.
        const paid = checked === datePassed(r.due_date) ? null : checked;
        if (paid !== (r.paid === undefined ? null : r.paid)) patch.paid = paid;
      }
      if (Object.keys(patch).length) updates.push(db.from('installment_schedule').update(patch).eq('id', r.id));
    });
    if (!updates.length) { closeModal(); return; }
    $('#modal-save').disabled = true;
    const results = await Promise.all(updates);
    const failed = results.find(res => res.error);
    if (failed) { dbOk(failed); $('#modal-save').disabled = false; await loadAll(); return; }
    closeModal(); await loadAll(); renderView();
    toast(`Schedule saved (${updates.length} row${updates.length === 1 ? '' : 's'})`);
  };
}

function itemsForInstallment(installId) {
  return (state.installmentItems || []).filter(x => x.installment_id === installId).sort((a, b) => a.sort_order - b.sort_order);
}

// Plain-text breakdown, ready to paste into Messenger / Viber / SMS.
function breakdownText(inst) {
  const items = itemsForInstallment(inst.id);
  const card = state.cards.find(c => c.id === inst.card_id);
  const schedule = scheduleForInstallment(inst.id);
  const sharer = shareHolder(inst);
  const total = items.reduce((s, x) => s + Number(x.amount), 0);
  const monthLabel = d => new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
  const lines = [
    `${inst.name}${card ? ` (${card.name} installment)` : ''}`,
    ...items.map(x => `• ${x.label}: ${PESO(x.amount)} (${x.owner})`),
    `Total: ${PESO(total)}`,
  ];
  const sharerAmt = items.filter(x => (x.owner || '').toLowerCase() === sharer.toLowerCase()).reduce((s, x) => s + Number(x.amount), 0);
  if (sharerAmt > 0 && total > 0) {
    const lifetime = schedule.reduce((s, r) => s + totalWifeyShareForRow(inst, r), 0);
    const paid = schedule.filter(isRowPaid).reduce((s, r) => s + totalWifeyShareForRow(inst, r), 0);
    const monthsLeft = schedule.filter(r => !isRowPaid(r)).length;
    lines.push('', `${possessive(sharer)} part: ${PESO(sharerAmt)} (${(sharerAmt / total * 100).toFixed(1)}%)`);
    if (schedule.length) {
      lines.push(`${PESO(inst.wifey_monthly_share)}/month × ${schedule.length} months (${monthLabel(schedule[0].due_date)} to ${monthLabel(schedule[schedule.length - 1].due_date)})`);
      if (Number(inst.wifey_fee_share) > 0) lines.push(`+ ${PESO(inst.wifey_fee_share)} of the processing fee on the first payment`);
      lines.push(`Total: ${PESO(lifetime)} · Paid so far: ${PESO(paid)} · Remaining: ${PESO(lifetime - paid)}${monthsLeft ? ` (${monthsLeft} month${monthsLeft === 1 ? '' : 's'} left)` : ''}`);
    }
  }
  return lines.join('\n');
}

function openBreakdownModal(inst) {
  const items = itemsForInstallment(inst.id);
  const sharer = shareHolder(inst);
  const total = items.reduce((s, x) => s + Number(x.amount), 0);
  const text = breakdownText(inst);
  showModal(`
    <h3>${escapeHtml(inst.name)} — breakdown</h3>
    <table>
      <thead><tr><th>Item</th><th>Owner</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${items.map(x => `<tr><td>${escapeHtml(x.label)}</td><td>${escapeHtml(x.owner)}</td><td class="num">${PESO(x.amount)}</td></tr>`).join('')}
        <tr><td colspan="2" style="font-weight:700;">Total</td><td class="num" style="font-weight:700;">${PESO(total)}</td></tr>
      </tbody>
    </table>
    <label style="display:block;font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.4px;margin:16px 0 6px;">What gets copied</label>
    <textarea id="breakdown-text" readonly class="breakdown-text">${escapeHtml(text)}</textarea>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Close</button>
      <button class="btn" id="copy-breakdown-btn">📋 Copy for ${escapeHtml(sharer)}</button>
    </div>
  `);
  const ta = $('#breakdown-text');
  ta.style.height = Math.min(ta.scrollHeight + 4, 320) + 'px';
  $('#copy-breakdown-btn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied — paste it in Messenger or Viber');
    } catch (e) {
      // Older browsers / no clipboard permission: select it so Cmd/Ctrl+C works.
      ta.focus(); ta.select();
      toast('Press Cmd+C (or Ctrl+C) to copy the selected text');
    }
  };
}

function openInstallModal(item) {
  const isEdit = !!item;
  const i = item || {
    card_id: state.cards[0]?.id || '', name: '', principal: '', fee: 0, monthly_amount: '', start_date: '',
    num_months: 12, payer: '', wifey_monthly_share: 0, wifey_fee_share: 0,
  };
  // "Shared with" only exists on Joven's side, and only once
  // migration_installment_share_with.sql has been run.
  const hasShareWithCol = state.installments.some(x => 'share_with' in x);
  const defaultSharer = defaultSharerFor(state.profile);
  // No pre-filled name: a new plan starts with "Shared with" empty. An existing
  // plan shows who it's shared with - its saved name, or the other spouse for
  // older plans that have a share but were saved before names were stored.
  const hasAnyShare = Number(i.wifey_monthly_share || 0) > 0 || Number(i.wifey_fee_share || 0) > 0;
  const holderNow = (i.share_with || '').trim() || (isEdit && hasAnyShare ? defaultSharerFor(i.owner || state.profile) : '');
  const knownSharers = [...new Set([defaultSharer, ...state.installments.filter(x => x.owner === state.profile).map(shareHolder),
    ...state.installments.map(x => (x.collect_from || '').trim()).filter(Boolean)])];
  // "collects it from" only once migration_installment_collect_from.sql has been run.
  const hasCollectCol = hasShareWithCol && state.installments.some(x => 'collect_from' in x);
  const counterpartLabel = escapeHtml(possessive(holderNow || defaultSharerFor(state.profile)));
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
    </div>
    ${hasShareWithCol ? `
    <div class="field-row">
      <div class="field"><label>Shared with</label>
        <input type="text" id="f-sharewith" list="sharer-list" value="${escapeHtml(holderNow)}" placeholder="Leave blank if it's all yours">
        <datalist id="sharer-list">${knownSharers.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
      </div>
    </div>
    <p style="font-size:12px;color:var(--text-dim);margin-top:-4px;">${state.profile === 'joven'
      ? "Justine's share goes into her total (paid on the 30th). Anyone else's share shows up automatically as money in on the period it's due."
      : "Joven's share is what Joven covers - it comes off the Joven CC Total. Anyone else's share shows up automatically as money in on the month it's due."}</p>` : ''}
    ${hasCollectCol ? `
    <div class="field-row" id="collect-row">
      <div class="field"><label>${defaultSharer} collects it from <span style="text-transform:none;letter-spacing:0;">(optional)</span></label>
        <input type="text" id="f-collect" list="sharer-list" value="${escapeHtml((i.collect_from || '').trim())}" placeholder="Leave blank if ${defaultSharer} pays it">
      </div>
    </div>
    <p id="collect-help" style="font-size:12px;color:var(--text-dim);margin-top:-4px;">${state.profile === 'joven'
      ? "If someone pays Justine back for her share (e.g. Tanie), Justine still pays you the full share, and that person's payment shows up on <b>Justine's</b> Money in."
      : "If someone pays Joven back for Joven's share, Joven still covers it here, and that person's payment shows up on <b>Joven's</b> Money in."}</p>` : ''}
    <div class="field-row" id="feeshare-row">
      <div class="field"><label><span data-sharer-label>${counterpartLabel}</span> share of the fee</label><input type="number" step="0.01" id="f-feeshare" value="${i.wifey_fee_share}"></div>
    </div>
    <div id="feeshare-warn" class="feeshare-warn" style="display:none;"></div>
    <div class="field-row">
      <div class="field"><label>Monthly amount</label><input type="number" step="0.01" id="f-monthly" value="${i.monthly_amount}"></div>
      <div class="field"><label># of months</label><input type="number" id="f-months" value="${i.num_months}"></div>
      <div class="field" id="monthlyshare-field"><label><span data-sharer-label>${counterpartLabel}</span> share (per month)</label><input type="number" step="0.01" id="f-monthlyshare" value="${i.wifey_monthly_share}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Start date</label><input type="date" id="f-start" value="${i.start_date}"></div>
      <div class="field"><label>Payer / note</label><input type="text" id="f-payer" value="${i.payer ? escapeHtml(i.payer) : ''}" placeholder="e.g. Justine"></div>
    </div>
    ${state.itemsTableOk ? `
    <div class="items-block">
      <div class="items-head">Breakdown <span>optional · what's in this plan and whose it is</span></div>
      <div id="items-rows"></div>
      <datalist id="item-owner-list"></datalist>
      <button type="button" class="btn secondary" id="add-item-btn" style="padding:6px 12px;font-size:12px;">+ Add item</button>
      <div id="items-summary"></div>
    </div>` : ''}
    ${isEdit ? `<p style="font-size:12px;color:var(--text-dim);">Changing amount/months/start date regenerates the schedule and resets any per-period edits you made in "View schedule".</p>` : ''}
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);

  // ---- Share of the fee: only shown when there's a fee (or a value already
  // sits there), with a one-click fix when a monthly share was typed into it.
  // The fee share is added to the FIRST payment only, so on a ₱0 fee it's
  // almost always a mistake. ----
  const sharerNow = () => hasShareWithCol ? $('#f-sharewith').value.trim() : (holderNow || defaultSharer);
  const syncFeeShare = () => {
    const fee = +$('#f-fee').value || 0, fs = +$('#f-feeshare').value || 0;
    const shared = !!sharerNow();
    $('#feeshare-row').style.display = shared && (fee > 0 || fs > 0) ? '' : 'none';
    $('#monthlyshare-field').style.display = shared ? '' : 'none';
    const w = $('#feeshare-warn');
    if (!shared) {
      w.style.display = 'none';
    } else if (fee === 0 && fs > 0) {
      w.innerHTML = `⚠ The fee is ₱0, so this ${PESO(fs)} only gets added to the <b>first payment</b>. Meant to be the monthly share? <button type="button" class="fc-use" id="move-feeshare">Move it to per month</button>`;
      w.style.display = '';
      $('#move-feeshare').onclick = () => { $('#f-monthlyshare').value = fs; $('#f-feeshare').value = 0; syncFeeShare(); };
    } else if (fee > 0 && fs > fee) {
      w.textContent = `⚠ Can't be more than the fee itself (${PESO(fee)}).`;
      w.style.display = '';
    } else {
      w.style.display = 'none';
    }
  };
  $('#f-fee').addEventListener('input', syncFeeShare);
  $('#f-feeshare').addEventListener('input', syncFeeShare);
  syncFeeShare();

  // ---- Breakdown: items, each with an owner. The shared person's slice of
  // the item total sets their monthly + fee share automatically. ----
  const selfName = state.profile === 'joven' ? 'Joven' : 'Justine';
  const currentSharer = sharerNow;
  let items = state.itemsTableOk && isEdit ? itemsForInstallment(i.id).map(x => ({ label: x.label, owner: x.owner, amount: x.amount })) : [];
  const renderItemRows = () => {
    if (!state.itemsTableOk) return;
    $('#item-owner-list').innerHTML = [...new Set([selfName, currentSharer(), ...knownSharers])].map(n => `<option value="${escapeHtml(n)}">`).join('');
    $('#items-rows').innerHTML = items.map((it, idx) => `
      <div class="item-row">
        <input type="text" data-item="${idx}" data-k="label" value="${escapeHtml(it.label || '')}" placeholder="Item" aria-label="Item">
        <input type="text" data-item="${idx}" data-k="owner" value="${escapeHtml(it.owner || '')}" list="item-owner-list" placeholder="Owner" aria-label="Owner">
        <input type="number" step="0.01" data-item="${idx}" data-k="amount" value="${it.amount ?? ''}" placeholder="Amount" aria-label="Amount">
        <button type="button" class="icon-btn" data-del-item-row="${idx}" title="Remove item" aria-label="Remove item">✕</button>
      </div>`).join('');
    $$('#items-rows input').forEach(inp => inp.oninput = () => {
      const it = items[+inp.dataset.item];
      it[inp.dataset.k] = inp.dataset.k === 'amount' ? inp.value : inp.value;
      updateItemsSummary(true);
    });
    $$('[data-del-item-row]').forEach(b => b.onclick = () => { items.splice(+b.dataset.delItemRow, 1); renderItemRows(); updateItemsSummary(true); });
  };
  const updateItemsSummary = (applyShares) => {
    if (!state.itemsTableOk) return;
    const wrap = $('#items-summary');
    const filled = items.filter(it => Number(it.amount) > 0);
    if (!filled.length) { wrap.innerHTML = ''; return; }
    const sharer = currentSharer();
    const total = filled.reduce((s2, it) => s2 + Number(it.amount), 0);
    const byOwner = new Map();
    filled.forEach(it => {
      const name = (it.owner || '').trim() || selfName;
      const key = name.toLowerCase();
      if (!byOwner.has(key)) byOwner.set(key, { name, amount: 0 });
      byOwner.get(key).amount += Number(it.amount);
    });
    const sharerAmt = sharer ? (byOwner.get(sharer.toLowerCase()) || { amount: 0 }).amount : 0;
    const ratio = total > 0 ? sharerAmt / total : 0;
    const monthly = +$('#f-monthly').value || 0;
    const fee = +$('#f-fee').value || 0;
    const shareMonthly = round2(monthly * ratio);
    const shareFee = round2(fee * ratio);
    if (applyShares && sharer) {
      $('#f-monthlyshare').value = shareMonthly;
      $('#f-feeshare').value = shareFee;
      syncFeeShare();
    }
    const principal = +$('#f-principal').value || 0;
    const diff = round2(total - principal);
    const strangers = [...byOwner.values()].filter(o => ![selfName.toLowerCase(), sharer.toLowerCase()].includes(o.name.toLowerCase()));
    wrap.innerHTML = `
      <div class="items-total">
        <span>Items total <b>${PESO(total)}</b></span>
        ${principal ? (Math.abs(diff) < 0.01 ? `<span class="ok">✓ matches principal</span>` : `<span class="warn">${PESO(Math.abs(diff))} ${diff < 0 ? 'short of' : 'over'} principal</span>`) : ''}
      </div>
      <div class="items-owners">${[...byOwner.values()].map(o => `<span>${escapeHtml(o.name)} <b>${PESO(o.amount)}</b> (${(o.amount / total * 100).toFixed(1)}%)</span>`).join('')}</div>
      ${sharer ? `<div class="items-share">→ ${escapeHtml(possessive(sharer))} share: <b>${PESO(shareMonthly)}/mo</b>${fee ? ` + <b>${PESO(shareFee)}</b> of the fee` : ''} <span>(filled in above — you can still type over it)</span></div>` : ''}
      ${strangers.length ? `<div class="warn" style="margin-top:6px;">${sharer ? `Only ${escapeHtml(sharer)}'s items count toward the share — ` : 'Nobody is in "Shared with", so this plan is all yours — '}${strangers.map(o => escapeHtml(o.name)).join(', ')} ${strangers.length === 1 ? "isn't" : "aren't"} this plan's "Shared with".</div>` : ''}`;
  };
  if (state.itemsTableOk) {
    $('#add-item-btn').onclick = () => {
      items.push({ label: '', owner: items.length ? '' : currentSharer(), amount: '' });
      renderItemRows();
      const rows = $$('#items-rows .item-row');
      rows[rows.length - 1].querySelector('input').focus();
    };
    ['#f-monthly', '#f-fee'].forEach(sel => $(sel).addEventListener('input', () => updateItemsSummary(true)));
    $('#f-principal').addEventListener('input', () => updateItemsSummary(false));
    renderItemRows();
    updateItemsSummary(false);
  }

  // "collects it from" only applies when the share is the other spouse's.
  const syncCollectRow = () => {
    if (!hasCollectCol) return;
    const isSpouse = $('#f-sharewith').value.trim().toLowerCase() === defaultSharer.toLowerCase();
    $('#collect-row').style.display = isSpouse ? '' : 'none';
    $('#collect-help').style.display = isSpouse ? '' : 'none';
  };
  if (hasShareWithCol) {
    $('#f-sharewith').oninput = () => {
      const name = $('#f-sharewith').value.trim();
      if (name) $$('[data-sharer-label]').forEach(el => el.textContent = possessive(name));
      syncFeeShare();
      syncCollectRow();
      renderItemRows();
      updateItemsSummary(true);
    };
    syncCollectRow();
  }
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
    if (hasShareWithCol) {
      const who = $('#f-sharewith').value.trim();
      payload.share_with = who || null;
      if (!who) { payload.wifey_monthly_share = 0; payload.wifey_fee_share = 0; } // not shared = all yours
      if (hasCollectCol) payload.collect_from = who && who.toLowerCase() === defaultSharer.toLowerCase() ? ($('#f-collect').value.trim() || null) : null;
    }
    if (!payload.name || !payload.start_date) { toast('Fill in name and start date'); return; }
    const who2 = currentSharer() ? possessive(currentSharer()) : 'The';
    if (payload.monthly_amount > 0 && payload.wifey_monthly_share > payload.monthly_amount) { toast(`${who2} share per month can't be more than the monthly amount`, { error: true }); return; }
    if (payload.fee > 0 && payload.wifey_fee_share > payload.fee) { toast(`${who2} share of the fee can't be more than the fee`, { error: true }); return; }
    if (payload.fee === 0 && payload.wifey_fee_share > 0 &&
        !confirm(`The fee is ₱0, so ${who2} share of the fee (${PESO(payload.wifey_fee_share)}) will only be added to the first payment, not every month.\n\nSave anyway?`)) return;
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
    if (error) { toast(error.message, { error: true }); return; }
    // Only wipe/regenerate the schedule on a brand-new installment, or when a
    // field that actually changes the schedule's shape was edited. Editing
    // unrelated fields (name, payer, billed-to-card) leaves your per-period
    // edits in "View schedule" untouched.
    if (savedId && (!isEdit || scheduleAffectingFieldsChanged)) {
      await regenerateSchedule({ ...payload, id: savedId });
    } else if (isEdit && Number(payload.wifey_monthly_share) !== Number(i.wifey_monthly_share || 0)) {
      // New per-month share: apply it to every schedule row still on the old
      // default. Rows you edited by hand in "View schedule" are left alone.
      dbOk(await db.from('installment_schedule')
        .update({ wifey_share: payload.wifey_monthly_share })
        .eq('installment_id', i.id)
        .eq('wifey_share', Number(i.wifey_monthly_share || 0)));
    }
    if (state.itemsTableOk && savedId) {
      // Replace the breakdown wholesale - simplest way to keep order and edits in sync.
      const rows = items
        .filter(it => (it.label || '').trim() || Number(it.amount))
        .map((it, idx) => ({ installment_id: savedId, label: (it.label || '').trim() || 'Item', owner: (it.owner || '').trim() || selfName, amount: Number(it.amount) || 0, sort_order: idx }));
      const had = itemsForInstallment(savedId).length;
      if (had && !dbOk(await db.from('installment_items').delete().eq('installment_id', savedId))) return;
      if (rows.length && !dbOk(await db.from('installment_items').insert(rows))) return;
    }
    closeModal(); await loadAll(); renderView();
  };
}

/* ---------------- FORECAST VIEW ----------------
   The next 6 months of pay periods: what's already locked in (installments,
   shares people owe you, anything recorded in an existing period) against your
   salary, plus a what-if for a new installment or balance conversion. The
   assumptions are per-browser and never touch the database. */

const FORECAST_KEY = 'budget_forecast';
function forecastAssumptions() {
  const latestSalary = type => {
    const p = state.periods.filter(x => !x.archived && x.period_type === type && Number(x.salary) > 0)
      .sort((a, b) => b.period_date.localeCompare(a.period_date))[0];
    return p ? Number(p.salary) : 0;
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FORECAST_KEY) || '{}'); } catch (e) { saved = {}; }
  return {
    sal15: latestSalary('15th'), sal30: latestSalary('30th'), inc15: 0, inc30: 0, other15: 0, other30: 0, startCash: 0,
    wiOn: false, wiAmount: 0, wiMonths: 6, wiRate: 1, wiFirst: '', wiTakeoff: '',
    ...saved,
  };
}
function saveForecastAssumptions(a) {
  try { localStorage.setItem(FORECAST_KEY, JSON.stringify(a)); } catch (e) { /* private mode */ }
}

// The next 12 pay dates (6 months), skipping any that have already passed.
function forecastSlots() {
  const today = toLocalISODate(new Date());
  const now = new Date();
  const slots = [];
  for (let k = 0; slots.length < 12 && k < 8; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    [['15th', `${mk}-15`], ['30th', `${mk}-${String(Math.min(30, last)).padStart(2, '0')}`]].forEach(([type, date]) => {
      if (date >= today && slots.length < 12) slots.push({ mk, type, date, key: `${mk}|${type}` });
    });
  }
  return slots;
}
const addMonths = (mk, n) => {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const slotLabel = (mk, type) => {
  const last = new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0).getDate();
  return `${new Date(mk + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short' })} ${type === '15th' ? 15 : Math.min(30, last)}`;
};
// Average of what was actually charged (non-installment transactions) on the
// last few recorded periods of a type - a realistic starting point for
// "Other spending" in projected periods.
function averageRecordedSpending(type, n = 3) {
  const ps = state.periods.filter(p => !p.archived && p.period_type === type)
    .filter(p => state.transactions.some(t => t.period_id === p.id))
    .sort((a, b) => b.period_date.localeCompare(a.period_date)).slice(0, n);
  if (!ps.length) return null;
  const total = ps.reduce((sum, p) => sum + state.transactions.filter(t => t.period_id === p.id).reduce((s2, t) => s2 + Number(t.amount), 0), 0);
  return { avg: round2(total / ps.length), count: ps.length };
}

// Installment-driven numbers for one pay period, whether or not the period
// exists yet: what you pay, and what Justine / others owe you for it.
function fixedForSlot(mk, type) {
  const r = { out: 0, byCard: new Map(), justine: 0, others: new Map() };
  state.installments.filter(i => !i.archived).forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      const k = periodKeyForDate(row.due_date);
      if (k.mk !== mk || k.type !== type) return;
      const share = totalWifeyShareForRow(inst, row);
      if (inst.owner === 'joven') {
        const amt = totalAmountForRow(inst, row);
        r.out += amt;
        const ck = inst.card_id || 'gl';
        r.byCard.set(ck, (r.byCard.get(ck) || 0) + amt);
        if (share > 0) {
          if (isJustineShare(inst)) r.justine += share;
          else { const who = shareHolder(inst); r.others.set(who, (r.others.get(who) || 0) + share); }
        }
      } else if (share > 0 && isJovenShare(inst)) {
        r.justine -= share; // one of her plans that you cover - reduces what she owes
        const who = collectsFrom(inst);
        if (who) r.others.set(who, (r.others.get(who) || 0) + share); // ...but someone pays you back
      }
    });
  });
  return r;
}
function existingPeriodFor(mk, type) {
  return state.periods.find(p => !p.archived && p.period_type === type && monthKey(p.period_date) === mk) || null;
}
// What Justine owes for one pay period's charges (counted on the 30th).
function justineOwnForSlot(mk, type) {
  const p = existingPeriodFor(mk, type);
  return p ? wifeyTotalForPeriod(p.id) : fixedForSlot(mk, type).justine;
}

function computeForecast(a) {
  const slots = forecastSlots();
  const wiMonthly = a.wiOn && a.wiAmount > 0 && a.wiMonths > 0
    ? round2(a.wiAmount * (1 + (a.wiRate / 100) * a.wiMonths) / a.wiMonths) : 0;
  const [wiMk, wiType] = (a.wiFirst || '').split('|');
  let running = Number(a.startCash) || 0;
  const rows = slots.map((slot, i) => {
    const { mk, type } = slot;
    const existing = existingPeriodFor(mk, type);
    const label = slotLabel(mk, type);
    const axis = { label, axis1: label.split(' ')[1], axisSub: type === '15th' || i === 0 ? label.split(' ')[0] : '' };
    const inLines = [], outLines = [];
    const assumedSalary = type === '15th' ? Number(a.sal15) || 0 : Number(a.sal30) || 0;
    if (existing) {
      const t = periodTotals(existing);
      const recSalary = Number(existing.salary) || 0;
      inLines.push({ label: recSalary ? 'Salary' : 'Salary (assumed)', amount: recSalary || assumedSalary });
      t.otherShares.forEach(o => inLines.push({ label: o.person, amount: o.amount, tag: 'installment share' }));
      if (t.extraIncome) inLines.push({ label: 'Income lines', amount: t.extraIncome });
      else if (type === '15th' ? a.inc15 : a.inc30) inLines.push({ label: 'Other income', amount: Number(type === '15th' ? a.inc15 : a.inc30), tag: 'assumption' });
      state.cards.forEach(c => { const v = cardTotalForPeriod(c.id, existing.id); if (v) outLines.push({ label: c.name, amount: v, color: c.color }); });
      const gl = generalLedgerInstallmentTotalForPeriod(existing.id);
      if (gl) outLines.push({ label: 'General ledger', amount: gl });
    } else {
      const f = fixedForSlot(mk, type);
      inLines.push({ label: 'Salary (assumed)', amount: assumedSalary });
      if (type === '15th' ? a.inc15 : a.inc30) inLines.push({ label: 'Other income', amount: Number(type === '15th' ? a.inc15 : a.inc30), tag: 'assumption' });
      [...f.others.entries()].forEach(([who, v]) => inLines.push({ label: who, amount: v, tag: 'installment share' }));
      [...f.byCard.entries()].forEach(([ck, v]) => {
        const c = state.cards.find(x => x.id === ck);
        outLines.push({ label: c ? c.name : 'General ledger', amount: v, color: c ? c.color : null, tag: 'installments' });
      });
    }
    if (type === '30th') {
      const j = justineOwnForSlot(mk, '15th') + justineOwnForSlot(mk, '30th');
      if (j) inLines.push({ label: 'Justine (15th + 30th)', amount: j });
    }
    // "Other spending" stands in for bills that haven't been entered yet, so it
    // only applies to periods with no real transactions recorded.
    const hasBills = !!existing && state.transactions.some(t => t.period_id === existing.id);
    const other = hasBills ? 0 : (type === '15th' ? Number(a.other15) || 0 : Number(a.other30) || 0);
    if (other) outLines.push({ label: 'Other spending', amount: other, tag: 'assumption' });
    if (wiMonthly && type === wiType) {
      const idx = (Number(mk.slice(0, 4)) - Number(wiMk.slice(0, 4))) * 12 + (Number(mk.slice(5, 7)) - Number(wiMk.slice(5, 7)));
      if (idx >= 0 && idx < a.wiMonths) outLines.push({ label: `What-if payment ${idx + 1}/${a.wiMonths}`, amount: wiMonthly, tag: 'what-if' });
    }
    if (a.wiOn && a.wiAmount > 0 && a.wiTakeoff === slot.key) {
      outLines.push({ label: 'Balance converted (taken off this bill)', amount: -Number(a.wiAmount), tag: 'what-if' });
    }
    const totalIn = inLines.reduce((s2, l) => s2 + l.amount, 0);
    const totalOut = outLines.reduce((s2, l) => s2 + l.amount, 0);
    const net = totalIn - totalOut;
    running += net;
    return { ...slot, ...axis, recorded: hasBills, inLines, outLines, totalIn, totalOut, net, running };
  });
  const wiInterest = wiMonthly ? round2(wiMonthly * a.wiMonths - a.wiAmount) : 0;
  return { rows, wiMonthly, wiInterest };
}

function forecastChartSvg(rows, width) {
  // Drawn at the container's real width so text stays readable on phones.
  const W = Math.max(320, Math.min(900, Math.round(width || 760))), H = W < 500 ? 220 : 240, padL = 52, padR = 12, padT = 16, padB = 40;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = rows.flatMap(r => [r.net, r.running]).concat(0);
  let max = Math.max(...vals), min = Math.min(...vals);
  if (max === min) { max += 1000; min -= 1000; }
  const span = max - min; max += span * 0.08; min -= span * 0.08;
  const y = v => padT + (max - v) / (max - min) * innerH;
  const band = innerW / rows.length;
  const bw = Math.min(28, band * 0.55);
  const short = n => { const a2 = Math.abs(n); return (n < 0 ? '-' : '') + '₱' + (a2 >= 1000 ? (a2 / 1000).toFixed(a2 >= 10000 ? 0 : 1) + 'k' : Math.round(a2)); };
  // ~4 tidy gridlines
  const rawStep = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= rawStep);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  const bars = rows.map((r, i) => {
    const cx = padL + band * i + band / 2;
    const y0 = y(0), y1 = y(r.net);
    const h = Math.max(Math.abs(y1 - y0), 1);
    const top = Math.min(y0, y1);
    const rad = Math.min(4, h / 2, bw / 2);
    // Rounded only at the data end, square on the zero line.
    const x0 = cx - bw / 2, x1 = cx + bw / 2;
    const d = r.net >= 0
      ? `M${x0},${y0} V${top + rad} Q${x0},${top} ${x0 + rad},${top} H${x1 - rad} Q${x1},${top} ${x1},${top + rad} V${y0} Z`
      : `M${x0},${y0} V${top + h - rad} Q${x0},${top + h} ${x0 + rad},${top + h} H${x1 - rad} Q${x1},${top + h} ${x1},${top + h - rad} V${y0} Z`;
    return `<path d="${d}" fill="${r.net >= 0 ? 'var(--fc-pos)' : 'var(--fc-neg)'}"></path>`;
  }).join('');
  const pts = rows.map((r, i) => [padL + band * i + band / 2, y(r.running)]);
  const line = `<polyline points="${pts.map(p2 => p2.join(',')).join(' ')}" fill="none" stroke="var(--fc-line)" stroke-width="2" stroke-linejoin="round"></polyline>`;
  const dots = pts.map(([x, yy]) => `<circle cx="${x}" cy="${yy}" r="4" fill="var(--fc-line)" stroke="var(--surface)" stroke-width="2"></circle>`).join('');
  const lowIdx = rows.reduce((bi, r, i) => r.running < rows[bi].running ? i : bi, 0);
  const lowY = pts[lowIdx][1];
  const lowLabel = rows[lowIdx].running < 0
    ? `<text x="${Math.min(pts[lowIdx][0], W - padR - 30)}" y="${lowY > H - padB - 26 ? lowY - 12 : lowY + 18}" text-anchor="middle" class="fc-ann">low ${short(rows[lowIdx].running)}</text>` : '';
  const xLabels = rows.map((r, i) => {
    const cx = padL + band * i + band / 2;
    return `<text x="${cx}" y="${H - padB + 16}" text-anchor="middle" class="fc-axis">${r.axis1}</text>` +
      (r.axisSub ? `<text x="${cx}" y="${H - padB + 31}" text-anchor="middle" class="fc-axis fc-month">${r.axisSub}</text>` : '');
  }).join('');
  const hits = rows.map((r, i) => `<rect class="fc-hit" data-fc-i="${i}" x="${padL + band * i}" y="${padT}" width="${band}" height="${innerH}" fill="transparent"><title>${r.label}: net ${PESO(r.net)}, running ${PESO(r.running)}</title></rect>`).join('');
  return `
    <svg viewBox="0 0 ${W} ${H}" class="fc-chart" role="img" aria-label="Net per pay period and running balance for the next 6 months">
      ${ticks.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'fc-zero' : 'fc-grid'}"></line><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" class="fc-axis">${short(v)}</text>`).join('')}
      ${ticks.includes(0) ? '' : `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" class="fc-zero"></line>`}
      ${bars}${line}${dots}${lowLabel}${xLabels}${hits}
    </svg>`;
}

/* ---- Justine's side: one row per calendar month, matching her Summary ---- */

const JFORECAST_KEY = 'budget_forecast_justine';
function justineForecastAssumptions() {
  const latest = state.justineMonths.filter(m => !m.archived).sort((x, y) => y.month_date.localeCompare(x.month_date))[0];
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(JFORECAST_KEY) || '{}'); } catch (e) { saved = {}; }
  return {
    pay: latest ? Number(latest.paycheck_budget) || 0 : 0, inc: 0,
    bills: latest ? round2(justineBillsForMonth(latest.id).reduce((s2, b) => s2 + Number(b.amount), 0)) : 0,
    other: 0, startCash: 0,
    wiOn: false, wiAmount: 0, wiMonths: 6, wiRate: 1, wiFirst: '', wiTakeoff: '',
    ...saved,
  };
}
function justineForecastSlots() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, k) => {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { mk, type: 'month', key: mk };
  });
}
const monthLabelShort = mk => new Date(mk + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
function justineMonthRecorded(m) {
  return !!m && (Number(m.bpi_total) > 0 || Number(m.eastwest_total) > 0 || justineBillsForMonth(m.id).length > 0);
}
// Her own installments due in a month, by card (no card = General Ledger).
function justineInstallmentsForMonth(mk) {
  const byCard = new Map();
  let gl = 0;
  state.installments.filter(i => !i.archived && i.owner === 'justine').forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      if (monthKey(row.due_date) !== mk) return;
      const amt = totalAmountForRow(inst, row);
      if (inst.card_id) byCard.set(inst.card_id, (byCard.get(inst.card_id) || 0) + amt); else gl += amt;
    });
  });
  return { byCard, gl };
}
// Her average BPI + Eastwest spending beyond installments, from recorded months.
function averageJustineCardSpending(n = 3) {
  const named = name => state.cards.find(c => c.name.toLowerCase() === name);
  const bpi = named('bpi'), ew = named('eastwest');
  const ms = state.justineMonths.filter(m => !m.archived && (Number(m.bpi_total) > 0 || Number(m.eastwest_total) > 0))
    .sort((x, y) => y.month_date.localeCompare(x.month_date)).slice(0, n);
  if (!ms.length) return null;
  const total = ms.reduce((sum, m) => {
    const inst = justineInstallmentsForMonth(monthKey(m.month_date)).byCard;
    const instOnThese = (bpi ? inst.get(bpi.id) || 0 : 0) + (ew ? inst.get(ew.id) || 0 : 0);
    return sum + Math.max(Number(m.bpi_total) + Number(m.eastwest_total) - instOnThese, 0);
  }, 0);
  return { avg: round2(total / ms.length), count: ms.length };
}

function computeJustineForecast(a) {
  const slots = justineForecastSlots();
  const wiMonthly = a.wiOn && a.wiAmount > 0 && a.wiMonths > 0
    ? round2(a.wiAmount * (1 + (a.wiRate / 100) * a.wiMonths) / a.wiMonths) : 0;
  let running = Number(a.startCash) || 0;
  const rows = slots.map((slot, i) => {
    const { mk } = slot;
    const m = state.justineMonths.find(x => !x.archived && monthKey(x.month_date) === mk);
    const recorded = justineMonthRecorded(m);
    const inLines = [], outLines = [];
    const recPay = m ? Number(m.paycheck_budget) || 0 : 0;
    inLines.push({ label: recPay ? 'Paycheck budget' : 'Paycheck budget (assumed)', amount: recPay || Number(a.pay) || 0 });
    justineOtherShareIncomeForMonth(mk).forEach(o => inLines.push({ label: o.person, amount: o.amount, tag: 'installment share' }));
    justinePassThroughIncomeForMonth(mk).forEach(o => inLines.push({ label: o.person, amount: o.amount, tag: "via Joven's plans" }));
    const recInc = m ? justineIncomeForMonth(m.id).reduce((s2, x) => s2 + Number(x.amount), 0) : 0;
    if (recInc) inLines.push({ label: 'Income lines', amount: recInc });
    else if (Number(a.inc)) inLines.push({ label: 'Other income', amount: Number(a.inc), tag: 'assumption' });
    // What she owes Joven this month - from his tracker where it exists, else from shared installments.
    const jovenCc = justineOwnForSlot(mk, '15th') + justineOwnForSlot(mk, '30th');
    if (jovenCc) outLines.push({ label: 'Joven CC total', amount: jovenCc, tag: 'from his tracker' });
    if (recorded) {
      if (Number(m.bpi_total)) outLines.push({ label: 'BPI', amount: Number(m.bpi_total), color: (state.cards.find(c => c.name.toLowerCase() === 'bpi') || {}).color });
      if (Number(m.eastwest_total)) outLines.push({ label: 'Eastwest', amount: Number(m.eastwest_total), color: (state.cards.find(c => c.name.toLowerCase() === 'eastwest') || {}).color });
      const gl = justineGeneralLedgerTotalForMonth(m.month_date);
      if (gl) outLines.push({ label: 'General ledger', amount: gl });
      justineBillsForMonth(m.id).forEach(b => { if (Number(b.amount)) outLines.push({ label: b.label, amount: Number(b.amount), tag: 'bill' }); });
    } else {
      const inst = justineInstallmentsForMonth(mk);
      [...inst.byCard.entries()].forEach(([cid, v]) => {
        const c = state.cards.find(x => x.id === cid);
        outLines.push({ label: c ? c.name : 'Card', amount: v, color: c ? c.color : null, tag: 'installments' });
      });
      if (inst.gl) outLines.push({ label: 'General ledger', amount: inst.gl, tag: 'installments' });
      if (Number(a.bills)) outLines.push({ label: 'Monthly bills', amount: Number(a.bills), tag: 'assumption' });
      if (Number(a.other)) outLines.push({ label: 'Other spending', amount: Number(a.other), tag: 'assumption' });
    }
    if (wiMonthly && a.wiFirst) {
      const idx = (Number(mk.slice(0, 4)) - Number(a.wiFirst.slice(0, 4))) * 12 + (Number(mk.slice(5, 7)) - Number(a.wiFirst.slice(5, 7)));
      if (idx >= 0 && idx < a.wiMonths) outLines.push({ label: `What-if payment ${idx + 1}/${a.wiMonths}`, amount: wiMonthly, tag: 'what-if' });
    }
    if (a.wiOn && a.wiAmount > 0 && a.wiTakeoff === mk) outLines.push({ label: 'Balance converted (taken off this bill)', amount: -Number(a.wiAmount), tag: 'what-if' });
    const totalIn = inLines.reduce((s2, l) => s2 + l.amount, 0);
    const totalOut = outLines.reduce((s2, l) => s2 + l.amount, 0);
    const net = totalIn - totalOut;
    running += net;
    const label = monthLabelShort(mk);
    return {
      ...slot, label, axis1: label.split(' ')[0], axisSub: i === 0 || mk.endsWith('-01') ? mk.slice(0, 4) : '',
      recorded, inLines, outLines, totalIn, totalOut, net, running,
    };
  });
  const wiInterest = wiMonthly ? round2(wiMonthly * a.wiMonths - a.wiAmount) : 0;
  return { rows, wiMonthly, wiInterest };
}

function renderJustineForecast() {
  const main = $('#main');
  const a = justineForecastAssumptions();
  const slots = justineForecastSlots();
  if (!a.wiFirst || !slots.some(x => x.key === a.wiFirst)) a.wiFirst = slots[0].key;
  const opts = (sel, withNone) => (withNone ? `<option value="" ${!sel ? 'selected' : ''}>— nothing (it's a new purchase)</option>` : '') +
    slots.map(x => `<option value="${x.key}" ${x.key === sel ? 'selected' : ''}>${monthLabelShort(x.mk)}</option>`).join('');
  const avg = averageJustineCardSpending();
  const jIncHint = () => {
    const mm = state.justineMonths.filter(x => !x.archived && justineIncomeForMonth(x.id).length).sort((x, y) => y.month_date.localeCompare(x.month_date))[0];
    if (!mm) return 'bonus, side gig… if they repeat';
    const v = round2(justineIncomeForMonth(mm.id).reduce((s2, x) => s2 + Number(x.amount), 0));
    return `income lines · <button type="button" class="fc-use" id="fj-inc-use" data-v="${v}">use ${monthLabelShort(monthKey(mm.month_date))}'s ${PESO(v)}</button>`;
  };
  const num = (id, label, val, hint) => `<div class="field"><label>${label}</label><input type="number" step="0.01" id="${id}" value="${val}">${hint ? `<div class="fc-hint">${hint}</div>` : ''}</div>`;
  main.innerHTML = `
    <h2>Forecast</h2>
    <div class="subtitle">Justine's next 6 months: paycheck against what's already locked in (her installments, the Joven CC total, monthly bills). Nothing here is saved to the database.</div>

    <div class="section-card">
      <div class="sh"><h3>Assumptions</h3></div>
      <div class="fc-grid-inputs">
        ${num('fj-pay', 'Paycheck budget / month', a.pay)}
        ${num('fj-inc', 'Other income / month', a.inc, jIncHint())}
        ${num('fj-bills', 'Monthly bills', a.bills, 'from her latest month (Papa, PLDT…)')}
        ${num('fj-other', 'Other spending / month', a.other, avg ? `card buys beyond installments · <button type="button" class="fc-use" id="fj-use" data-v="${avg.avg}">use her avg ${PESO(avg.avg)}</button>` : 'card buys beyond installments, cash…')}
        ${num('fj-start', 'Starting cash', a.startCash, 'what she has on hand today')}
      </div>
    </div>

    <div class="section-card fc-whatif ${a.wiOn ? 'on' : ''}">
      <label class="fc-toggle"><input type="checkbox" id="fc-wi-on" ${a.wiOn ? 'checked' : ''}> <span><b>What-if</b> — a new installment or a balance conversion</span></label>
      <div class="fc-grid-inputs">
        ${num('fc-wi-amount', 'Amount (principal)', a.wiAmount || '')}
        <div class="field"><label>Months</label><input type="number" id="fc-wi-months" value="${a.wiMonths}" min="1"></div>
        ${num('fc-wi-rate', 'Add-on rate % per month', a.wiRate, 'ask the bank; 0 for 0% plans')}
        <div class="field"><label>First payment</label><select id="fc-wi-first">${opts(a.wiFirst, false)}</select></div>
        <div class="field"><label>Takes the amount off</label><select id="fc-wi-takeoff">${opts(a.wiTakeoff, true)}</select><div class="fc-hint">for a conversion: the bill it replaces</div></div>
      </div>
      <div id="fc-wi-summary" class="fc-wi-summary"></div>
    </div>

    <div id="fc-results"></div>
  `;
  const read = () => {
    const v = id => +$(id).value || 0;
    Object.assign(a, {
      pay: v('#fj-pay'), inc: v('#fj-inc'), bills: v('#fj-bills'), other: v('#fj-other'), startCash: v('#fj-start'),
      wiOn: $('#fc-wi-on').checked, wiAmount: v('#fc-wi-amount'), wiMonths: Math.max(1, Math.round(v('#fc-wi-months')) || 1),
      wiRate: v('#fc-wi-rate'), wiFirst: $('#fc-wi-first').value, wiTakeoff: $('#fc-wi-takeoff').value,
    });
    try { localStorage.setItem(JFORECAST_KEY, JSON.stringify(a)); } catch (e) { /* private mode */ }
    $('.fc-whatif').classList.toggle('on', a.wiOn);
    renderForecastResults(a);
  };
  if ($('#fj-use')) $('#fj-use').onclick = () => { $('#fj-other').value = $('#fj-use').dataset.v; read(); };
  if ($('#fj-inc-use')) $('#fj-inc-use').onclick = () => { $('#fj-inc').value = $('#fj-inc-use').dataset.v; read(); };
  $$('#main .fc-grid-inputs input, #main .fc-grid-inputs select, #fc-wi-on').forEach(el => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', read));
  renderForecastResults(a);
}

function renderForecast() {
  if (state.profile === 'justine') { renderJustineForecast(); return; }
  const main = $('#main');
  const a = forecastAssumptions();
  const slots = forecastSlots();
  if (!a.wiFirst || !slots.some(x => x.key === a.wiFirst)) a.wiFirst = (slots.find(x => x.type === '30th') || slots[0]).key;
  const slotOptions = (sel, withNone) => (withNone ? `<option value="" ${!sel ? 'selected' : ''}>— nothing (it's a new purchase)</option>` : '') +
    slots.map(x => `<option value="${x.key}" ${x.key === sel ? 'selected' : ''}>${slotLabel(x.mk, x.type)}, ${x.mk.slice(0, 4)}</option>`).join('');
  // Income lines (Part Time, JP...) from the latest period of each type that has any.
  const incHint = type => {
    const p = state.periods.filter(x => !x.archived && x.period_type === type && incomeItemsForPeriod(x.id).length)
      .sort((x, y) => y.period_date.localeCompare(x.period_date))[0];
    if (!p) return 'Part Time, JP… if they repeat';
    const v = round2(incomeItemsForPeriod(p.id).reduce((s2, x) => s2 + Number(x.amount), 0));
    return `Part Time, JP… · <button type="button" class="fc-use" data-fc-inc="${type}" data-v="${v}">use ${shortDate(p.period_date)}'s ${PESO(v)}</button>`;
  };
  const avgHint = type => {
    const r = averageRecordedSpending(type);
    return r ? `new card buys, cash, bills · <button type="button" class="fc-use" data-fc-use="${type}" data-v="${r.avg}">use your avg ${PESO(r.avg)}</button>` : 'new card buys, cash, bills not in the tracker';
  };
  const num = (id, label, val, hint) => `<div class="field"><label>${label}</label><input type="number" step="0.01" id="${id}" value="${val}">${hint ? `<div class="fc-hint">${hint}</div>` : ''}</div>`;
  main.innerHTML = `
    <h2>Forecast</h2>
    <div class="subtitle">The next 6 months of pay periods: everything already locked in (installments, shares owed to you, anything recorded) against your salary. Nothing here is saved to the database.</div>

    <div class="section-card">
      <div class="sh"><h3>Assumptions</h3></div>
      <div class="fc-grid-inputs">
        ${num('fc-sal15', '15th salary', a.sal15)}
        ${num('fc-sal30', '30th salary', a.sal30)}
        ${num('fc-inc15', 'Other income · 15th', a.inc15, incHint('15th'))}
        ${num('fc-inc30', 'Other income · 30th', a.inc30, incHint('30th'))}
        ${num('fc-other15', 'Other spending · 15th', a.other15, avgHint('15th'))}
        ${num('fc-other30', 'Other spending · 30th', a.other30, avgHint('30th'))}
        ${num('fc-start', 'Starting cash', a.startCash, 'what you have on hand today')}
      </div>
    </div>

    <div class="section-card fc-whatif ${a.wiOn ? 'on' : ''}">
      <label class="fc-toggle"><input type="checkbox" id="fc-wi-on" ${a.wiOn ? 'checked' : ''}> <span><b>What-if</b> — a new installment or a balance conversion</span></label>
      <div class="fc-grid-inputs" id="fc-wi-fields">
        ${num('fc-wi-amount', 'Amount (principal)', a.wiAmount || '')}
        <div class="field"><label>Months</label><input type="number" id="fc-wi-months" value="${a.wiMonths}" min="1"></div>
        ${num('fc-wi-rate', 'Add-on rate % per month', a.wiRate, 'ask the bank; 0 for 0% plans')}
        <div class="field"><label>First payment</label><select id="fc-wi-first">${slotOptions(a.wiFirst, false)}</select></div>
        <div class="field"><label>Takes the amount off</label><select id="fc-wi-takeoff">${slotOptions(a.wiTakeoff, true)}</select><div class="fc-hint">for a conversion: the bill it replaces</div></div>
      </div>
      <div id="fc-wi-summary" class="fc-wi-summary"></div>
    </div>

    <div id="fc-results"></div>
  `;

  const read = () => {
    const v = id => +$(id).value || 0;
    Object.assign(a, {
      sal15: v('#fc-sal15'), sal30: v('#fc-sal30'), inc15: v('#fc-inc15'), inc30: v('#fc-inc30'), other15: v('#fc-other15'), other30: v('#fc-other30'), startCash: v('#fc-start'),
      wiOn: $('#fc-wi-on').checked, wiAmount: v('#fc-wi-amount'), wiMonths: Math.max(1, Math.round(v('#fc-wi-months')) || 1),
      wiRate: v('#fc-wi-rate'), wiFirst: $('#fc-wi-first').value, wiTakeoff: $('#fc-wi-takeoff').value,
    });
    saveForecastAssumptions(a);
    $('.fc-whatif').classList.toggle('on', a.wiOn);
    renderForecastResults(a);
  };
  $$('[data-fc-inc]').forEach(b => b.onclick = () => {
    $(b.dataset.fcInc === '15th' ? '#fc-inc15' : '#fc-inc30').value = b.dataset.v;
    read();
  });
  $$('[data-fc-use]').forEach(b => b.onclick = () => {
    const inp = $(b.dataset.fcUse === '15th' ? '#fc-other15' : '#fc-other30');
    inp.value = b.dataset.v;
    read();
  });
  $$('#main .fc-grid-inputs input, #main .fc-grid-inputs select, #fc-wi-on').forEach(el => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', read));
  renderForecastResults(a);
}

function renderForecastResults(a) {
  const isJ = state.profile === 'justine';
  const unit1 = isJ ? 'month' : 'pay period', unitN = isJ ? 'months' : 'pay periods';
  const { rows, wiMonthly, wiInterest } = isJ ? computeJustineForecast(a) : computeForecast(a);
  const wrap = $('#fc-results');
  if (!rows.length) { wrap.innerHTML = `<div class="empty-state">Nothing to forecast.</div>`; return; }

  $('#fc-wi-summary').innerHTML = a.wiOn && wiMonthly
    ? `${PESO(wiMonthly)}/mo × ${a.wiMonths} = ${PESO(wiMonthly * a.wiMonths)} · costs <b>${PESO(wiInterest)}</b> in add-on interest${a.wiTakeoff ? '' : ' · nothing taken off (new purchase)'}`
    : a.wiOn ? 'Enter an amount to see its effect.' : '';

  const low = rows.reduce((b, r) => r.running < b.running ? r : b, rows[0]);
  const lowIdx = rows.indexOf(low);
  const recoverRow = low.running < 0 ? rows.slice(lowIdx).find(r => r.running >= 0) : null;
  const months = isJ ? rows.length : rows.length / 2;
  const avgNet = rows.reduce((s2, r) => s2 + r.net, 0) / months;
  const negatives = rows.filter(r => r.net < 0).length;

  const noSpending = (isJ ? !Number(a.other) : !Number(a.other15) && !Number(a.other30)) && rows.some(r => !r.recorded);
  wrap.innerHTML = `
    ${noSpending ? `<div class="fc-warn">⚠ Projected periods assume <b>no new spending</b> — only installments. Set "Other spending" above (the "use your avg" ${isJ ? 'link is' : 'buttons are'} a quick start), or this will look better than it really is.</div>` : ''}
    <div class="dash-stats">
      <div class="stat-card"><div class="stat-label">Lowest point</div><div class="stat-value" style="color:${low.running < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(low.running)}</div><div class="stat-note">running balance, ${low.label}</div></div>
      <div class="stat-card"><div class="stat-label">Back above zero</div><div class="stat-value">${low.running >= 0 ? 'Never below' : recoverRow ? recoverRow.label : 'Not in 6 mo'}</div><div class="stat-note">${low.running >= 0 ? 'stays positive throughout' : recoverRow ? `first ${unit1} the balance recovers` : 'still negative at the end'}</div></div>
      <div class="stat-card"><div class="stat-label">Average net / month</div><div class="stat-value" style="color:${avgNet < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(avgNet)}</div><div class="stat-note">${negatives} of ${rows.length} ${unitN} negative</div></div>
      <div class="stat-card"><div class="stat-label">End of forecast</div><div class="stat-value" style="color:${rows[rows.length - 1].running < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(rows[rows.length - 1].running)}</div><div class="stat-note">${rows[rows.length - 1].label}</div></div>
    </div>

    <div class="section-card">
      <div class="sh"><h3>Net per ${unit1} &amp; running balance</h3></div>
      <div class="fc-legend">
        <span><i class="fc-key-bar"></i>Net per ${unit1} <em>(blue above zero, red below)</em></span>
        <span><i class="fc-key-line"></i>Running balance</span>
      </div>
      <div class="fc-chart-wrap" id="fc-chart-wrap"><div class="fc-tip" id="fc-tip"></div></div>
    </div>

    <div class="section-card">
      <div class="sh"><h3>${isJ ? 'Months' : 'Pay periods'}</h3><span class="fc-hint">click a row for the breakdown</span></div>
      <table class="fc-table">
        <thead><tr><th>${isJ ? 'Month' : 'Period'}</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th><th class="num">Running</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="fc-row" data-fc-row="${i}">
              <td><span class="fc-caret">▸</span> ${r.label} <span class="synced-badge" style="${r.recorded ? '' : 'color:var(--text-dim);background:rgba(141,149,171,.14);'}">${r.recorded ? 'recorded' : 'projected'}</span></td>
              <td class="num">${PESO(r.totalIn)}</td>
              <td class="num">${PESO(r.totalOut)}</td>
              <td class="num" style="color:${r.net < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(r.net)}</td>
              <td class="num" style="font-weight:700;">${PESO(r.running)}</td>
            </tr>
            <tr class="fc-detail" data-fc-detail="${i}" hidden>
              <td colspan="5">
                <div class="fc-detail-grid">
                  <div><div class="flow-head" style="color:var(--green);">↓ In</div>${r.inLines.map(l => `<div class="fc-dl"><span>${escapeHtml(l.label)}${l.tag ? ` <em>${l.tag}</em>` : ''}</span><span>${PESO(l.amount)}</span></div>`).join('') || '<div class="fc-dl"><span>—</span></div>'}</div>
                  <div><div class="flow-head" style="color:var(--red);">↑ Out</div>${r.outLines.map(l => `<div class="fc-dl"><span>${l.color ? `<i class="sw" style="background:${l.color}"></i>` : ''}${escapeHtml(l.label)}${l.tag ? ` <em>${l.tag}</em>` : ''}</span><span>${PESO(l.amount)}</span></div>`).join('') || '<div class="fc-dl"><span>Nothing locked in yet</span></div>'}</div>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${isJ ? `<p class="fc-hint" style="margin-top:10px;">"Recorded" = the month already has BPI / Eastwest totals or bills entered, so it matches your Summary card. "Projected" = your paycheck, your installments (every card), monthly bills and other spending from the assumptions, plus the Joven CC total worked out from his tracker. The running balance starts from "Starting cash".</p>` : ''}<p class="fc-hint" style="margin-top:10px;${isJ ? 'display:none;' : ''}">"Recorded" = the period already has bills entered, so those are used as-is. "Projected" = only installments, shares owed to you and your assumptions, with "Other spending" standing in for the bills not entered yet. Previous savings are ignored; the running balance starts from "Starting cash".</p>
    </div>
  `;

  const chartWrap0 = $('#fc-chart-wrap');
  chartWrap0.insertAdjacentHTML('afterbegin', forecastChartSvg(rows, chartWrap0.clientWidth));

  $$('[data-fc-row]').forEach(tr => tr.onclick = e => {
    if (window.getSelection().toString()) return;
    const d = $(`[data-fc-detail="${tr.dataset.fcRow}"]`);
    d.hidden = !d.hidden;
    tr.classList.toggle('open', !d.hidden);
  });

  // Hover tooltip on the chart (the <title> inside each hit area is the fallback).
  const tip = $('#fc-tip'), chartWrap = $('#fc-chart-wrap');
  $$('.fc-hit').forEach(h => {
    h.addEventListener('mouseenter', () => {
      const r = rows[+h.dataset.fcI];
      tip.innerHTML = `<b>${r.label}</b> <span>${r.recorded ? 'recorded' : 'projected'}</span>
        <div><span>In</span><span>${PESO(r.totalIn)}</span></div>
        <div><span>Out</span><span>${PESO(r.totalOut)}</span></div>
        <div><span>Net</span><span style="color:${r.net < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(r.net)}</span></div>
        <div><span>Running</span><span>${PESO(r.running)}</span></div>`;
      tip.classList.add('on');
      const box = chartWrap.getBoundingClientRect(), hb = h.getBoundingClientRect();
      const left = Math.min(Math.max(hb.left - box.left + hb.width / 2 - 85, 0), box.width - 170);
      tip.style.left = left + 'px';
      h.classList.add('hover');
    });
    h.addEventListener('mouseleave', () => { tip.classList.remove('on'); h.classList.remove('hover'); });
  });
}

/* ---------------- SETTINGS VIEW ---------------- */

/* ---------------- VISION BOARD ---------------- */

function checklistForBoard(boardId) {
  return state.visionBoardChecklist.filter(c => c.board_id === boardId);
}
function imagesForBoard(boardId) {
  return state.visionBoardImages.filter(i => i.board_id === boardId);
}
function checklistProgress(boardId) {
  const items = checklistForBoard(boardId);
  if (!items.length) return null;
  const done = items.filter(c => c.done).length;
  return { done, total: items.length, pct: Math.round((done / items.length) * 100) };
}

function resizeImageFile(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderVisionBoardView() {
  if (state.activeVisionBoardId && state.visionBoards.find(b => b.id === state.activeVisionBoardId && !b.archived)) {
    renderVisionBoardDetail(state.visionBoards.find(b => b.id === state.activeVisionBoardId));
  } else {
    state.activeVisionBoardId = null;
    renderVisionBoardGrid();
  }
}

function renderVisionBoardGrid() {
  const main = $('#main');
  const boards = state.visionBoards.filter(b => !b.archived).slice().sort((a, b) => a.sort_order - b.sort_order);
  const archived = state.visionBoards.filter(b => b.archived);
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div><h2>✨ Vision Board</h2><div class="subtitle">Plans, trips, goals - whatever you two are working toward</div></div>
      <div style="display:flex;gap:8px;">
        ${state.showArchivedVisionBoards ? `<button class="btn secondary" id="toggle-archived-vision">← Back to active</button>` : archived.length ? `<button class="btn secondary" id="toggle-archived-vision">Show archived (${archived.length})</button>` : ''}
        <button class="btn" id="add-vision-btn">+ New vision</button>
      </div>
    </div>
    <div class="vision-grid" id="vision-grid"></div>
  `;
  $('#add-vision-btn').onclick = () => openVisionBoardModal();
  if ($('#toggle-archived-vision')) $('#toggle-archived-vision').onclick = () => { state.showArchivedVisionBoards = !state.showArchivedVisionBoards; renderVisionBoardGrid(); };

  const grid = $('#vision-grid');
  const list = state.showArchivedVisionBoards ? archived : boards;
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">${state.showArchivedVisionBoards ? 'Nothing archived.' : 'No visions yet - click "New vision" to add your first one, like "China 2027".'}</div>`;
    return;
  }
  list.forEach(b => {
    const progress = checklistProgress(b.id);
    const imgCount = imagesForBoard(b.id).length;
    const coverImg = imagesForBoard(b.id)[0];
    const el = document.createElement('div');
    el.className = 'vision-card';
    el.innerHTML = `
      <div class="vision-cover" style="background:${coverImg ? `url('${coverImg.data_url}') center/cover` : `linear-gradient(135deg, ${b.color}33, ${b.color}0d)`};">
        ${!coverImg ? `<span class="vision-cover-emoji">${escapeHtml(b.emoji)}</span>` : ''}
        ${!state.showArchivedVisionBoards ? `<button class="icon-btn" data-archive-vision="${b.id}" title="Archive" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.5);border:none;" aria-label="Archive">📦</button>` : `<button class="icon-btn" data-restore-vision="${b.id}" title="Restore" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.5);border:none;" aria-label="Restore">♻️</button>`}
      </div>
      <div class="vision-body">
        <div class="vision-title">${escapeHtml(b.title)}</div>
        ${b.target_date ? `<div class="vision-date">${new Date(b.target_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</div>` : ''}
        <div class="vision-meta">
          ${progress ? `<span>${progress.done}/${progress.total} done</span>` : '<span style="color:var(--text-dim);">No checklist yet</span>'}
          ${imgCount ? `<span>📷 ${imgCount}</span>` : ''}
        </div>
        ${progress ? `<div class="progress-track" style="margin-top:8px;"><div class="progress-fill" style="width:${progress.pct}%;background:${b.color};"></div></div>` : ''}
      </div>
    `;
    if (!state.showArchivedVisionBoards) {
      el.onclick = e => {
        if (e.target.closest('[data-archive-vision]')) return;
        state.activeVisionBoardId = b.id;
        renderView();
      };
    }
    grid.appendChild(el);
  });
  $$('[data-archive-vision]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    setArchived('vision_boards', b.dataset.archiveVision, true, 'Vision');
  });
  $$('[data-restore-vision]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    setArchived('vision_boards', b.dataset.restoreVision, false, 'Vision');
  });
}

function openVisionBoardModal(board) {
  const isEdit = !!board;
  const b = board || { title: '', emoji: '🎯', color: '#e3b158', target_date: '' };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} vision</h3>
    <div class="field-row">
      <div class="field" style="flex:0 0 90px;"><label>Emoji</label><input type="text" id="f-emoji" value="${escapeHtml(b.emoji)}" maxlength="4" style="text-align:center;font-size:20px;"></div>
      <div class="field"><label>Title</label><input type="text" id="f-title" value="${b.title ? escapeHtml(b.title) : ''}" placeholder="e.g. China 2027"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Color</label><input type="color" id="f-color" value="${b.color}"></div>
      <div class="field"><label>Target date (optional)</label><input type="month" id="f-date" value="${b.target_date ? b.target_date.slice(0, 7) : ''}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const title = $('#f-title').value.trim();
    if (!title) { toast('Give it a title'); return; }
    const dateVal = $('#f-date').value;
    const payload = {
      title,
      emoji: $('#f-emoji').value.trim() || '🎯',
      color: $('#f-color').value,
      target_date: dateVal ? dateVal + '-01' : null,
    };
    let error;
    if (isEdit) ({ error } = await db.from('vision_boards').update(payload).eq('id', b.id));
    else ({ error } = await db.from('vision_boards').insert({ ...payload, sort_order: state.visionBoards.length }));
    if (error) { toast(error.message, { error: true }); return; }
    closeModal(); await loadAll(); renderView();
  };
}

function renderVisionBoardDetail(b) {
  const main = $('#main');
  const checklist = checklistForBoard(b.id).slice().sort((x, y) => x.sort_order - y.sort_order);
  const images = imagesForBoard(b.id).slice().sort((x, y) => x.sort_order - y.sort_order);
  const progress = checklistProgress(b.id);

  main.innerHTML = `
    <button class="btn secondary" id="vision-back-btn" style="margin-bottom:16px;">← All visions</button>
    <div class="vision-hero" style="background:linear-gradient(135deg, ${b.color}2e, transparent);border-color:${b.color}55;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:40px;line-height:1;">${escapeHtml(b.emoji)}</div>
          <h2 style="margin:10px 0 4px 0;">${escapeHtml(b.title)}</h2>
          ${b.target_date ? `<div class="subtitle">Target: ${new Date(b.target_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</div>` : ''}
        </div>
        <div>
          <button class="icon-btn edit" id="edit-vision-btn" title="Edit" aria-label="Edit">✎</button>
          <button class="icon-btn" id="archive-vision-detail-btn" title="Archive" aria-label="Archive">📦</button>
        </div>
      </div>
      ${progress ? `<div class="progress-track" style="margin-top:16px;height:8px;"><div class="progress-fill" style="width:${progress.pct}%;background:${b.color};"></div></div><div style="font-size:12px;color:var(--text-dim);margin-top:6px;">${progress.done} of ${progress.total} done</div>` : ''}
    </div>

    <div class="section-card">
      <h3 style="font-family:'Space Grotesk',sans-serif;margin-top:0;">Notes & Plans</h3>
      <textarea id="vision-notes" placeholder="Write out the plan - flights, budget, itinerary, ideas, anything…" style="width:100%;min-height:140px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:12px;border-radius:8px;font-family:inherit;font-size:14px;resize:vertical;">${b.notes ? escapeHtml(b.notes) : ''}</textarea>
    </div>

    <div class="section-card">
      <div class="sh"><h3>Checklist</h3></div>
      <div id="vision-checklist"></div>
      <div class="field-row" style="margin-top:10px;">
        <input type="text" id="vision-new-item" placeholder="Add a to-do and press Enter…" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:8px;font-family:inherit;font-size:14px;">
      </div>
    </div>

    <div class="section-card">
      <div class="sh"><h3>Photos</h3><button class="btn secondary" id="vision-add-photos-btn" style="padding:6px 12px;font-size:13px;">+ Add photos</button></div>
      <input type="file" id="vision-photo-input" accept="image/*" multiple style="display:none;">
      <div class="vision-photo-grid" id="vision-photo-grid"></div>
    </div>
  `;

  $('#vision-back-btn').onclick = () => { state.activeVisionBoardId = null; renderView(); };
  $('#edit-vision-btn').onclick = () => openVisionBoardModal(b);
  $('#archive-vision-detail-btn').onclick = () => {
    state.activeVisionBoardId = null;
    setArchived('vision_boards', b.id, true, 'Vision');
  };

  $('#vision-notes').onblur = async e => {
    if (e.target.value === (b.notes || '')) return; // nothing changed
    if (!dbOk(await db.from('vision_boards').update({ notes: e.target.value }).eq('id', b.id), 'Notes saved')) return;
    b.notes = e.target.value;
  };

  const checklistWrap = $('#vision-checklist');
  checklistWrap.innerHTML = checklist.length ? checklist.map(c => `
    <div class="vision-checklist-row">
      <label style="display:flex;align-items:center;gap:10px;flex:1;cursor:pointer;">
        <input type="checkbox" data-toggle-item="${c.id}" ${c.done ? 'checked' : ''} style="width:17px;height:17px;accent-color:${b.color};">
        <span style="${c.done ? 'text-decoration:line-through;color:var(--text-dim);' : ''}">${escapeHtml(c.label)}</span>
      </label>
      <button class="icon-btn" data-del-item="${c.id}" title="Delete" aria-label="Delete">✕</button>
    </div>
  `).join('') : `<div class="empty-state" style="padding:14px;font-size:13px;">Nothing on the list yet.</div>`;
  $$('[data-toggle-item]').forEach(cb => cb.onchange = async () => {
    if (!dbOk(await db.from('vision_board_checklist').update({ done: cb.checked }).eq('id', cb.dataset.toggleItem))) { cb.checked = !cb.checked; return; }
    const item = state.visionBoardChecklist.find(x => x.id === cb.dataset.toggleItem);
    if (item) item.done = cb.checked;
    renderVisionBoardDetail(b);
  });
  $$('[data-del-item]').forEach(x => x.onclick = async () => {
    if (!dbOk(await db.from('vision_board_checklist').delete().eq('id', x.dataset.delItem))) return;
    await loadAll(); renderView();
  });
  $('#vision-new-item').onkeydown = async e => {
    if (e.key !== 'Enter') return;
    const label = e.target.value.trim();
    if (!label) return;
    if (!dbOk(await db.from('vision_board_checklist').insert({ board_id: b.id, label, sort_order: checklist.length }))) return;
    await loadAll(); renderView();
    const again = $('#vision-new-item');
    if (again) again.focus(); // keep typing the next to-do
  };

  const photoGrid = $('#vision-photo-grid');
  photoGrid.innerHTML = images.length ? images.map(img => `
    <div class="vision-photo-thumb" data-view-photo="${img.id}" style="background-image:url('${img.data_url}');"></div>
  `).join('') : `<div class="empty-state" style="padding:14px;font-size:13px;">No photos yet.</div>`;
  $$('[data-view-photo]').forEach(el => el.onclick = () => openPhotoViewer(images.find(i => i.id === el.dataset.viewPhoto)));
  $('#vision-add-photos-btn').onclick = () => $('#vision-photo-input').click();
  $('#vision-photo-input').onchange = async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    toast('Uploading…');
    let saved = 0, failedCount = 0;
    for (let idx = 0; idx < files.length; idx++) {
      try {
        const dataUrl = await resizeImageFile(files[idx]);
        const res = await db.from('vision_board_images').insert({ board_id: b.id, data_url: dataUrl, sort_order: images.length + idx });
        if (res.error) failedCount++; else saved++;
      } catch (err) { failedCount++; }
    }
    await loadAll(); renderView();
    if (failedCount) toast(`${saved} photo${saved === 1 ? '' : 's'} added, ${failedCount} failed`, { error: true });
    else toast(`${saved} photo${saved === 1 ? '' : 's'} added`);
  };
}

function openPhotoViewer(img) {
  if (!img) return;
  showModal(`
    <img src="${img.data_url}" style="width:100%;border-radius:8px;display:block;">
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Close</button>
      <button class="btn danger" id="delete-photo-btn">Delete photo</button>
    </div>
  `);
  $('#delete-photo-btn').onclick = async () => {
    if (!confirm('Delete this photo?')) return;
    if (!dbOk(await db.from('vision_board_images').delete().eq('id', img.id))) return;
    closeModal(); await loadAll(); renderView();
  };
}

function renderSettings() {
  const main = $('#main');
  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div><h2>Cards & Settings</h2><div class="subtitle">Manage your credit cards and shared password</div></div>
      <button class="btn" id="add-card-btn">+ Add card</button>
    </div>
    <div class="section-card">
      <table>
        <thead><tr><th>Card</th><th>Statement day</th><th>Due day</th><th></th><th></th></tr></thead>
        <tbody>
          ${state.cards.map(c => `
            <tr>
              <td><span class="card-chip"><span class="sw" style="background:${c.color}"></span>${c.name}</span>${c.archived ? ' <span style="color:var(--text-dim)">(archived)</span>' : ''}</td>
              <td>${c.statement_day || '—'}</td>
              <td>${c.due_day || '—'}</td>
              <td style="text-align:right;">
                <button class="icon-btn edit" data-edit-c="${c.id}" title="Edit" aria-label="Edit">✎</button>
                <button class="icon-btn" data-del-c="${c.id}" title="Delete" aria-label="Delete">✕</button>
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
    if (!dbOk(await db.from('credit_cards').delete().eq('id', b.dataset.delC), 'Card deleted')) return;
    await loadAll(); renderView();
  });
  $('#change-pw-btn').onclick = async () => {
    const pw = $('#new-pw').value;
    if (pw.length < 4) { toast('Password too short'); return; }
    const hash = await sha256(pw);
    if (!dbOk(await db.from('app_settings').update({ value: hash }).eq('key', 'password_hash'), 'Password updated')) return;
    $('#new-pw').value = '';
  };
}

function openCardModal(card) {
  const isEdit = !!card;
  const c = card || { name: '', color: '#5b9df9', statement_day: '', due_day: '', pay_period: '30th', sort_order: state.cards.length + 1 };
  // Only offer/save "Paid on" once migration_card_pay_period.sql has been run,
  // so saving a card never fails on a database that doesn't have the column yet.
  const hasPayPeriodCol = state.cards.some(x => 'pay_period' in x);
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} card</h3>
    <div class="field-row">
      <div class="field"><label>Name</label><input type="text" id="f-name" value="${c.name ? escapeHtml(c.name) : ''}"></div>
      <div class="field"><label>Color</label><input type="color" id="f-color" value="${c.color}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Statement day (optional)</label><input type="text" id="f-sd" value="${c.statement_day || ''}" placeholder="e.g. 27th"></div>
      <div class="field"><label>Due day (optional)</label><input type="text" id="f-dd" value="${c.due_day || ''}" placeholder="e.g. 15th"></div>
    </div>
    ${hasPayPeriodCol ? `
    <div class="field-row">
      <div class="field"><label>Paid on</label>
        <select id="f-pp">
          <option value="15th" ${c.pay_period === '15th' ? 'selected' : ''}>15th period only</option>
          <option value="30th" ${c.pay_period === '30th' ? 'selected' : ''}>30th period only</option>
          <option value="both" ${!c.pay_period || c.pay_period === 'both' ? 'selected' : ''}>Both periods</option>
        </select>
      </div>
    </div>` : ''}
    <p style="font-size:12px;color:var(--text-dim);">Due day shows up next to the "statement in" badge once that statement has actually arrived this month.${hasPayPeriodCol ? ' "Paid on" decides which period this card appears under on the Transactions tab.' : ''}</p>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  $('#modal-save').onclick = async () => {
    const payload = { name: $('#f-name').value.trim(), color: $('#f-color').value, statement_day: $('#f-sd').value.trim(), due_day: $('#f-dd').value.trim() };
    if (hasPayPeriodCol) payload.pay_period = $('#f-pp').value;
    if (!payload.name) { toast('Name required'); return; }
    let error;
    if (isEdit) ({ error } = await db.from('credit_cards').update(payload).eq('id', c.id));
    else ({ error } = await db.from('credit_cards').insert({ ...payload, sort_order: c.sort_order }));
    if (error) { toast(error.message, { error: true }); return; }
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

function justineIncomeForMonth(monthId) {
  return (state.justineIncomeItems || []).filter(i => i.month_id === monthId);
}
// Shares owed to Justine by anyone other than Joven on her installments
// (Joven's share is handled through the Joven CC Total instead).
function justineOtherShareIncomeForMonth(mk) {
  const byPerson = new Map();
  state.installments.filter(i => !i.archived && i.owner === 'justine' && !isJovenShare(i)).forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      if (monthKey(row.due_date) !== mk) return;
      const share = totalWifeyShareForRow(inst, row);
      if (share <= 0) return;
      const who = shareHolder(inst), key = who.toLowerCase();
      if (!byPerson.has(key)) byPerson.set(key, { person: who, amount: 0, plans: [] });
      const g = byPerson.get(key);
      g.amount += share;
      g.plans.push(`${inst.name}: ${PESO(share)}`);
    });
  });
  return [...byPerson.values()].sort((a, b) => a.person.localeCompare(b.person));
}
// Joven's plans shared with Justine where someone else pays Justine back.
// She still owes Joven the full share (it's in her Joven CC Total); this is
// the money coming back to her, so it lands on her Money in.
function justinePassThroughIncomeForMonth(mk) {
  const byPerson = new Map();
  state.installments.filter(i => !i.archived && isJustineShare(i) && collectsFrom(i)).forEach(inst => {
    scheduleForInstallment(inst.id).forEach(row => {
      if (monthKey(row.due_date) !== mk) return;
      const share = totalWifeyShareForRow(inst, row);
      if (share <= 0) return;
      const who = collectsFrom(inst), key = who.toLowerCase();
      if (!byPerson.has(key)) byPerson.set(key, { person: who, amount: 0, plans: [] });
      const g = byPerson.get(key);
      g.amount += share;
      g.plans.push(`${inst.name} (Joven's plan): ${PESO(share)}`);
    });
  });
  return [...byPerson.values()].sort((a, b) => a.person.localeCompare(b.person));
}

function previousJustineMonthOf(dateStr, excludeId) {
  if (!dateStr) return null;
  return state.justineMonths
    .filter(m => !m.archived && m.id !== excludeId && m.month_date < dateStr)
    .sort((a, b) => b.month_date.localeCompare(a.month_date))[0] || null;
}

function justineTotals(m) {
  const jovenCc = jovenJustineTotalForMonth(m.month_date);
  const billsTotal = justineBillsForMonth(m.id).reduce((s, b) => s + Number(b.amount), 0);
  const generalLedger = justineGeneralLedgerTotalForMonth(m.month_date);
  const payablesTotal = Number(m.bpi_total) + Number(m.eastwest_total) + billsTotal + generalLedger;
  const totalOutflow = jovenCc.total + payablesTotal;
  const extraIncome = justineIncomeForMonth(m.id).reduce((s, i) => s + Number(i.amount), 0);
  const otherShares = justineOtherShareIncomeForMonth(monthKey(m.month_date));
  const passThrough = justinePassThroughIncomeForMonth(monthKey(m.month_date));
  const otherShareIncome = otherShares.reduce((s, o) => s + o.amount, 0) + passThrough.reduce((s, o) => s + o.amount, 0);
  const income = Number(m.paycheck_budget) + Number(m.previous_savings || 0) + extraIncome + otherShareIncome;
  const savings = income - totalOutflow;
  return { billsTotal, payablesTotal, totalOutflow, savings, jovenCc, generalLedger, income, extraIncome, otherShares, passThrough, otherShareIncome };
}

function renderJustineSummary() {
  const main = $('#main');
  const months = state.justineMonths.filter(m => !m.archived).sort((a, b) => b.month_date.localeCompare(a.month_date)); // newest first
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
  // Same as Joven's Summary: the newest few months in full, older ones folded
  // to a one-line total you can click open.
  const RECENT_MONTHS_SHOWN = 3;
  months.forEach((m, idx) => {
    const t = justineTotals(m);
    const monthLabel = new Date(m.month_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    const foldKey = 'j:' + monthKey(m.month_date);
    const collapsible = idx >= RECENT_MONTHS_SHOWN;
    if (collapsible && !state.expandedMonths.has(foldKey)) {
      const el = document.createElement('div');
      el.className = 'period-group-card collapsed';
      el.style.gridColumn = '1 / -1';
      el.innerHTML = `
        <button class="pg-toggle" data-toggle-month="${foldKey}" title="Show this month">
          <span class="pg-header">▸ ${monthLabel}</span>
          <span class="pg-mini">Outflow <b>${PESO(t.totalOutflow)}</b><span class="pg-sep">·</span>Ended with <b style="color:${t.savings < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(t.savings)}</b></span>
        </button>`;
      grid.appendChild(el);
      return;
    }
    const el = document.createElement('div');
    el.className = 'period-card';
    el.innerHTML = `
      <div class="ph">
        <div>${collapsible ? `<button class="pg-toggle" data-toggle-month="${foldKey}" title="Collapse this month" style="width:auto;"><span class="tag">▾ ${monthLabel}</span></button>` : `<span class="tag">${monthLabel}</span>`}</div>
        <div>
          <button class="icon-btn edit" data-edit-m="${m.id}" title="Edit" aria-label="Edit">✎</button>
          <button class="icon-btn" data-archive-m="${m.id}" title="Archive" aria-label="Archive">📦</button>
        </div>
      </div>

      ${(() => { // Money in / Money out lines with Received / Paid ticks
        const sc = 'jmonth', ref = m.id, inAcc = [], outAcc = [];
        const inLines = [
          flowLine(inAcc, { scope: sc, ref, key: 'pay', kind: 'in', label: '💰 Paycheck budget', amount: Number(m.paycheck_budget), secret: 'jmonth:' + m.id,
            valHtml: `${salaryDisplay(m.paycheck_budget, 'jmonth:' + m.id)} ${revealBtn('jmonth:' + m.id)}` }),
          flowLine(inAcc, { label: 'Previous savings', amount: Number(m.previous_savings || 0) }),
          ...t.otherShares.map(o => flowLine(inAcc, { scope: sc, ref, key: 'share:' + o.person.toLowerCase(), kind: 'in', amount: o.amount,
            label: `${escapeHtml(o.person)} <span class="synced-badge" title="Their share of: ${escapeHtml(o.plans.join(', '))}">⇄ from installments</span>` })),
          ...t.passThrough.map(o => flowLine(inAcc, { scope: sc, ref, key: 'pass:' + o.person.toLowerCase(), kind: 'in', amount: o.amount,
            label: `${escapeHtml(o.person)} <span class="synced-badge" style="color:var(--purple);background:rgba(167,139,250,.14);" title="Pays Justine back for her share of: ${escapeHtml(o.plans.join(', '))}. She still pays Joven the full share - it's in the Joven CC Total below.">⇄ via Joven's plans</span>` })),
          ...justineIncomeForMonth(m.id).map(item => flowLine(inAcc, { scope: sc, ref, key: 'income:' + item.id, kind: 'in', amount: Number(item.amount),
            label: `${escapeHtml(item.label)}
              <button class="icon-btn edit" data-edit-jincome="${item.id}" style="margin-left:6px;" title="Edit" aria-label="Edit">✎</button>
              <button class="icon-btn" data-del-jincome="${item.id}" title="Delete" aria-label="Delete">✕</button>` })),
        ].join('');
        const color = n => (state.cards.find(c => c.name.toLowerCase() === n) || {}).color;
        const outLines = [
          (t.jovenCc.hasP15 || t.jovenCc.hasP30)
            ? flowLine(outAcc, { scope: sc, ref, key: 'jovencc', kind: 'out', amount: t.jovenCc.total, label: `Joven CC Total <span class="synced-badge" title="Sum of Joven's Justine line on his 15th + 30th periods this month">⇄ synced</span>` })
            : flowLine(outAcc, { label: `Joven CC Total <span class="synced-badge" title="Sum of Joven's Justine line on his 15th + 30th periods this month">⇄ synced</span>`, amount: 0, valHtml: '<span style="color:var(--text-dim)">no periods yet</span>' }),
          flowLine(outAcc, { scope: sc, ref, key: 'bpi', kind: 'out', amount: Number(m.bpi_total), label: `<span class="card-chip"><span class="sw" style="background:${color('bpi') || 'var(--red)'}"></span>BPI</span>` }),
          flowLine(outAcc, { scope: sc, ref, key: 'eastwest', kind: 'out', amount: Number(m.eastwest_total), label: `<span class="card-chip"><span class="sw" style="background:${color('eastwest') || 'var(--purple)'}"></span>Eastwest</span>` }),
          flowLine(outAcc, { scope: sc, ref, key: 'gl', kind: 'out', amount: t.generalLedger, label: 'General ledger' }),
          ...justineBillsForMonth(m.id).map(bl => flowLine(outAcc, { scope: sc, ref, key: 'bill:' + bl.id, kind: 'out', amount: Number(bl.amount),
            label: `${escapeHtml(bl.label)}
              <button class="icon-btn edit" data-edit-bill="${bl.id}" style="margin-left:6px;" title="Edit" aria-label="Edit">✎</button>
              <button class="icon-btn" data-del-bill="${bl.id}" title="Delete" aria-label="Delete">✕</button>` })),
        ].join('');
        return `
      <div class="flow flow-in">
        <div class="flow-head">↓ Money in ${flowProgress(inAcc, 'in')}</div>
        ${inLines}
        ${state.justineIncomeOk ? `<div class="line"><span class="lbl"><button class="icon-btn" data-add-jincome="${m.id}" style="width:auto;padding:2px 8px;font-size:11px;color:var(--gold);border-color:var(--gold);">+ income line</button></span><span class="val"></span></div>` : ''}
        <div class="line flow-total"><span class="lbl">Total in</span><span class="val">${PESO(t.income)}</span></div>
      </div>

      <div class="flow flow-out">
        <div class="flow-head">↑ Money out ${flowProgress(outAcc, 'out')}</div>
        ${outLines}
        <div class="line"><span class="lbl"><button class="icon-btn" data-add-bill="${m.id}" style="width:auto;padding:2px 8px;font-size:11px;color:var(--gold);border-color:var(--gold);">+ bill</button></span><span class="val"></span></div>
        <div class="line flow-total"><span class="lbl">Total out</span><span class="val">${PESO(t.totalOutflow)}</span></div>
      </div>`;
      })()}
      <div class="line savings total"><span class="lbl">Savings <span class="flow-formula">in − out</span></span><span class="val" style="color:${t.savings < 0 ? 'var(--red)' : 'var(--green)'};">${PESO(t.savings)}</span></div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
        <label style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.4px;">Notes</label>
        <textarea data-notes-for="${m.id}" placeholder="Jot anything down here…" style="width:100%;min-height:60px;margin-top:6px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:8px;font-family:inherit;font-size:13px;resize:vertical;">${m.notes ? escapeHtml(m.notes) : ''}</textarea>
      </div>
    `;
    grid.appendChild(el);
  });
  $$('[data-toggle-month]').forEach(btn => btn.onclick = () => {
    const k = btn.dataset.toggleMonth;
    if (state.expandedMonths.has(k)) state.expandedMonths.delete(k); else state.expandedMonths.add(k);
    renderJustineSummary();
  });
  wireLineTicks();
  $$('[data-add-jincome]').forEach(btn => btn.onclick = () => openJustineIncomeModal(null, btn.dataset.addJincome));
  $$('[data-edit-jincome]').forEach(btn => btn.onclick = () => {
    const item = state.justineIncomeItems.find(x => x.id === btn.dataset.editJincome);
    openJustineIncomeModal(item, item.month_id);
  });
  $$('[data-del-jincome]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Delete this income line?')) return;
    if (!dbOk(await db.from('justine_income_items').delete().eq('id', btn.dataset.delJincome))) return;
    await loadAll(); renderView();
  });
  $$('[data-notes-for]').forEach(t => {
    t.onblur = async () => {
      const m = state.justineMonths.find(x => x.id === t.dataset.notesFor);
      if (m && t.value === (m.notes || '')) return; // nothing changed
      if (!dbOk(await db.from('justine_months').update({ notes: t.value }).eq('id', t.dataset.notesFor), 'Notes saved')) return;
      if (m) m.notes = t.value; // keep local state in sync without a full reload/re-render
    };
  });
  $$('[data-edit-m]').forEach(b => b.onclick = () => openJustineMonthModal(state.justineMonths.find(m => m.id === b.dataset.editM)));
  wireRevealToggles();
  $$('[data-archive-m]').forEach(b => b.onclick = () => setArchived('justine_months', b.dataset.archiveM, true, 'Month'));
  $$('[data-add-bill]').forEach(b => b.onclick = () => openJustineBillModal(null, b.dataset.addBill));
  $$('[data-edit-bill]').forEach(b => b.onclick = () => {
    const bill = state.justineBills.find(x => x.id === b.dataset.editBill);
    openJustineBillModal(bill, bill.month_id);
  });
  $$('[data-del-bill]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this bill?')) return;
    if (!dbOk(await db.from('justine_bills').delete().eq('id', b.dataset.delBill))) return;
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
          <div><button class="icon-btn edit" data-restore-m="${m.id}" title="Restore" aria-label="Restore">♻️</button></div>
        </div>
        <div class="line"><span class="lbl">💰</span><span class="val">${salaryDisplay(m.paycheck_budget)}</span></div>
      `;
      ag.appendChild(el);
    });
    $$('[data-restore-m]').forEach(b => b.onclick = () => setArchived('justine_months', b.dataset.restoreM, false, 'Month'));
  }
}

function openJustineMonthModal(month) {
  const isEdit = !!month;
  const m = month || { month_date: '', paycheck_budget: 0, previous_savings: 0, bpi_total: 0, eastwest_total: 0 };
  if (!isEdit) {
    // Brand-new month: start from what the month before it ended with.
    const before = state.justineMonths.filter(x => !x.archived).sort((x, y) => y.month_date.localeCompare(x.month_date))[0];
    if (before) m.previous_savings = round2(justineTotals(before).savings);
  }
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} month</h3>
    <div class="field-row">
      <div class="field"><label>Month</label><input type="month" id="f-month" value="${m.month_date ? m.month_date.slice(0, 7) : ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>💰 Paycheck Budget</label><input type="number" step="0.01" id="f-budget" value="${m.paycheck_budget}"></div>
      <div class="field"><label>Previous savings</label><input type="number" step="0.01" id="f-prev" value="${m.previous_savings || 0}"></div>
    </div>
    <div id="carry-wrap"></div>
    <div class="field-row">
      <div class="field"><label>BPI</label><input type="number" step="0.01" id="f-bpi" value="${m.bpi_total}"></div>
      <div class="field"><label>Eastwest</label><input type="number" step="0.01" id="f-ew" value="${m.eastwest_total}"></div>
    </div>
    <p style="font-size:12px;color:var(--text-dim);">Joven CC Total isn't entered here — it's automatically the sum of Joven's "Justine" line on his 15th + 30th periods for this same month. Savings = money in (💰, previous savings, income lines, shares owed to her) minus money out.</p>
    <div class="modal-actions">
      <button class="btn secondary" id="modal-cancel">Cancel</button>
      <button class="btn" id="modal-save">Save</button>
    </div>
  `);
  // Offers the previous month's ending savings whenever the field doesn't match it.
  const updateCarry = () => {
    const mv = $('#f-month').value;
    const before = mv ? previousJustineMonthOf(mv + '-01', m.id) : null;
    const wrap = $('#carry-wrap');
    if (!before) { wrap.innerHTML = ''; return; }
    const carry = round2(justineTotals(before).savings);
    const lbl = new Date(before.month_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
    if (round2(+$('#f-prev').value || 0) === carry) { wrap.innerHTML = `<div class="carry-note">✓ Matches what ${lbl} ended with</div>`; return; }
    wrap.innerHTML = `<button type="button" class="carry-btn" id="carry-btn">↩ Use ${PESO(carry)} — what ${lbl} ended with</button>`;
    $('#carry-btn').onclick = () => { $('#f-prev').value = carry; updateCarry(); };
  };
  $('#f-month').onchange = updateCarry;
  $('#f-prev').oninput = updateCarry;
  updateCarry();

  $('#modal-save').onclick = async () => {
    const monthVal = $('#f-month').value; // "2026-08"
    if (!monthVal) { toast('Pick a month'); return; }
    const payload = {
      month_date: monthVal + '-01',
      paycheck_budget: +$('#f-budget').value || 0,
      previous_savings: +$('#f-prev').value || 0,
      bpi_total: +$('#f-bpi').value || 0,
      eastwest_total: +$('#f-ew').value || 0,
    };
    let error;
    if (isEdit) ({ error } = await db.from('justine_months').update(payload).eq('id', m.id));
    else ({ error } = await db.from('justine_months').insert(payload));
    if (error) { toast(error.message, { error: true }); return; }
    closeModal(); await loadAll(); renderView();
  };
}

function openJustineIncomeModal(item, monthId) {
  const isEdit = !!item;
  const i = item || { label: '', amount: '' };
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} income line</h3>
    <div class="field-row">
      <div class="field"><label>Label</label><input type="text" id="f-label" value="${i.label ? escapeHtml(i.label) : ''}" placeholder="e.g. Bonus, Side gig"></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="f-amount" value="${i.amount}"></div>
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
    if (isEdit) ({ error } = await db.from('justine_income_items').update(payload).eq('id', i.id));
    else ({ error } = await db.from('justine_income_items').insert(payload));
    if (error) { toast(error.message, { error: true }); return; }
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
    if (error) { toast(error.message, { error: true }); return; }
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

/* ---------------- SUM OF SELECTED AMOUNTS (like Sheets) ----------------
   Drag-select across numbers, or click amounts one by one to pick them, and
   a bar at the bottom shows their sum, average and count. Esc or ✕ clears. */

const PESO_RE = /([+-]?)₱\s?(-?)([\d,]+(?:\.\d+)?)/g;
function pesoValues(text) {
  const vals = [];
  for (const m of text.matchAll(PESO_RE)) {
    const n = Number(m[3].replace(/,/g, ''));
    if (!isNaN(n)) vals.push(m[1] === '-' || m[2] === '-' ? -n : n);
  }
  return vals;
}
const SUMMABLE = '.val, td.num, .stat-value, .sh .total, .snapshot-val, .payoff-chip-amt, .payoff-freed';

function updateSumBar() {
  const bar = $('#sum-bar');
  if (!bar) return;
  let vals = [];
  const picked = $$('.sum-picked');
  if (picked.length) {
    picked.forEach(el => { const v = pesoValues(el.textContent); if (v.length) vals.push(v[0]); });
  } else {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) {
      vals = pesoValues(sel.toString());
    }
  }
  if (!vals.length) { bar.classList.remove('active'); return; }
  const sum = vals.reduce((a, b) => a + b, 0);
  bar.innerHTML = `
    <span>Sum <b>${PESO(sum)}</b></span>
    ${vals.length > 1 ? `<span>Average <b>${PESO(sum / vals.length)}</b></span>` : ''}
    <span>Count <b>${vals.length}</b></span>
    <button type="button" id="sum-bar-clear" title="Clear (Esc)" aria-label="Clear">✕</button>`;
  $('#sum-bar-clear').onclick = clearSumSelection;
  bar.classList.add('active');
}
function clearSumSelection() {
  $$('.sum-picked').forEach(el => el.classList.remove('sum-picked'));
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  updateSumBar();
}
function initSumBar() {
  const bar = document.createElement('div');
  bar.id = 'sum-bar';
  bar.setAttribute('role', 'status');
  document.body.appendChild(bar);
  let t = null;
  document.addEventListener('selectionchange', () => { clearTimeout(t); t = setTimeout(updateSumBar, 80); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && bar.classList.contains('active') && !$('#modal-backdrop').classList.contains('active')) clearSumSelection(); });
  document.addEventListener('click', e => {
    if (e.target.closest('button, a, input, select, textarea, label, .modal')) return;
    const el = e.target.closest(SUMMABLE);
    if (!el || !el.closest('#main') || !pesoValues(el.textContent).length) return;
    if (window.getSelection().toString()) return; // that was a drag-select, not a click
    el.classList.toggle('sum-picked');
    updateSumBar();
  });
  // Any re-render replaces the numbers, so picked ones disappear - refresh the bar.
  new MutationObserver(() => updateSumBar()).observe($('#main'), { childList: true });
}

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

document.addEventListener('DOMContentLoaded', initSumBar);
document.addEventListener('DOMContentLoaded', initAuth);

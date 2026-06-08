'use strict';

/* ═══════════════════════════════════════════════
   DROPDOWN DEFAULTS + LIVE GETTERS
═══════════════════════════════════════════════ */
const DEFAULT_SETUPS = [
  'VCP – Volatility Contraction','Flag & Pole','EMA Pullback (20 EMA)',
  'EMA Pullback (50 EMA)','Cup & Handle','Double Bottom','Double Top',
  'Head & Shoulders','Breakout – Prior High','Breakout – 52W High',
  'Inside Bar / NR7','Momentum / Relative Strength','Gap Up Play',
  'News / Event Based','Trend Reversal','MA Crossover',
  'Support Bounce','Resistance Break','Consolidation Breakout','Other'
];
const DEFAULT_EXITS = [
  'SL Hit','Target Hit','Manual Exit – Planned',
  'Manual Exit – Discretionary','Trailing SL','Partial + Trailing SL',
  'Time-based Exit','News Exit','Other'
];
const DEFAULT_MKT = [
  'Confirmed Uptrend – Strong','Confirmed Uptrend – Moderate',
  'Uptrend Under Pressure','Rally Attempt – Unconfirmed',
  'Market in Correction – Mild','Market in Correction – Severe',
  'Sideways / Rangebound','High Volatility – Choppy',
  'Distribution Phase','Strong Downtrend'
];

/* Always read from cfg so user edits reflect immediately */
const getSetups = () => cfg.dropdowns?.setups    ?? [...DEFAULT_SETUPS];
const getExits  = () => cfg.dropdowns?.exits     ?? [...DEFAULT_EXITS];
const getMkt    = () => cfg.dropdowns?.mktStates ?? [...DEFAULT_MKT];

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
let trades    = [];
let cfg       = { portVal: 0, sbUrl: '', sbKey: '' };
let curView   = 'dashboard';
let curFilter = 'all';
let editId    = null;
let detId     = null;
let formGrade = '';
let formSt    = 'Open';
let formTp    = 'Real';
let formGradeInit = false;
let sbClient  = null;
let selectMode   = false;
let selectedIds  = new Set();
let ddActiveKey  = 'setups';
let ddEditIndex  = null;
let csvPendingRows = [];
let ledgerFilter = 'all';
let ledgerSearch = '';
let hiddenCols   = new Set();
let sortCol      = null;   // column label currently sorted
let sortDir      = 'asc';  // 'asc' | 'desc'
let dashSortCol  = null;   // dashboard open table sort column
let dashSortDir  = 'asc';
let livePrices   = {};
let lpFetching   = false;

function setGrade(g, btn) {
  formGrade = g;
  document.querySelectorAll('.grade-btn').forEach(b => {
    b.classList.remove('grade-a','grade-b','grade-c','grade-d','grade-active');
  });
  if (btn && g) {
    btn.classList.add('grade-active', 'grade-'+g.toLowerCase());
  }
  const hints = { A:'Perfect execution — followed rules exactly', B:'Good — minor deviation', C:'Average — notable mistakes', D:'Poor — broke rules / revenge trade', '':'Not graded' };
  const hint = document.getElementById('grade-hint');
  if (hint) hint.textContent = hints[g] || 'A=Perfect · B=Good · C=Average · D=Mistake';
}

function resetGrade() {
  formGrade = '';
  document.querySelectorAll('.grade-btn').forEach(b => b.classList.remove('grade-a','grade-b','grade-c','grade-d','grade-active'));
  const hint = document.getElementById('grade-hint');
  if (hint) hint.textContent = 'A=Perfect · B=Good · C=Average · D=Mistake';
}

function gradeBadgeHTML(g) {
  if (!g) return '';
  const map = { A:'grade-a', B:'grade-b', C:'grade-c', D:'grade-d' };
  return `<span class="grade-badge ${map[g]||''}">${g}</span>`;
}

/* ═══════════════════════════════════════════════
   MATH HELPERS
═══════════════════════════════════════════════ */
const num = v => (v===''||v===null||v===undefined||isNaN(parseFloat(v))) ? null : parseFloat(v);

function slPct(bp, sl)    { return (bp&&sl&&bp>0) ? (bp-sl)/bp*100 : null; }
function allocPct(al, pv) { return (al&&pv&&pv>0) ? al/pv*100 : null; }
function calcQty(al, bp)  { return (al&&bp&&bp>0) ? Math.floor(al/bp) : null; }
function calcPnlV(bp,sp,q){ return (bp&&sp&&q!=null) ? (sp-bp)*q : null; }
function calcPnlP(bp, sp) { return (bp&&sp&&bp>0) ? (sp-bp)/bp*100 : null; }
function portPnlP(pnlV,pv){ return (pnlV!==null&&pv&&pv>0) ? pnlV/pv*100 : null; }
function calcRR(bp,sp,sl) {
  if (!bp||!sp||!sl) return null;
  const risk = bp - sl;
  return risk === 0 ? null : (sp - bp) / risk;
}
function daysHeld(bd, sd) {
  if (!bd) return null;
  const b = new Date(bd);
  const s = sd ? new Date(sd) : new Date();
  const d = Math.round((s - b) / 86400000);
  return d >= 0 ? d : null;
}
function fullCalcs(t) {
  const pv   = t.portVal || cfg.portVal || 0;
  const q    = t.qty ?? calcQty(t.alloc, t.buyPx);   // backward compat: old trades had alloc
  const al   = (t.buyPx && q) ? t.buyPx * q : (t.alloc || null);
  const sl   = slPct(t.buyPx, t.sl);
  const ap   = allocPct(al, pv);
  const closed = t.status === 'Closed' && t.sellPx;
  const pv2  = closed ? calcPnlV(t.buyPx, t.sellPx, q) : null;
  const pp   = closed ? calcPnlP(t.buyPx, t.sellPx)    : null;
  const ppp  = portPnlP(pv2, pv);
  const rr   = closed ? calcRR(t.buyPx, t.sellPx, t.sl) : null;
  const days = daysHeld(t.buyDate, closed ? t.sellDate : null);
  return { q, al, sl, ap, pnlV:pv2, pnlP:pp, portPnl:ppp, rr, days };
}

/* ═══════════════════════════════════════════════
   FORMAT HELPERS
═══════════════════════════════════════════════ */
const f2  = v => (v===null||v===undefined||isNaN(v)) ? '—' : v.toFixed(2);
const f0  = v => (v===null||v===undefined||isNaN(v)) ? '—' : Math.round(v).toString();
const sgn = v => (v > 0 ? '+' : '');
const pCls= v => (v===null||v===undefined) ? 'val-n' : (v>=0 ? 'val-p' : 'val-l');

function fINR(v, compact=false) {
  if (v===null||v===undefined||isNaN(v)) return '—';
  const abs=Math.abs(v), s=v<0?'-':v>0?'+':'';
  if (compact) {
    if (abs>=1e7) return s+'₹'+(abs/1e7).toFixed(2)+'Cr';
    if (abs>=1e5) return s+'₹'+(abs/1e5).toFixed(2)+'L';
    if (abs>=1e3) return s+'₹'+(abs/1e3).toFixed(1)+'K';
    return s+'₹'+abs.toFixed(0);
  }
  return s+'₹'+abs.toLocaleString('en-IN',{maximumFractionDigits:2});
}
function fBig(v) {
  if (!v||v===0) return '₹—';
  if (v>=1e7) return '₹'+(v/1e7).toFixed(2)+' Cr';
  if (v>=1e5) return '₹'+(v/1e5).toFixed(2)+' L';
  if (v>=1e3) return '₹'+(v/1e3).toFixed(1)+' K';
  return '₹'+v.toFixed(0);
}
function fDate(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return parts.length===3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
}

/* ═══════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════ */
function applyTheme(th) {
  document.documentElement.setAttribute('data-theme', th);
  const isLight = th === 'light';
  const thumb = document.getElementById('ts-thumb');
  const sub   = document.getElementById('theme-sub');
  if (thumb) thumb.textContent = isLight ? '☀️' : '🌙';
  if (sub)   sub.textContent   = isLight ? 'Light mode active' : 'Dark mode active';
  localStorage.setItem('tl_theme', th);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}
function loadTheme() {
  const saved = localStorage.getItem('tl_theme') || 'dark';
  applyTheme(saved);
}

/* ═══════════════════════════════════════════════
   STORAGE — with automatic backup protection
═══════════════════════════════════════════════ */
const LS_T      = 'tl_trades';
const LS_C      = 'tl_cfg';
const LS_T_BAK  = 'tl_trades_bak';   // rolling backup written every save
const LS_C_BAK  = 'tl_cfg_bak';
const LS_T_PREV = 'tl_trades_prev';  // previous version (one save older)

function saveTrades() {
  try {
    const json = JSON.stringify(trades);
    // Rotate: current → prev backup before overwriting
    const existing = localStorage.getItem(LS_T);
    if (existing) {
      localStorage.setItem(LS_T_PREV, existing);
    }
    localStorage.setItem(LS_T, json);
    localStorage.setItem(LS_T_BAK, json);   // mirror backup
    localStorage.setItem('tl_last_save', new Date().toISOString());
  } catch(e) {
    console.error('TradeLog: save failed', e);
  }
}

function loadTrades() {
  // Try primary, then backup, then prev backup — never silently return []
  const sources = [LS_T, LS_T_BAK, LS_T_PREV];
  for (const key of sources) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        trades = parsed;
        if (key !== LS_T) {
          // Recovered from backup — restore primary immediately
          console.warn(`TradeLog: recovered trades from ${key}`);
          localStorage.setItem(LS_T, raw);
          toast(`⚠ Trades recovered from backup (${key})`);
        }
        return;
      }
    } catch(e) {
      console.warn(`TradeLog: ${key} corrupt, trying next`, e);
    }
  }
  trades = [];  // genuinely empty — first run
}

function persistSettings() {
  cfg.portVal = parseFloat(document.getElementById('s-port').value) || 0;
  saveCfg();
}

function saveCfg() {
  try {
    const json = JSON.stringify(cfg);
    localStorage.setItem(LS_C, json);
    localStorage.setItem(LS_C_BAK, json);  // mirror backup
  } catch(e) {
    console.error('TradeLog: cfg save failed', e);
  }
}

/* Deep-merge: add new keys from src only if NOT already in target */
function safeMerge(target, src) {
  Object.keys(src).forEach(k => {
    if (!(k in target)) {
      target[k] = src[k];
    } else if (
      typeof src[k] === 'object' && src[k] !== null && !Array.isArray(src[k]) &&
      typeof target[k] === 'object' && target[k] !== null && !Array.isArray(target[k])
    ) {
      safeMerge(target[k], src[k]);
    }
  });
  return target;
}

function loadCfg() {
  const sources = [LS_C, LS_C_BAK];
  for (const key of sources) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const stored = JSON.parse(raw);
      cfg = safeMerge(stored, { portVal:0, sbUrl:'', sbKey:'', features:{}, dropdowns:{} });
      if (key !== LS_C) {
        console.warn('TradeLog: cfg recovered from backup');
        localStorage.setItem(LS_C, raw);
      }
      return;
    } catch(e) {
      console.warn(`TradeLog: ${key} corrupt, trying next`, e);
    }
  }
  // No saved cfg — fresh start, keep defaults
}

/* Called at boot: adds new keys introduced by patches, never wipes existing data */
function migrateSettings() {
  let changed = false;
  if (!cfg.features || Object.keys(cfg.features).length === 0) {
    cfg.features = defaultFeatures();
    changed = true;
  } else {
    FEATURES.forEach(ft => {
      if (!(ft.id in cfg.features)) {
        cfg.features[ft.id] = ft.def;
        changed = true;
      }
    });
  }
  if (changed) saveCfg();
}

/* Manual recovery helper — callable from browser console */
window.tlRecover = function() {
  const sources = [LS_T, LS_T_BAK, LS_T_PREV];
  console.table(sources.map(k => {
    const raw = localStorage.getItem(k);
    let count = 0;
    try { count = raw ? JSON.parse(raw).length : 0; } catch(e) {}
    return { key: k, trades: count, size: raw ? raw.length + ' chars' : 'empty' };
  }));
  console.log('To restore from backup: tlRestoreFrom("tl_trades_bak")');
};
window.tlRestoreFrom = function(key) {
  const raw = localStorage.getItem(key);
  if (!raw) { console.error('Key not found:', key); return; }
  localStorage.setItem(LS_T, raw);
  location.reload();
};

/* ═══════════════════════════════════════════════
   SUPABASE — auto-sync on load + Realtime
═══════════════════════════════════════════════ */
let sbChannel = null;

function initSB() {
  const pill = document.getElementById('sync-pill');
  if (cfg.sbUrl && cfg.sbKey && window.supabase) {
    try {
      sbClient = window.supabase.createClient(cfg.sbUrl.trim(), cfg.sbKey.trim());
      if (pill) pill.innerHTML = '<span class="sync-pill">☁ SYNC ON</span>';
      // Auto-pull on every page load so any browser stays in sync
      autoSyncOnLoad();
      // Subscribe to Realtime changes so edits on another device appear instantly
      subscribeRealtime();
      return true;
    } catch(e) {
      sbClient = null;
      if (pill) pill.innerHTML = '';
      return false;
    }
  } else {
    sbClient = null;
    if (pill) pill.innerHTML = '';
    return false;
  }
}

async function autoSyncOnLoad() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient
      .from('tradelog').select('*').order('updated_at', { ascending: false });
    if (error || !data?.length) return;

    const cloud = data.map(r => JSON.parse(r.payload));

    // Merge strategy: cloud wins for any trade that's newer than local copy
    let changed = false;
    cloud.forEach(ct => {
      const li = trades.findIndex(t => t.id === ct.id);
      if (li === -1) {
        trades.unshift(ct);
        changed = true;
      } else if ((ct.upd || 0) > (trades[li].upd || 0)) {
        trades[li] = ct;
        changed = true;
      }
    });

    if (changed) {
      saveTrades();
      renderAll();
      const pill = document.getElementById('sync-pill');
      if (pill) pill.innerHTML = '<span class="sync-pill">☁ SYNCED</span>';
      setTimeout(() => {
        if (pill) pill.innerHTML = '<span class="sync-pill">☁ SYNC ON</span>';
      }, 3000);
    }
  } catch(e) {
    console.warn('TradeLog autoSync:', e.message);
  }
}

function subscribeRealtime() {
  if (!sbClient) return;
  // Unsubscribe existing channel first
  if (sbChannel) { sbClient.removeChannel(sbChannel); sbChannel = null; }
  sbChannel = sbClient
    .channel('tradelog-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'tradelog' },
      payload => {
        handleRealtimeChange(payload);
      }
    )
    .subscribe(status => {
      const pill = document.getElementById('sync-pill');
      if (status === 'SUBSCRIBED') {
        if (pill) pill.innerHTML = '<span class="sync-pill">☁ LIVE</span>';
      }
    });
}

function handleRealtimeChange(payload) {
  try {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id;
      if (id) { trades = trades.filter(t => t.id !== id); saveTrades(); renderAll(); }
      return;
    }
    const row = payload.new;
    if (!row?.payload) return;
    const ct = JSON.parse(row.payload);
    const li = trades.findIndex(t => t.id === ct.id);
    if (li === -1) trades.unshift(ct);
    else trades[li] = ct;
    saveTrades(); renderAll();
    toast('☁ Synced from another device');
  } catch(e) {
    console.warn('TradeLog realtime:', e.message);
  }
}

// Push a single trade to cloud immediately after save
async function pushTrade(t) {
  if (!sbClient) return;
  try {
    await sbClient.from('tradelog').upsert(
      { id: t.id, payload: JSON.stringify(t), updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
  } catch(e) {
    console.warn('TradeLog pushTrade:', e.message);
  }
}

// Delete a trade from cloud
async function deleteTradeCloud(id) {
  if (!sbClient) return;
  try { await sbClient.from('tradelog').delete().eq('id', id); }
  catch(e) { console.warn('TradeLog deleteCloud:', e.message); }
}

function setConnStatus(type, msg) {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.innerHTML = `<div class="conn-badge conn-${type}">${msg}</div>`;
}

async function saveAndTestSB() {
  const url = document.getElementById('s-url').value.trim();
  const key = document.getElementById('s-key').value.trim();

  if (!url || !key) {
    setConnStatus('err', '✗ Enter Project URL and Anon Key first');
    return;
  }
  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    setConnStatus('err', '✗ URL should be https://xxxxx.supabase.co');
    return;
  }
  if (!key.startsWith('eyJ')) {
    setConnStatus('err', '✗ Anon key should start with eyJ…');
    return;
  }

  // Save to cfg
  cfg.sbUrl = url;
  cfg.sbKey = key;
  cfg.portVal = parseFloat(document.getElementById('s-port').value)||0;
  saveCfg();

  setConnStatus('ing', '⏳ Connecting…');
  const ok = initSB();
  if (!ok) { setConnStatus('err', '✗ Failed to create Supabase client'); return; }

  // Actual network test — list rows (empty is fine, error means bad creds/missing table)
  try {
    const { data, error } = await sbClient
      .from('tradelog').select('id').limit(1);
    if (error) {
      if (error.code === '42P01') {
        // Table doesn't exist yet — credentials are fine!
        setConnStatus('ok', '✓ Connected! (Run supabase-schema.sql to create table)');
      } else {
        setConnStatus('err', '✗ ' + (error.message || error.code));
      }
    } else {
      setConnStatus('ok', '✓ Connected — ' + (data.length ? data.length+' row(s) found' : 'table ready'));
    }
  } catch(e) {
    setConnStatus('err', '✗ Network error: ' + e.message);
  }
}

async function pushCloud() {
  if (!sbClient) { toast('⚠ Set up Supabase in Settings → Save & Test first'); return; }
  try {
    toast('Pushing to cloud…');
    const rows = trades.map(t => ({
      id: t.id,
      payload: JSON.stringify(t),
      updated_at: new Date().toISOString()
    }));
    const { error } = await sbClient.from('tradelog').upsert(rows, { onConflict:'id' });
    if (error) throw error;
    toast('✓ Pushed ' + trades.length + ' trades to cloud');
  } catch(e) { toast('✗ Push failed: ' + e.message); }
}

async function pullCloud() {
  if (!sbClient) { toast('⚠ Set up Supabase in Settings → Save & Test first'); return; }
  try {
    toast('Pulling from cloud…');
    const { data, error } = await sbClient
      .from('tradelog').select('*').order('updated_at', { ascending:false });
    if (error) throw error;
    if (data && data.length) {
      trades = data.map(r => JSON.parse(r.payload));
      saveTrades(); renderAll();
      toast('✓ Pulled ' + trades.length + ' trades');
    } else { toast('ℹ No cloud data found yet — Push first'); }
  } catch(e) { toast('✗ Pull failed: ' + e.message); }
}

/* ═══════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════ */
function switchView(v) {
  curView = v;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.remove('active'));
  const viewEl = document.getElementById('v-'+v);
  if (viewEl) viewEl.classList.add('active');
  document.querySelector(`.nav-item[data-view="${v}"]`)?.classList.add('active');
  if (v==='dashboard') { renderDash(); fetchOpenPrices(); }
  if (v==='table')     { renderTable(); fetchOpenPrices(); }
  if (v==='analytics') renderAnalytics();
}

/* ═══════════════════════════════════════════════
   DROPDOWN INIT — rebuilds select options from cfg
═══════════════════════════════════════════════ */
function initDropdowns() {
  rebuildSelects();
}

function rebuildSelects() {
  const fill = (id, arr) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;          // preserve current selection
    sel.innerHTML = '<option value="">— Select —</option>';
    arr.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;      // restore if it still exists
  };
  fill('f-setup', getSetups());
  fill('f-exit',  getExits());
  fill('f-mkt',   getMkt());
}

/* ═══════════════════════════════════════════════
   FORM AUTO-CALC
═══════════════════════════════════════════════ */
function calc() {
  const bp  = num(document.getElementById('f-buypx').value);
  const sl  = num(document.getElementById('f-sl').value);
  const q   = num(document.getElementById('f-qty-input').value);   // USER enters qty now
  const pv  = num(document.getElementById('f-port').value) || cfg.portVal;
  const sp  = num(document.getElementById('f-sellpx').value);
  const bd  = document.getElementById('f-buydate').value;
  const sd  = document.getElementById('f-selldate').value;

  // SL %
  const slP = slPct(bp, sl);
  setAuto('f-slpct', slP!==null ? f2(slP)+'%' : '—');

  // Allocation ₹ = buy price × qty  (AUTO)
  const al = (bp && q) ? bp * q : null;
  setAuto('f-alloc-auto', al!==null ? '₹'+al.toLocaleString('en-IN',{maximumFractionDigits:2}) : '—');

  // Alloc %  (AUTO)
  const alP = allocPct(al, pv);
  setAuto('f-allocpct', alP!==null ? f2(alP)+'%' : '—');

  // Days
  const days = daysHeld(bd, formSt==='Closed'&&sd ? sd : null);
  setAuto('f-days', days!==null ? days+'d' : '—');

  // P&L results (only if closed + sell price)
  if (formSt==='Closed' && sp && bp) {
    const pv2 = calcPnlV(bp, sp, q);
    const pp  = calcPnlP(bp, sp);
    const ppp = portPnlP(pv2, pv);
    const rr  = calcRR(bp, sp, sl);
    setAutoCol('f-pnlv',   pv2!==null ? fINR(pv2)            : '—', pv2);
    setAutoCol('f-pnlp',   pp!==null  ? sgn(pp)+f2(pp)+'%'   : '—', pp);
    setAutoCol('f-portpnl',ppp!==null ? sgn(ppp)+f2(ppp)+'%' : '—', ppp);
    setAuto('f-rr', rr!==null ? f2(rr)+'x' : '—');
  } else {
    ['f-pnlv','f-pnlp','f-portpnl'].forEach(id => {
      const el=document.getElementById(id);
      if(el){el.value='—';el.className='f-ctrl is-auto';}
    });
    setAuto('f-rr','—');
  }
}
function setAuto(id, val) {
  const el=document.getElementById(id);
  if(el){el.value=val;el.className='f-ctrl is-auto';}
}
function setAutoCol(id, val, n2) {
  const el=document.getElementById(id); if(!el) return;
  el.value=val;
  el.className='f-ctrl '+(n2===null||n2===undefined?'is-auto':n2>=0?'is-profit':'is-loss');
}

/* ═══════════════════════════════════════════════
   TOGGLES
═══════════════════════════════════════════════ */
function setStatus(st) {
  formSt = st;
  document.getElementById('tog-open').className   = 'tog-btn'+(st==='Open'  ?' t-open':'');
  document.getElementById('tog-closed').className = 'tog-btn'+(st==='Closed'?' t-closed':'');
  document.getElementById('exit-section').style.display = st==='Closed'?'block':'none';
  calc();
}
function setType(tp) {
  formTp = tp;
  document.getElementById('tog-real').className    = 'tog-btn'+(tp==='Real'   ?' t-real':'');
  document.getElementById('tog-virtual').className = 'tog-btn'+(tp==='Virtual'?' t-virtual':'');
}

/* ═══════════════════════════════════════════════
   TRADE MODAL
═══════════════════════════════════════════════ */
function openTradeModal(id) {
  editId = id;
  document.getElementById('mo-trade-title').textContent = id ? 'EDIT TRADE' : 'NEW TRADE';
  document.getElementById('del-btn').style.display = id ? 'flex' : 'none';
  resetForm();
  if (id) {
    const t = trades.find(x=>x.id===id);
    if (t) fillForm(t);
  } else {
    document.getElementById('f-buydate').value = new Date().toISOString().split('T')[0];
    if (cfg.portVal) document.getElementById('f-port').value = cfg.portVal;
    setStatus('Open'); setType('Real');
  }
  document.getElementById('mo-trade').classList.add('open');
  // Scroll form to top
  setTimeout(()=>{ const b=document.querySelector('#mo-trade .modal-body'); if(b) b.scrollTop=0; },50);
}
function closeTradeMo() {
  document.getElementById('mo-trade').classList.remove('open');
  editId=null;
}
function resetForm() {
  ['f-stock','f-buydate','f-buypx','f-emp','f-emd',
   'f-selldate','f-sellpx','f-sl','f-qty-input','f-port','f-notes'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  ['f-setup','f-exit','f-mkt'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.selectedIndex=0;
  });
  resetGrade();
  ['f-slpct','f-allocpct','f-alloc-auto','f-pnlv','f-pnlp','f-portpnl','f-rr','f-days'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.value='—';el.className='f-ctrl is-auto';}
  });
}
function fillForm(t) {
  const set=(id,val)=>{ const el=document.getElementById(id); if(el&&val!=null) el.value=val; };
  set('f-stock',   t.stock);
  set('f-buydate', t.buyDate);
  set('f-buypx',   t.buyPx);
  set('f-emp',     t.emPrev);
  set('f-emd',     t.emDay);
  set('f-selldate',t.sellDate);
  set('f-sellpx',  t.sellPx);
  set('f-sl',      t.sl);
  set('f-qty-input', t.qty);
  set('f-port',    t.portVal||cfg.portVal||'');
  set('f-setup',    t.setup);
  set('f-exit',     t.exitR);
  set('f-mkt',      t.mktState);
  set('f-notes',    t.notes);
  setStatus(t.status||'Open');
  setType(t.type||'Real');
  // restore grade
  formGrade = t.grade || '';
  document.querySelectorAll('.grade-btn').forEach(b => {
    b.classList.remove('grade-a','grade-b','grade-c','grade-d','grade-active');
    if (b.dataset.g === formGrade && formGrade) {
      b.classList.add('grade-active','grade-'+formGrade.toLowerCase());
    }
  });
  calc();
}
function saveTrade() {
  const stock = document.getElementById('f-stock').value.trim().toUpperCase();
  if (!stock)  { toast('⚠ Stock symbol is required'); return; }
  const buyPx = num(document.getElementById('f-buypx').value);
  if (!buyPx)  { toast('⚠ Buy price is required'); return; }

  const t = {
    id:       editId||uid(),
    stock,
    buyDate:  document.getElementById('f-buydate').value||null,
    buyPx,
    emPrev:   num(document.getElementById('f-emp').value),
    emDay:    num(document.getElementById('f-emd').value),
    sellDate: document.getElementById('f-selldate').value||null,
    sellPx:   num(document.getElementById('f-sellpx').value),
    sl:       num(document.getElementById('f-sl').value),
    qty:      num(document.getElementById('f-qty-input').value),
    get alloc() { return (this.buyPx && this.qty) ? this.buyPx * this.qty : null; },
    portVal:  num(document.getElementById('f-port').value)||cfg.portVal||0,
    setup:    document.getElementById('f-setup').value,
    exitR:    document.getElementById('f-exit').value,
    mktState: document.getElementById('f-mkt').value,
    notes:    document.getElementById('f-notes').value.trim(),
    grade:    formGrade,
    status:   formSt,
    type:     formTp,
    ts:  editId?(trades.find(x=>x.id===editId)?.ts||Date.now()):Date.now(),
    upd: Date.now()
  };

  if (editId) {
    const i=trades.findIndex(x=>x.id===editId);
    if(i>=0) trades[i]=t; else trades.unshift(t);
  } else {
    trades.unshift(t);
  }
  saveTrades(); closeTradeMo(); renderAll();
  pushTrade(t);   // auto-sync to cloud
  toast(editId ? '✓ Trade updated' : '✓ Trade saved');
}
function uid() { return 'tl_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); }

/* ═══════════════════════════════════════════════
   DELETE
═══════════════════════════════════════════════ */
function confirmDelete() {
  window._bulkDeletePending = false;
  document.querySelector('#confirm-box h3').textContent = 'Delete Trade?';
  document.querySelector('#confirm-box p').textContent  = 'This action cannot be undone.';
  document.getElementById('confirm-ov').classList.add('open');
}

/* ═══════════════════════════════════════════════
   DETAIL MODAL
═══════════════════════════════════════════════ */
function openDetailMo(id) {
  detId=id;
  const t=trades.find(x=>x.id===id); if(!t) return;
  const c=fullCalcs(t);

  // Title with badges + TV link
  document.getElementById('det-title').innerHTML =
    `${t.stock}&nbsp;<span class="badge b-${t.status.toLowerCase()}">${t.status}</span>&nbsp;<span class="badge b-${t.type.toLowerCase()}">${t.type}</span>
     &nbsp;<a href="${tvURL(t.stock)}" target="_blank" rel="noopener" class="tv-link-btn" onclick="event.stopPropagation()">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
       TradingView ↗
     </a>`;

  const row=(lbl,val)=>`<div class="dc"><div class="dc-lbl">${lbl}</div><div class="dc-val">${val}</div></div>`;
  const pRow=(lbl,val,n2)=>row(lbl,`<span class="${pCls(n2)}">${val}</span>`);

  let html='<div class="detail-grid">';
  html+=row('Buy Date',     fDate(t.buyDate));
  html+=row('Buy Price',    t.buyPx ? '₹'+t.buyPx : '—');
  html+=row('EM Prev Day',  t.emPrev ? '₹'+t.emPrev : '—');
  html+=row('EM Entry Day', t.emDay  ? '₹'+t.emDay  : '—');
  html+=row('Sell Date',    fDate(t.sellDate));
  html+=row('Sell Price',   t.sellPx ? '₹'+t.sellPx : '—');
  html+=row('SL Price',     t.sl     ? '₹'+t.sl     : '—');
  html+=pRow('SL %',        c.sl!==null ? f2(c.sl)+'%' : '—', c.sl!==null?-c.sl:null);
  html+=row('Allocation',   c.al ? fINR(c.al) : '—');
  html+=row('Alloc %',      c.ap!==null ? f2(c.ap)+'%' : '—');
  html+=row('Quantity',     c.q!==null  ? c.q+' shares' : '—');
  html+=row('Portfolio',    fBig(t.portVal||cfg.portVal));
  html+=pRow('P&amp;L ₹',  c.pnlV!==null ? fINR(c.pnlV) : '—', c.pnlV);
  html+=pRow('P&amp;L %',  c.pnlP!==null ? sgn(c.pnlP)+f2(c.pnlP)+'%' : '—', c.pnlP);
  html+=pRow('Port P&amp;L%',c.portPnl!==null?sgn(c.portPnl)+f2(c.portPnl)+'%':'—',c.portPnl);
  html+=pRow('R:R Ratio',   c.rr!==null ? f2(c.rr)+'x' : '—', c.rr);
  html+=row('Days Held',    c.days!==null ? c.days+'d'+(t.status==='Open'?' (open)':'') : '—');
  html+=row('Setup',        t.setup||'—');
  html+=row('Exit Reason',  t.exitR||'—');
  html+=row('Market State', t.mktState||'—');
  html+=row('Exec Grade',   t.grade ? gradeBadgeHTML(t.grade) : '—');
  html+='</div>';

  if(t.notes) {
    html+=`<div style="background:var(--bg3);border-radius:var(--r);padding:12px;border:1px solid var(--border)">
      <div style="font-family:var(--ff-d);font-size:9px;letter-spacing:2px;color:var(--text3);margin-bottom:6px;text-transform:uppercase">Notes</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.65">${t.notes.replace(/\n/g,'<br>')}</div>
    </div>`;
  }
  document.getElementById('det-body').innerHTML=html;
  document.getElementById('mo-detail').classList.add('open');
}
function closeDetailMo() {
  document.getElementById('mo-detail').classList.remove('open');
  detId=null;
}
function editFromDetail() {
  const id=detId; closeDetailMo(); openTradeModal(id);
}

/* ═══════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════ */
function openSettings() {
  document.getElementById('s-port').value = cfg.portVal||'';
  document.getElementById('s-url').value  = cfg.sbUrl||'';
  document.getElementById('s-key').value  = cfg.sbKey||'';
  const statusEl = document.getElementById('conn-status');
  if (statusEl) {
    if (sbClient && cfg.sbUrl && cfg.sbKey) {
      statusEl.innerHTML = '<div class="conn-badge conn-ok">✓ Credentials saved — use Push/Pull to sync</div>';
    } else if (cfg.sbUrl || cfg.sbKey) {
      statusEl.innerHTML = '<div class="conn-badge conn-err">Not tested yet — tap Save &amp; Test</div>';
    } else {
      statusEl.innerHTML = '';
    }
  }
  const th = document.documentElement.getAttribute('data-theme')||'dark';
  applyTheme(th);
  renderFeatureList();
  renderDropdownEditor();
  updateBackupStatus();
  renderDebugLog();
  document.getElementById('mo-settings').classList.add('open');
}
function closeSettings() {
  document.getElementById('mo-settings').classList.remove('open');
  renderAll();
}

/* ═══════════════════════════════════════════════
   DROPDOWN EDITOR
═══════════════════════════════════════════════ */

// Three managed lists
const DD_META = [
  { key:'setups',    label:'Setup / Pattern',  icon:'🔭', getter: getSetups,  defaults: DEFAULT_SETUPS },
  { key:'exits',     label:'Exit Reason',       icon:'🚪', getter: getExits,   defaults: DEFAULT_EXITS  },
  { key:'mktStates', label:'Market State',      icon:'🌡️', getter: getMkt,     defaults: DEFAULT_MKT    },
];

// Which list is being edited right now

function renderDropdownEditor() {
  const wrap = document.getElementById('dd-editor');
  if (!wrap) return;
  const meta  = DD_META.find(m => m.key === ddActiveKey);
  const items = meta.getter();

  let html = '<div class="dd-tabs">';
  DD_META.forEach(m => {
    const active = ddActiveKey === m.key ? ' dd-tab-active' : '';
    html += `<div class="dd-tab${active}" onclick="switchDdTab('${m.key}')">${m.icon} ${m.label}</div>`;
  });
  html += '</div>';
  html += `<div style="font-size:10px;color:var(--text3);margin-bottom:6px;font-family:var(--ff-d);letter-spacing:.8px">⠿ Drag to reorder &nbsp;·&nbsp; ✏️ Edit &nbsp;·&nbsp; ✕ Remove</div>`;
  html += '<div class="dd-list" id="dd-list">';
  items.forEach((item, i) => {
    html += `<div class="dd-item" id="ddi-${i}" draggable="true"
      ondragstart="ddDragStart(${i})"
      ondragover="ddDragOver(event,${i})"
      ondrop="ddDrop(event,${i})"
      ondragend="ddDragEnd()">
      <div class="dd-drag" title="Drag to reorder">⠿</div>
      <div class="dd-item-text">${escHtml(item)}</div>
      <div class="dd-item-actions">
        <button class="dd-btn dd-edit-btn" onclick="startEditDdItem(${i})" title="Edit">✏️</button>
        <button class="dd-btn dd-del-btn"  onclick="deleteDdItem(${i})"    title="Remove">✕</button>
      </div>
    </div>`;
  });
  html += '</div>';
  html += `<div class="dd-add-row">
    <input id="dd-new-input" class="f-ctrl" type="text" placeholder="Type new option and press Add…" onkeydown="if(event.key==='Enter') addDdItem()">
    <button class="btn btn-primary dd-add-btn" onclick="addDdItem()">Add</button>
  </div>`;
  html += `<button class="feat-reset-btn" onclick="resetDdList('${ddActiveKey}')">↺ Reset to defaults</button>`;
  wrap.innerHTML = html;
}

let ddDragIdx = null;
function ddDragStart(i) {
  ddDragIdx = i;
  setTimeout(() => { const el=document.getElementById('ddi-'+i); if(el) el.style.opacity='0.4'; }, 0);
}
function ddDragOver(e, i) {
  e.preventDefault(); e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.dd-item').forEach(el=>el.classList.remove('dd-drag-over'));
  const el=document.getElementById('ddi-'+i);
  if(el && i!==ddDragIdx) el.classList.add('dd-drag-over');
}
function ddDrop(e, targetIdx) {
  e.preventDefault();
  if(ddDragIdx===null||ddDragIdx===targetIdx) return;
  if(!cfg.dropdowns) cfg.dropdowns={};
  const meta=DD_META.find(m=>m.key===ddActiveKey);
  const items=[...meta.getter()];
  const moved=items.splice(ddDragIdx,1)[0];
  items.splice(targetIdx,0,moved);
  cfg.dropdowns[ddActiveKey]=items;
  saveCfg(); rebuildSelects(); renderDropdownEditor();
}
function ddDragEnd() {
  ddDragIdx=null;
  document.querySelectorAll('.dd-item').forEach(el=>{el.style.opacity='';el.classList.remove('dd-drag-over');});
}


function switchDdTab(key) {
  ddActiveKey = key;
  // Cancel any in-progress edit
  ddEditIndex = null;
  renderDropdownEditor();
}


function startEditDdItem(i) {
  const meta  = DD_META.find(m => m.key === ddActiveKey);
  const items = meta.getter();
  const item  = document.getElementById('ddi-'+i);
  if (!item) return;
  item.innerHTML = `
    <div class="dd-drag">⠿</div>
    <input class="f-ctrl dd-inline-input" id="dd-edit-inp-${i}"
           value="${escHtml(items[i])}"
           onkeydown="if(event.key==='Enter') saveDdEdit(${i}); if(event.key==='Escape') renderDropdownEditor()">
    <div class="dd-item-actions">
      <button class="dd-btn dd-save-btn" onclick="saveDdEdit(${i})">✓</button>
      <button class="dd-btn dd-del-btn"  onclick="renderDropdownEditor()">✕</button>
    </div>`;
  document.getElementById('dd-edit-inp-'+i)?.focus();
}

function saveDdEdit(i) {
  const inp = document.getElementById('dd-edit-inp-'+i);
  if (!inp) return;
  const val = inp.value.trim();
  if (!val) { toast('⚠ Option cannot be empty'); return; }
  if (!cfg.dropdowns) cfg.dropdowns = {};
  const meta  = DD_META.find(m => m.key === ddActiveKey);
  const items = [...meta.getter()];
  items[i] = val;
  cfg.dropdowns[ddActiveKey] = items;
  saveCfg();
  rebuildSelects();
  renderDropdownEditor();
  toast('✓ Updated');
}

function deleteDdItem(i) {
  if (!cfg.dropdowns) cfg.dropdowns = {};
  const meta  = DD_META.find(m => m.key === ddActiveKey);
  const items = [...meta.getter()];
  const removed = items.splice(i, 1)[0];
  cfg.dropdowns[ddActiveKey] = items;
  saveCfg();
  rebuildSelects();
  renderDropdownEditor();
  toast(`Removed "${removed}"`);
}

function addDdItem() {
  const inp = document.getElementById('dd-new-input');
  if (!inp) return;
  const val = inp.value.trim();
  if (!val) { toast('⚠ Type an option name first'); return; }
  // Only create cfg.dropdowns when user actually saves something
  if (!cfg.dropdowns) cfg.dropdowns = {};
  const meta  = DD_META.find(m => m.key === ddActiveKey);
  const items = [...meta.getter()];
  if (items.includes(val)) { toast('⚠ Already exists'); return; }
  items.push(val);
  cfg.dropdowns[ddActiveKey] = items;
  saveCfg();
  rebuildSelects();
  inp.value = '';
  renderDropdownEditor();
  setTimeout(() => {
    const list = document.getElementById('dd-list');
    if (list) list.scrollTop = list.scrollHeight;
  }, 50);
  toast(`✓ Added "${val}"`);
}

function resetDdList(key) {
  if (!cfg.dropdowns) cfg.dropdowns = {};
  const meta = DD_META.find(m => m.key === key);
  cfg.dropdowns[key] = [...meta.defaults];
  saveCfg();
  rebuildSelects();
  renderDropdownEditor();
  toast('✓ Reset to defaults');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ═══════════════════════════════════════════════
   EXPORT / IMPORT
═══════════════════════════════════════════════ */
function exportJSON() {
  const blob=new Blob([JSON.stringify({trades,cfg},null,2)],{type:'application/json'});
  const a=Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(blob),
    download:'tradelog_'+new Date().toISOString().split('T')[0]+'.json'
  });
  a.click(); URL.revokeObjectURL(a.href);
  toast('Exported '+trades.length+' trades');
}

function fullBackup() {
  const backup = {
    version:   3,
    exportedAt: new Date().toISOString(),
    trades,
    cfg: {
      portVal:   cfg.portVal,
      features:  cfg.features,
      dropdowns: cfg.dropdowns,
      // deliberately exclude sbUrl/sbKey for security
    },
    meta: {
      tradeCount:  trades.length,
      openTrades:  trades.filter(t=>t.status==='Open').length,
      closedTrades:trades.filter(t=>t.status==='Closed').length,
    }
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const dt   = new Date().toISOString().replace('T','_').slice(0,16).replace(':','-');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `tradelog_FULL_BACKUP_${dt}.json`
  });
  a.click(); URL.revokeObjectURL(a.href);
  toast(`✓ Full backup downloaded — ${trades.length} trades + all settings`);
}
function importJSON(inp) {
  const file=inp.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=e=>{
    try {
      const d=JSON.parse(e.target.result);
      if(Array.isArray(d.trades)){
        trades=d.trades;
        if(d.cfg) cfg={...cfg,...d.cfg};
        saveTrades(); localStorage.setItem(LS_C,JSON.stringify(cfg));
        renderAll(); toast('✓ Imported '+trades.length+' trades');
      } else { toast('✗ Invalid JSON structure'); }
    } catch(err){ toast('✗ Invalid file'); }
  };
  r.readAsText(file); inp.value='';
}

/* ═══════════════════════════════════════════════
   BACKUP STATUS & RECOVERY UI
═══════════════════════════════════════════════ */
function updateBackupStatus() {
  const el = document.getElementById('backup-status');
  if (!el) return;

  const keys = [
    { k: LS_T,      label: 'Primary'  },
    { k: LS_T_BAK,  label: 'Backup'   },
    { k: LS_T_PREV, label: 'Previous' },
  ];

  let html = '';
  keys.forEach(({ k, label }) => {
    const raw = localStorage.getItem(k);
    let count = 0, valid = false;
    try { const p = JSON.parse(raw||'null'); if (Array.isArray(p)) { count = p.length; valid = true; } } catch(e) {}
    const col   = valid ? 'var(--profit)' : 'var(--text3)';
    const state = valid ? `${count} trade${count===1?'':'s'}` : 'empty';
    html += `<span style="color:${col};font-weight:600">${label}:</span> ${state} &nbsp;&nbsp;`;
  });

  const lastSave = localStorage.getItem('tl_last_save');
  if (lastSave) {
    const d = new Date(lastSave);
    html += `<br>Last saved: ${d.toLocaleString('en-IN')}`;
  }
  el.innerHTML = html;
}

function showRecoveryOptions() {
  const body = document.getElementById('recovery-body');
  if (!body) return;

  const keys = [
    { k: LS_T,      label: 'Primary store',          icon: '💾' },
    { k: LS_T_BAK,  label: 'Mirror backup',           icon: '🔒' },
    { k: LS_T_PREV, label: 'Previous save (1 ago)',   icon: '⏪' },
  ];

  let html = `<div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.6">
    TradeLog keeps 3 copies of your trades at all times. If one is damaged or empty, restore from another.
  </div>`;

  keys.forEach(({ k, label, icon }) => {
    const raw = localStorage.getItem(k);
    let count = 0, valid = false, preview = '';
    try {
      const p = JSON.parse(raw || 'null');
      if (Array.isArray(p)) {
        valid = true; count = p.length;
        if (p.length > 0) {
          preview = p.slice(0,3).map(t => t.stock).join(', ') + (p.length > 3 ? `… +${p.length-3}` : '');
        }
      }
    } catch(e) {}

    const statusCol = valid && count > 0 ? 'var(--profit)' : 'var(--text3)';
    html += `<div class="recovery-row">
      <div class="recovery-info">
        <div class="recovery-label">${icon} ${label}</div>
        <div class="recovery-count" style="color:${statusCol}">
          ${valid ? `${count} trade${count===1?'':'s'}` : 'empty / corrupt'}
        </div>
        ${preview ? `<div class="recovery-preview">${preview}</div>` : ''}
      </div>
      <button class="btn btn-primary" style="font-size:12px;padding:9px 13px;flex:0;white-space:nowrap"
        ${(!valid || count===0) ? 'disabled style="opacity:.4;font-size:12px;padding:9px 13px;flex:0"' : ''}
        onclick="restoreFrom('${k}')">
        Restore
      </button>
    </div>`;
  });

  body.innerHTML = html;
  document.getElementById('mo-recovery').classList.add('open');
}

function closeRecovery() {
  document.getElementById('mo-recovery').classList.remove('open');
}

function restoreFrom(key) {
  const raw = localStorage.getItem(key);
  if (!raw) { toast('⚠ No data in that backup'); return; }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not array');
    // Write to primary
    localStorage.setItem(LS_T, raw);
    localStorage.setItem(LS_T_BAK, raw);
    trades = parsed;
    renderAll();
    closeRecovery();
    toast(`✓ Restored ${parsed.length} trades`);
  } catch(e) {
    toast('✗ Backup data is corrupt');
  }
}

/* ═══════════════════════════════════════════════
   BULK CSV IMPORT / EXPORT
═══════════════════════════════════════════════ */

// Column spec: { key, header, required, hint }
const CSV_COLS = [
  { key:'stock',    header:'Stock',         required:true,  hint:'e.g. RELIANCE'       },
  { key:'status',   header:'Status',        required:true,  hint:'Open or Closed'      },
  { key:'type',     header:'Type',          required:false, hint:'Real or Virtual'      },
  { key:'buyDate',  header:'Buy Date',      required:true,  hint:'DD/MM/YYYY'          },
  { key:'buyPx',   header:'Buy Price',      required:true,  hint:'e.g. 2450.50'        },
  { key:'qty',      header:'Qty',           required:true,  hint:'No. of shares'       },
  { key:'sl',       header:'SL Price',      required:false, hint:'Stop loss price'     },
  { key:'portVal',  header:'Portfolio',     required:false, hint:'Total portfolio ₹'   },
  { key:'sellDate', header:'Sell Date',     required:false, hint:'DD/MM/YYYY if closed'},
  { key:'sellPx',  header:'Sell Price',     required:false, hint:'If closed'           },
  { key:'emPrev',   header:'EM Prev Day',   required:false, hint:'EM value prev day'   },
  { key:'emDay',    header:'EM Entry Day',  required:false, hint:'EM value entry day'  },
  { key:'setup',    header:'Setup',         required:false, hint:'Chart pattern'       },
  { key:'exitR',    header:'Exit Reason',   required:false, hint:'Why you exited'      },
  { key:'mktState', header:'Market State',  required:false, hint:'Market condition'    },
  { key:'notes',    header:'Notes',         required:false, hint:'Observations'        },
];

// Pending parsed rows waiting for user to confirm

/* ── Download blank template ── */
function downloadCSVTemplate() {
  const headers = CSV_COLS.map(c => c.header);
  const hints   = CSV_COLS.map(c => c.required ? `(required) ${c.hint}` : c.hint);
  // Row 1 = headers, Row 2 = hint/example row (prefixed so it's clearly a guide)
  const hintRow = CSV_COLS.map(c => c.hint);

  // Sample row
  const sample = {
    Stock:'RELIANCE', Status:'Closed', Type:'Real',
    'Buy Date':'15/01/2025', 'Buy Price':'2450.50', Qty:'10',
    'SL Price':'2380', Portfolio:'500000',
    'Sell Date':'28/01/2025', 'Sell Price':'2610',
    'EM Prev Day':'2420', 'EM Entry Day':'2435',
    Setup:'VCP – Volatility Contraction', 'Exit Reason':'Target Hit',
    'Market State':'Confirmed Uptrend – Strong', Notes:'Clean breakout on volume'
  };
  const sampleRow = headers.map(h => sample[h] ?? '');

  const rows = [
    headers,
    hintRow,
    sampleRow,
    // Two blank rows for user to fill
    headers.map(() => ''),
    headers.map(() => ''),
  ];

  const csv = rows.map(r =>
    r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')
  ).join('\r\n');

  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'tradelog_template.csv'
  });
  a.click(); URL.revokeObjectURL(a.href);
  toast('Template downloaded — fill row 3 onwards');
}

/* ── Handle uploaded file ── */
function handleCSVUpload(inp) {
  const file = inp.files[0]; if (!file) return;
  const name = file.name.toLowerCase();
  inp.value = '';

  if (name.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = e => parseCSVText(e.target.result);
    reader.readAsText(file, 'UTF-8');
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    toast('⚠ For Excel files: File → Download → CSV, then upload the CSV');
  } else {
    toast('⚠ Please upload a .csv file');
  }
}

/* ── Parse CSV text ── */
function parseCSVText(text) {
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { toast('⚠ CSV has no data rows'); return; }

  // Parse all rows
  const rows = lines.map(parseCSVLine);
  const headerRow = rows[0].map(h => h.trim());

  // Map header names to CSV_COLS keys (case-insensitive)
  const colMap = {}; // index → key
  headerRow.forEach((h, i) => {
    const col = CSV_COLS.find(c =>
      c.header.toLowerCase() === h.toLowerCase()
    );
    if (col) colMap[i] = col.key;
  });

  // Check required headers present
  const missingReq = CSV_COLS
    .filter(c => c.required)
    .filter(c => !Object.values(colMap).includes(c.key));
  if (missingReq.length) {
    toast(`⚠ Missing columns: ${missingReq.map(c=>c.header).join(', ')}`);
    return;
  }

  // Parse data rows — skip row index 1 if it looks like the hints row
  const dataRows = [];
  const errors   = [];

  rows.forEach((row, rowIdx) => {
    if (rowIdx === 0) return; // skip header

    const obj = {};
    Object.entries(colMap).forEach(([i, key]) => {
      obj[key] = (row[i] ?? '').trim();
    });

    // Skip completely empty rows
    if (!obj.stock && !obj.buyPx && !obj.buyDate) return;

    // Skip hint row (row 2 in template)
    if (
      obj.stock?.toLowerCase().includes('e.g.') ||
      obj.status?.toLowerCase() === 'open or closed' ||
      obj.buyDate?.toLowerCase().includes('dd/mm')
    ) return;

    // Validate & coerce
    const errs = [];
    if (!obj.stock)                      errs.push('Stock missing');
    if (!['Open','Closed'].includes(normalizeStatus(obj.status))) errs.push('Status must be Open or Closed');
    if (!parseDateField(obj.buyDate))    errs.push('Buy Date invalid (use DD/MM/YYYY)');
    if (isNaN(parseFloat(obj.buyPx)))    errs.push('Buy Price invalid');
    if (isNaN(parseFloat(obj.qty)))      errs.push('Qty invalid');

    if (errs.length) {
      errors.push({ row: rowIdx + 1, errs });
      return;
    }

    const t = {
      id:       uid(),
      stock:    obj.stock.toUpperCase(),
      status:   normalizeStatus(obj.status),
      type:     normalizeType(obj.type),
      buyDate:  parseDateField(obj.buyDate),
      buyPx:    parseFloat(obj.buyPx),
      qty:      parseFloat(obj.qty),
      sl:       parseFloat(obj.sl) || null,
      portVal:  parseFloat(obj.portVal) || cfg.portVal || 0,
      sellDate: parseDateField(obj.sellDate),
      sellPx:   parseFloat(obj.sellPx)  || null,
      emPrev:   parseFloat(obj.emPrev)  || null,
      emDay:    parseFloat(obj.emDay)   || null,
      setup:    obj.setup    || '',
      exitR:    obj.exitR    || '',
      mktState: obj.mktState || '',
      notes:    obj.notes    || '',
      ts:       Date.now(),
      upd:      Date.now(),
    };
    // Derived alloc
    t.alloc = t.buyPx * t.qty;
    dataRows.push(t);
  });

  if (!dataRows.length && !errors.length) {
    toast('⚠ No valid data rows found in file');
    return;
  }

  csvPendingRows = dataRows;
  showCSVPreview(dataRows, errors);
}

/* ── Parse a single CSV line respecting quoted fields ── */
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/* ── Date helpers ── */
function parseDateField(s) {
  if (!s) return null;
  // DD/MM/YYYY
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
  // YYYY-MM-DD (already correct)
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return s;
  // MM/DD/YYYY
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m3) return `${m3[3]}-${m3[1].padStart(2,'0')}-${m3[2].padStart(2,'0')}`;
  return null;
}

function normalizeStatus(s) {
  if (!s) return 'Open';
  const l = s.toLowerCase();
  if (l.includes('close') || l === 'c') return 'Closed';
  return 'Open';
}
function normalizeType(s) {
  if (!s) return 'Real';
  const l = s.toLowerCase();
  if (l.includes('virt') || l.includes('paper') || l === 'v') return 'Virtual';
  return 'Real';
}

/* ── Show preview modal ── */
function showCSVPreview(rows, errors) {
  const body = document.getElementById('csv-preview-body');
  const btn  = document.getElementById('csv-confirm-btn');
  if (!body) return;

  let html = '';

  // Summary banner
  html += `<div class="csv-summary">
    <div class="csv-sum-item csv-sum-ok">
      <div class="csv-sum-num">${rows.length}</div>
      <div class="csv-sum-lbl">Ready to import</div>
    </div>
    <div class="csv-sum-item csv-sum-err">
      <div class="csv-sum-num">${errors.length}</div>
      <div class="csv-sum-lbl">Rows with errors</div>
    </div>
  </div>`;

  // Errors section
  if (errors.length) {
    html += `<div class="csv-err-box">
      <div class="csv-err-hd">⚠ Skipped rows (fix in your file and re-upload)</div>`;
    errors.forEach(e => {
      html += `<div class="csv-err-row">Row ${e.row}: ${e.errs.join(' · ')}</div>`;
    });
    html += `</div>`;
  }

  // Preview table
  if (rows.length) {
    html += `<div style="font-family:var(--ff-d);font-size:9px;letter-spacing:2px;color:var(--text3);text-transform:uppercase;margin:14px 0 8px">Preview (${rows.length} trades)</div>`;
    html += `<div class="csv-preview-tbl-wrap"><table class="csv-preview-tbl">
      <thead><tr>
        <th>Stock</th><th>Status</th><th>Type</th>
        <th>Buy Date</th><th>Buy ₹</th><th>Qty</th>
        <th>Sell Date</th><th>Sell ₹</th><th>SL ₹</th><th>Setup</th>
      </tr></thead><tbody>`;
    rows.forEach(t => {
      const c = fullCalcs(t);
      html += `<tr>
        <td style="font-family:var(--ff-d);font-weight:700">${escHtml(t.stock)}</td>
        <td><span class="badge b-${t.status.toLowerCase()}">${t.status}</span></td>
        <td><span class="badge b-${t.type.toLowerCase()}">${t.type==='Virtual'?'VIRT':'REAL'}</span></td>
        <td>${fDate(t.buyDate)}</td>
        <td>₹${t.buyPx}</td>
        <td>${t.qty}</td>
        <td>${fDate(t.sellDate)}</td>
        <td>${t.sellPx ? '₹'+t.sellPx : '—'}</td>
        <td class="${pCls(t.sl?-1:null)}">${t.sl ? '₹'+t.sl : '—'}</td>
        <td style="font-size:11px;color:var(--text2)">${escHtml(t.setup||'—')}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  body.innerHTML = html;
  if (btn) btn.textContent = `Import ${rows.length} Trade${rows.length===1?'':'s'}`;
  document.getElementById('mo-csv').classList.add('open');
  // Close settings modal so preview is fully visible
  document.getElementById('mo-settings').classList.remove('open');
}

function closeCSVMo() {
  document.getElementById('mo-csv').classList.remove('open');
  csvPendingRows = [];
  // Re-open settings
  document.getElementById('mo-settings').classList.add('open');
}

function confirmCSVImport() {
  if (!csvPendingRows.length) { closeCSVMo(); return; }
  // Merge: skip duplicates based on stock+buyDate+buyPx
  let added = 0, skipped = 0;
  csvPendingRows.forEach(t => {
    const dupe = trades.find(x =>
      x.stock === t.stock &&
      x.buyDate === t.buyDate &&
      x.buyPx === t.buyPx
    );
    if (dupe) { skipped++; return; }
    trades.unshift(t);
    added++;
  });
  saveTrades();
  csvPendingRows = [];
  document.getElementById('mo-csv').classList.remove('open');
  document.getElementById('mo-settings').classList.remove('open');
  renderAll();
  let msg = `✓ Imported ${added} trade${added===1?'':'s'}`;
  if (skipped) msg += ` · ${skipped} skipped (duplicate)`;
  toast(msg);
}

/* ═══════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════ */
let toastTimer=null;
function toast(msg) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2800);
}

/* ═══════════════════════════════════════════════
   RENDER — ALL
═══════════════════════════════════════════════ */
function renderAll() {
  renderDash();
  if (curView==='table')     renderTable();
  if (curView==='analytics') renderAnalytics();
}

/* ═══════════════════════════════════════════════
   RENDER — DASHBOARD
═══════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════
   DASHBOARD OPEN POSITIONS TABLE (sortable)
═══════════════════════════════════════════════ */
function dashSortByCol(col) {
  if (dashSortCol === col) {
    if (dashSortDir === 'asc') { dashSortDir = 'desc'; }
    else { dashSortCol = null; dashSortDir = 'asc'; }
  } else { dashSortCol = col; dashSortDir = 'asc'; }
  const open = trades.filter(t => t.status === 'Open');
  document.getElementById('dash-open').innerHTML =
    `<div class="section-hd" style="margin-top:4px">OPEN POSITIONS (${open.length})</div>` +
    renderDashOpenTable(open);
}

function renderDashOpenTable(open) {
  const pv = cfg.portVal || 0;
  const cols = [
    { lbl:'Stock',    sort: t => t.stock || '' },
    { lbl:'Buy',      sort: t => t.buyPx || 0 },
    { lbl:'CMP',      sort: t => { const lp=livePrices[t.stock]; return lp&&!lp.error?+lp.price:0; } },
    { lbl:'SL',       sort: t => t.sl || 0 },
    { lbl:'SL%',      sort: t => { const c=fullCalcs(t); return c.sl??0; } },
    { lbl:'Qty',      sort: t => { const c=fullCalcs(t); return c.q??0; } },
    { lbl:'Invested', sort: t => { const c=fullCalcs(t); return c.al??0; } },
    { lbl:'Unreal ₹', sort: t => {
        const lp=livePrices[t.stock]; const c=fullCalcs(t);
        const cmp=lp&&!lp.error?+lp.price:null; const qty=c.q||t.qty||null;
        return (cmp&&qty&&t.buyPx)?(cmp-t.buyPx)*qty:-Infinity;
    }},
    { lbl:'Unreal%',  sort: t => {
        const lp=livePrices[t.stock]; const cmp=lp&&!lp.error?+lp.price:null;
        return (cmp&&t.buyPx)?(cmp-t.buyPx)/t.buyPx*100:-Infinity;
    }},
    { lbl:'Days',     sort: t => { const c=fullCalcs(t); return c.days??-1; } },
    { lbl:'Setup',    sort: t => t.setup||'' },
    { lbl:'TV',       sort: null },
  ];

  // Sort
  let list = [...open];
  if (dashSortCol) {
    const colDef = cols.find(c => c.lbl === dashSortCol);
    if (colDef && colDef.sort) {
      list.sort((a,b) => {
        const va = colDef.sort(a), vb = colDef.sort(b);
        const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
        return dashSortDir === 'asc' ? cmp : -cmp;
      });
    }
  }

  const thArr = cols.map(col => {
    if (!col.sort) return `<th style="text-align:center">TV</th>`;
    const isSorted = dashSortCol === col.lbl;
    const arrow = isSorted ? (dashSortDir==='asc'?' ▲':' ▼') : '';
    const hl = isSorted ? 'color:var(--accent);' : '';
    return `<th style="${hl}cursor:pointer;user-select:none" onclick="dashSortByCol('${col.lbl}')" title="Sort by ${col.lbl}">${col.lbl}${arrow}</th>`;
  }).join('');

  const rows = list.map(t => {
    const c = fullCalcs(t);
    const qty = c.q || t.qty || null;
    const lp = livePrices[t.stock];
    const cmp = lp && !lp.error ? +lp.price : null;
    const unrV = (cmp && qty && t.buyPx) ? (cmp - t.buyPx) * qty : null;
    const unrP = (cmp && t.buyPx) ? (cmp - t.buyPx) / t.buyPx * 100 : null;
    const invested = (t.buyPx && qty) ? t.buyPx * qty : (c.al || null);
    const safeStock = escHtml(t.stock);
    // Risk alert: individual stock SL risk > 10% of portfolio
    const slRisk = (t.sl && t.buyPx && qty) ? Math.max(0,(t.buyPx-t.sl)*qty) : null;
    const slRiskPct = slRisk !== null && pv > 0 ? slRisk/pv*100 : null;
    const riskAlert = slRiskPct !== null && slRiskPct > 10;
    return `<tr onclick="openDetailMo('${t.id}')" style="cursor:pointer${riskAlert?' background:rgba(255,69,96,.07)':''}">
      <td style="text-align:left;font-family:var(--ff-d);font-weight:700;font-size:13px">
        ${riskAlert?'<span title="Risk >10% of portfolio" style="color:var(--loss);margin-right:3px">⚠</span>':''}${safeStock}
      </td>
      <td>₹${t.buyPx||'—'}</td>
      <td class="${cmp&&t.buyPx?(cmp>=t.buyPx?'val-p':'val-l'):''}">
        ${cmp?'₹'+f2(cmp)+(lp.chg!==undefined?` <span style="font-size:9px">${lp.chg>=0?'+':''}${lp.chg}%</span>`:''):'—'}
      </td>
      <td>${t.sl?'₹'+t.sl:'—'}</td>
      <td class="val-l">${c.sl!==null?f2(c.sl)+'%':'—'}</td>
      <td>${qty??'—'}</td>
      <td>${invested?fINR(invested,true):'—'}</td>
      <td class="${pCls(unrV)}">${unrV!==null?fINR(unrV,true):'—'}</td>
      <td class="${pCls(unrP)}">${unrP!==null?sgn(unrP)+f2(unrP)+'%':'—'}</td>
      <td>${c.days!==null?c.days+'d':'—'}</td>
      <td style="font-size:11px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.setup||'—')}</td>
      <td style="text-align:center"><a href="${tvURL(t.stock)}" target="_blank" rel="noopener" class="tv-tbl-link" onclick="event.stopPropagation()" title="Open on TradingView" style="font-size:11px;padding:2px 5px">TV↗</a></td>
    </tr>`;
  }).join('');

  return `<div class="rp-tbl-wrap"><table class="rp-tbl dash-open-tbl">
    <thead><tr>${thArr}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderDash() {
  const closed = trades.filter(t=>t.status==='Closed');
  const open   = trades.filter(t=>t.status==='Open');

  document.getElementById('pb-value').textContent  = fBig(cfg.portVal);
  document.getElementById('pb-total').textContent  = trades.length;
  document.getElementById('pb-open').textContent   = open.length;
  document.getElementById('pb-closed').textContent = closed.length;

  let totalPnL=0;
  closed.forEach(t=>{const c=fullCalcs(t); if(c.pnlV!==null) totalPnL+=c.pnlV;});
  const totPct = cfg.portVal>0 ? totalPnL/cfg.portVal*100 : null;
  const wins   = closed.filter(t=>{const c=fullCalcs(t); return c.pnlV!==null&&c.pnlV>0;});
  document.getElementById('pb-wins').textContent=wins.length;

  const pnlEl=document.getElementById('pb-pnl');
  pnlEl.textContent = closed.length ? fINR(totalPnL,true) : '—';
  pnlEl.className   = 'pb-pnl '+pCls(totalPnL);

  const pctEl=document.getElementById('pb-pct');
  pctEl.textContent = totPct!==null ? sgn(totPct)+f2(totPct)+'% realized P&L' : 'No closed trades yet';
  pctEl.className   = 'pb-pct '+pCls(totPct);

  const wr=closed.length ? wins.length/closed.length*100 : null;
  document.getElementById('s-winrate').textContent = wr!==null ? Math.round(wr)+'%' : '—';

  const rrs=closed.map(t=>fullCalcs(t).rr).filter(x=>x!==null);
  const avgRR=rrs.length ? rrs.reduce((a,b)=>a+b,0)/rrs.length : null;
  document.getElementById('s-rr').textContent = avgRR!==null ? f2(avgRR)+'x' : '—';

  const dys=closed.map(t=>fullCalcs(t).days).filter(x=>x!==null&&x>=0);
  const avgD=dys.length ? Math.round(dys.reduce((a,b)=>a+b,0)/dys.length) : null;
  document.getElementById('s-days').textContent = avgD!==null ? avgD+'d' : '—';

  // Streak
  const streakEl=document.getElementById('s-streak'), streakSubEl=document.getElementById('s-streak-sub');
  if(streakEl){
    const sorted=[...closed].filter(t=>fullCalcs(t).pnlV!==null)
      .sort((a,b)=>new Date(b.sellDate||b.upd)-new Date(a.sellDate||a.upd));
    let streak=0,streakType=null;
    for(const t of sorted){
      const win=fullCalcs(t).pnlV>=0;
      if(streakType===null){streakType=win;streak=1;}
      else if(win===streakType)streak++;
      else break;
    }
    if(streak>0&&streakType!==null){
      streakEl.textContent=streak; streakEl.className='s-val '+(streakType?'val-p':'val-l');
      if(streakSubEl)streakSubEl.textContent=streakType?'🔥 Win streak':'❄️ Loss streak';
    } else {
      streakEl.textContent='—'; streakEl.className='s-val val-n';
      if(streakSubEl)streakSubEl.textContent='';
    }
  }

  // Expectancy
  const expectEl=document.getElementById('s-expect');
  if(expectEl&&closed.length){
    const winPnls=closed.map(t=>fullCalcs(t).pnlP).filter(x=>x!==null&&x>0);
    const lossPnls=closed.map(t=>fullCalcs(t).pnlP).filter(x=>x!==null&&x<0);
    const winR=wins.length/closed.length, lossR=1-winR;
    const avgWin=winPnls.length?winPnls.reduce((a,b)=>a+b,0)/winPnls.length:0;
    const avgLoss=lossPnls.length?Math.abs(lossPnls.reduce((a,b)=>a+b,0)/lossPnls.length):0;
    const exp=(winR*avgWin)-(lossR*avgLoss);
    expectEl.textContent=(exp>=0?'+':'')+f2(exp)+'%';
    expectEl.className='s-val '+pCls(exp);
  } else if(expectEl){expectEl.textContent='—';expectEl.className='s-val val-n';}

  // Best / Worst
  const ranked=closed.map(t=>({t,c:fullCalcs(t)})).filter(x=>x.c.pnlP!==null)
    .sort((a,b)=>b.c.pnlP-a.c.pnlP);
  if(ranked.length){
    const b=ranked[0],w=ranked[ranked.length-1];
    document.getElementById('bw-best-stock').textContent=b.t.stock;
    document.getElementById('bw-best-pct').textContent='+'+f2(b.c.pnlP)+'%';
    document.getElementById('bw-worst-stock').textContent=w.t.stock;
    document.getElementById('bw-worst-pct').textContent=f2(w.c.pnlP)+'%';
  } else {
    ['bw-best-stock','bw-best-pct','bw-worst-stock','bw-worst-pct'].forEach(id=>{document.getElementById(id).textContent='—';});
  }

  renderMonthlyChart(closed);

  // ── Portfolio Invested % + Open Risk ──
  renderRiskPanel(open);

  const oDiv=document.getElementById('dash-open');
  if(open.length){ oDiv.innerHTML=`<div class="section-hd" style="margin-top:4px">OPEN POSITIONS (${open.length})</div>${renderDashOpenTable(open)}`; }
  else{ oDiv.innerHTML=''; }

  const rDiv=document.getElementById('dash-recent');
  if(!open.length && !closed.length){
    rDiv.innerHTML=`<div class="empty"><div class="empty-ico">📊</div><div class="empty-title">No trades yet</div><div class="empty-sub">Tap the + button to log your first trade</div></div>`;
  } else { rDiv.innerHTML=''; }
}

/* ═══════════════════════════════════════════════
   TRADE CARD HTML
═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   PORTFOLIO INVESTED % + OPEN RISK PANEL
═══════════════════════════════════════════════ */
function renderRiskPanel(open) {
  const el = document.getElementById('risk-panel');
  if (!el) return;
  const pv = cfg.portVal || 0;

  if (!pv) {
    el.innerHTML = `<div class="rp-note">Set your portfolio value in ⚙ Config to see risk metrics</div>`;
    return;
  }
  if (!open.length) {
    el.innerHTML = `<div class="rp-note">No open trades</div>`;
    return;
  }

  // ── Per-trade calculations ──
  const rows = open.map(t => {
    const c   = fullCalcs(t);
    const qty = c.q || (t.qty ? +t.qty : null);

    // Invested = buyPx × qty
    const invested = (t.buyPx && qty) ? t.buyPx * qty : (c.al || null);

    // Max loss if SL hit = (buyPx - SL) × qty
    let slRisk = null;
    let slRiskPct = null;
    if (t.sl && t.buyPx && qty) {
      slRisk = (t.buyPx - t.sl) * qty;
      if (slRisk < 0) slRisk = 0;   // SL above buy price = no downside risk
      slRiskPct = pv > 0 ? slRisk / pv * 100 : null;
    }

    const investedPct = (invested && pv > 0) ? invested / pv * 100 : null;
    const lp = livePrices[t.stock];
    const cmp = lp && !lp.error ? +lp.price : null;
    const unreal = (cmp && qty && t.buyPx) ? (cmp - t.buyPx) * qty : null;
    const unrealPct = (unreal !== null && invested) ? unreal / invested * 100 : null;

    return { t, c, qty, invested, investedPct, slRisk, slRiskPct, cmp, unreal, unrealPct };
  }).sort((a, b) => (b.slRiskPct||0) - (a.slRiskPct||0));

  // ── Totals ──
  const totalInvested  = rows.reduce((s,r) => s + (r.invested||0), 0);
  const totalSLRisk    = rows.reduce((s,r) => s + (r.slRisk||0), 0);
  const totalInvPct    = pv > 0 ? totalInvested / pv * 100 : null;
  const totalSLRiskPct = pv > 0 ? totalSLRisk   / pv * 100 : null;
  const cashFree       = Math.max(0, pv - totalInvested);
  const cashFreePct    = pv > 0 ? cashFree / pv * 100 : null;
  const hasSL          = rows.some(r => r.slRisk !== null);

  // ── Risk colour ──
  const rCol = pct => pct===null ? '' : pct>5 ? 'val-l' : pct>2 ? '' : 'val-p';
  const iCol = pct => pct===null ? '' : pct>85 ? 'val-l' : pct>65 ? '' : 'val-p';

  // ── Summary strip ──
  let html = `<div class="rp-strip">
    <div class="rp-strip-item">
      <div class="rp-strip-lbl">Invested</div>
      <div class="rp-strip-val ${iCol(totalInvPct)}">${totalInvPct!==null?f2(totalInvPct)+'%':'—'}</div>
      <div class="rp-strip-sub">${fINR(totalInvested,true)}</div>
    </div>
    <div class="rp-strip-div"></div>
    <div class="rp-strip-item">
      <div class="rp-strip-lbl">Max Loss if All SL Hit</div>
      <div class="rp-strip-val ${rCol(totalSLRiskPct)}">${totalSLRiskPct!==null?f2(totalSLRiskPct)+'%':'—'}</div>
      <div class="rp-strip-sub">${fINR(totalSLRisk,true)}</div>
    </div>
    <div class="rp-strip-div"></div>
    <div class="rp-strip-item">
      <div class="rp-strip-lbl">Cash Free</div>
      <div class="rp-strip-val">${cashFreePct!==null?f2(cashFreePct)+'%':'—'}</div>
      <div class="rp-strip-sub">${fINR(cashFree,true)}</div>
    </div>
  </div>`;

  // ── Per-trade table ──
  const hasCMP = rows.some(r => r.cmp !== null);
  html += `<div class="rp-tbl-wrap"><table class="rp-tbl">
    <thead><tr>
      <th style="text-align:left">Stock</th>
      <th>Qty</th>
      <th>Buy ₹</th>
      <th>SL ₹</th>
      <th>SL %</th>
      <th>Invested ₹</th>
      <th>Invested%</th>
      <th>Risk ₹</th>
      <th>Risk %</th>
      ${hasCMP?'<th>CMP ₹</th><th>Unreal ₹</th><th>Unreal %</th>':''}
    </tr></thead>
    <tbody>`;

  rows.forEach(r => {
    const noSL = r.slRisk === null;
    html += `<tr onclick="openDetailMo('${r.t.id}')">
      <td style="text-align:left;font-family:var(--ff-d);font-weight:700;font-size:13px">${r.t.stock}</td>
      <td>${r.qty ?? '—'}</td>
      <td>${r.t.buyPx ? '₹'+r.t.buyPx : '—'}</td>
      <td>${r.t.sl   ? '₹'+r.t.sl    : '—'}</td>
      <td class="val-l">${r.c.sl!==null ? f2(r.c.sl)+'%' : '—'}</td>
      <td>${r.invested ? fINR(r.invested,true) : '—'}</td>
      <td class="${iCol(r.investedPct)}">${r.investedPct!==null ? f2(r.investedPct)+'%' : '—'}</td>
      <td class="val-l">${r.slRisk!==null ? fINR(r.slRisk,true) : noSL?'<span style="font-size:10px;color:var(--warn)">No SL</span>':'—'}</td>
      <td class="${rCol(r.slRiskPct)}">${r.slRiskPct!==null ? f2(r.slRiskPct)+'%' : noSL?'<span style="font-size:10px;color:var(--warn)">Set SL</span>':'—'}</td>
      ${hasCMP?`
      <td>${r.cmp!==null?'₹'+r.cmp:'—'}</td>
      <td class="${pCls(r.unreal)}">${r.unreal!==null?fINR(r.unreal,true):'—'}</td>
      <td class="${pCls(r.unrealPct)}">${r.unrealPct!==null?(sgn(r.unrealPct)+f2(r.unrealPct)+'%'):'—'}</td>`:''}
    </tr>`;
  });

  // Totals row
  html += `<tr class="rp-tbl-total">
    <td style="text-align:left;font-family:var(--ff-d);font-weight:700">TOTAL</td>
    <td>—</td><td>—</td><td>—</td><td>—</td>
    <td>${fINR(totalInvested,true)}</td>
    <td class="${iCol(totalInvPct)}">${totalInvPct!==null?f2(totalInvPct)+'%':'—'}</td>
    <td class="val-l">${fINR(totalSLRisk,true)}</td>
    <td class="${rCol(totalSLRiskPct)} rp-tbl-total-risk">${totalSLRiskPct!==null?f2(totalSLRiskPct)+'%':'—'}</td>
    ${hasCMP?'<td>—</td><td>—</td><td>—</td>':''}
  </tr>`;

  html += `</tbody></table></div>`;

  if (!hasSL) {
    html += `<div class="rp-note" style="margin-top:8px">⚠ No stop losses set — add SL to each open trade to see accurate risk</div>`;
  }

  // Feature 4: Open risk >10% portfolio alert
  if (totalSLRiskPct !== null && totalSLRiskPct > 10) {
    html += `<div class="risk-alert-banner">
      ⚠️ <strong>Total open risk is ${f2(totalSLRiskPct)}% of portfolio</strong> — exceeds the 10% safety threshold.
      Consider sizing down open positions or tightening stop losses.
    </div>`;
  }
  // Individual position risk >10% alert
  rows.forEach(r => {
    if (r.slRiskPct !== null && r.slRiskPct > 10) {
      html += `<div class="risk-alert-banner risk-alert-sm">⚠️ <strong>${escHtml(r.t.stock)}</strong> alone carries ${f2(r.slRiskPct)}% portfolio risk — size down.</div>`;
    }
  });

  el.innerHTML = html;
}

/* monthly chart mode: 'inr' | 'pct' */
let monthlyChartMode = 'inr';
function toggleMonthlyMode() {
  monthlyChartMode = monthlyChartMode === 'inr' ? 'pct' : 'inr';
  const btn = document.getElementById('monthly-toggle');
  if(btn) btn.textContent = monthlyChartMode === 'inr' ? '₹' : '%';
  renderMonthlyChart(trades.filter(t=>t.status==='Closed'));
}

function renderMonthlyChart(closed) {
  const el = document.getElementById('monthly-chart');
  if (!el) return;
  const pv = cfg.portVal || 0;
  const byMonth = {};
  closed.forEach(t => {
    const d = t.sellDate||t.buyDate; if(!d) return;
    const key = d.slice(0,7);
    const c = fullCalcs(t); if(c.pnlV===null) return;
    if(!byMonth[key]) byMonth[key] = {pnl:0, portPnl:0};
    byMonth[key].pnl += c.pnlV;
    if(pv>0) byMonth[key].portPnl += c.pnlV/pv*100;
  });
  const keys = Object.keys(byMonth).sort();
  if(!keys.length){el.innerHTML='<div class="chart-empty">No closed trades to chart yet</div>';return;}
  const usePct = monthlyChartMode === 'pct';
  const vals  = keys.map(k => usePct ? byMonth[k].portPnl : byMonth[k].pnl);
  const maxV  = Math.max(...vals.map(Math.abs),1);
  const W=el.offsetWidth||340, H=130, pad=12;
  const slotW=(W-pad*2)/keys.length;
  const barW=Math.max(8,Math.min(36,slotW-6));
  const midY=H*0.52;
  const months=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let bars='',labels='';
  keys.forEach((k,i)=>{
    const v=vals[i];
    const x=pad+i*slotW+(slotW-barW)/2;
    const h=Math.max(3,Math.abs(v)/maxV*(midY-14));
    const y=v>=0?midY-h:midY;
    const col=v>=0?'var(--profit)':'var(--loss)';
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${col}" rx="2" opacity="0.85"/>`;
    const lbl = usePct ? (v>=0?'+':'')+v.toFixed(2)+'%' : fINR(v,true);
    if(h>20){const ly=v>=0?y-3:y+h+9;bars+=`<text x="${(x+barW/2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="8" fill="${col}" font-family="IBM Plex Mono,monospace">${lbl}</text>`;}
    labels+=`<text x="${(x+barW/2).toFixed(1)}" y="${H-2}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="Rajdhani,sans-serif">${months[+k.slice(5)]||k.slice(5)} ${k.slice(2,4)}</text>`;
  });
  el.innerHTML=`<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><line x1="${pad}" y1="${midY}" x2="${W-pad}" y2="${midY}" stroke="var(--border2)" stroke-width="1"/>${bars}${labels}</svg>`;
}


/* ═══════════════════════════════════════════════
   ANALYTICS VIEW
═══════════════════════════════════════════════ */
function renderAnalytics() {
  const closed = trades.filter(t=>t.status==='Closed');
  const pv = cfg.portVal || 0;

  /* ── helper: draw a simple SVG donut/pie ── */
  function drawPie(slices, size=120) {
    if(!slices.length) return '';
    const total = slices.reduce((s,sl)=>s+sl.val,0);
    if(total<=0) return '';
    const cx=size/2, cy=size/2, r=size/2-8, ri=r*0.52;
    let angle = -Math.PI/2;
    let paths = '';
    slices.forEach(sl => {
      const sweep = (sl.val/total)*Math.PI*2;
      const x1=cx+r*Math.cos(angle), y1=cy+r*Math.sin(angle);
      angle += sweep;
      const x2=cx+r*Math.cos(angle), y2=cy+r*Math.sin(angle);
      const ix1=cx+ri*Math.cos(angle-sweep), iy1=cy+ri*Math.sin(angle-sweep);
      const ix2=cx+ri*Math.cos(angle), iy2=cy+ri*Math.sin(angle);
      const big = sweep > Math.PI ? 1 : 0;
      paths += `<path d="M${cx},${cy} L${f2(x1)},${f2(y1)} A${r},${r} 0 ${big},1 ${f2(x2)},${f2(y2)} Z" fill="${sl.col}" opacity="0.9"/>`;
      paths += `<path d="M${f2(ix1)},${f2(iy1)} A${ri},${ri} 0 ${big},1 ${f2(ix2)},${f2(iy2)} L${f2(x2)},${f2(y2)} A${r},${r} 0 ${big},0 ${f2(x1)},${f2(y1)} Z" fill="var(--bg2)" opacity="1"/>`;
    });
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>`;
  }

  // ── Setup win rate ──
  const setupEl = document.getElementById('an-setup');
  if(setupEl){
    const map={};
    closed.forEach(t=>{
      const s=t.setup||'No Setup';
      if(!map[s])map[s]={wins:0,total:0,pnl:0};
      map[s].total++;
      const c=fullCalcs(t);
      if(c.pnlV!==null){map[s].pnl+=c.pnlV;if(c.pnlV>=0)map[s].wins++;}
    });
    const rows=Object.entries(map).sort((a,b)=>b[1].total-a[1].total);
    if(!rows.length){setupEl.innerHTML='<div class="an-empty">No closed trades yet</div>';}
    else{
      // Pie: slices = setups by trade count
      const pieSlices = rows.map(([s,d])=>{
        const wr=d.total?d.wins/d.total:0;
        const col=wr>=0.6?'var(--profit)':wr>=0.4?'var(--warn)':'var(--loss)';
        return {val:d.total,col,lbl:s};
      });
      const pieHTML = drawPie(pieSlices, 110);
      const legendHTML = rows.map(([s,d],i)=>{
        const wr=d.total?Math.round(d.wins/d.total*100):0;
        const col=wr>=60?'var(--profit)':wr>=40?'var(--warn)':'var(--loss)';
        return `<div class="an-row"><div class="an-row-top"><span class="an-label" title="${escHtml(s)}">${escHtml(s)}</span><span class="an-meta">${d.wins}W/${d.total-d.wins}L &nbsp;·&nbsp;<span class="${pCls(d.pnl)}">${fINR(d.pnl,true)}</span></span></div><div class="an-bar-bg"><div class="an-bar" style="width:${wr}%;background:${col}"></div><span class="an-bar-lbl">${wr}%</span></div></div>`;
      }).join('');
      setupEl.innerHTML=`<div class="an-pie-row"><div class="an-pie-wrap">${pieHTML}<div class="an-pie-center">${rows.length} setups</div></div><div class="an-legend">${legendHTML}</div></div>`;
    }
  }

  // ── Duration buckets ──
  const durEl = document.getElementById('an-duration');
  if(durEl){
    const buckets=[
      {label:'Intraday (0-1d)',min:0,max:1},
      {label:'Short (2-7d)',min:2,max:7},
      {label:'Medium (8-21d)',min:8,max:21},
      {label:'Long (22-60d)',min:22,max:60},
      {label:'Extended (60d+)',min:61,max:Infinity},
    ];
    buckets.forEach(b=>{b.trades=[];b.pnl=0;b.wins=0;});
    closed.forEach(t=>{
      const c=fullCalcs(t);
      const d=c.days; if(d===null)return;
      const bkt=buckets.find(b=>d>=b.min&&d<=b.max);
      if(!bkt)return;
      bkt.trades.push(t);
      if(c.pnlV!==null){bkt.pnl+=c.pnlV;if(c.pnlV>=0)bkt.wins++;}
    });
    const active=buckets.filter(b=>b.trades.length>0);
    if(!active.length){durEl.innerHTML='<div class="an-empty">No closed trades yet</div>';}
    else{
      const pieSlices=active.map(b=>{
        const wr=b.trades.length?b.wins/b.trades.length:0;
        const col=wr>=0.6?'var(--profit)':wr>=0.4?'var(--warn)':'var(--loss)';
        return {val:b.trades.length,col};
      });
      const pieHTML=drawPie(pieSlices,110);
      const legendHTML=active.map(b=>{
        const wr=b.trades.length?Math.round(b.wins/b.trades.length*100):0;
        const avgPnl=b.trades.length?b.pnl/b.trades.length:0;
        const col=wr>=60?'var(--profit)':wr>=40?'var(--warn)':'var(--loss)';
        return `<div class="an-row"><div class="an-row-top"><span class="an-label">${b.label}</span><span class="an-meta">${b.trades.length} trades &nbsp;·&nbsp; Avg <span class="${pCls(avgPnl)}">${fINR(avgPnl,true)}</span></span></div><div class="an-bar-bg"><div class="an-bar" style="width:${wr}%;background:${col}"></div><span class="an-bar-lbl">${wr}% win</span></div></div>`;
      }).join('');
      durEl.innerHTML=`<div class="an-pie-row"><div class="an-pie-wrap">${pieHTML}</div><div class="an-legend">${legendHTML}</div></div>`;
    }
  }

  // ── Grade breakdown ──
  const gradeEl=document.getElementById('an-grade');
  if(gradeEl){
    const gm={A:{count:0,wins:0,pnl:0},B:{count:0,wins:0,pnl:0},C:{count:0,wins:0,pnl:0},D:{count:0,wins:0,pnl:0},'?':{count:0,wins:0,pnl:0}};
    closed.forEach(t=>{
      const g=t.grade&&['A','B','C','D'].includes(t.grade)?t.grade:'?';
      const c=fullCalcs(t);
      gm[g].count++;
      if(c.pnlV!==null){gm[g].pnl+=c.pnlV;if(c.pnlV>=0)gm[g].wins++;}
    });
    const glabels={A:'Perfect',B:'Good',C:'Average',D:'Mistake','?':'Ungraded'};
    const gcols={A:'var(--profit)',B:'var(--accent)',C:'var(--warn)',D:'var(--loss)','?':'var(--text3)'};
    const active=Object.entries(gm).filter(([,d])=>d.count>0);
    if(!active.length){gradeEl.innerHTML='<div class="an-empty">Grade trades using A/B/C/D when logging</div>';}
    else{
      const pieSlices=active.map(([g,d])=>({val:d.count,col:gcols[g]}));
      const pieHTML=drawPie(pieSlices,110);
      const cardsHTML=`<div class="grade-grid">${active.map(([g,d])=>{
        const wr=d.count?Math.round(d.wins/d.count*100):0;
        const avgPnl=d.count?d.pnl/d.count:0;
        const gcls=g==='?'?'grade-none':'grade-'+g.toLowerCase();
        return `<div class="grade-card"><div class="grade-badge-big ${gcls}">${g}</div><div class="grade-card-label">${glabels[g]}</div><div class="grade-card-stat" style="color:var(--text)">${d.count} trades</div><div class="grade-card-stat" style="color:${wr>=60?'var(--profit)':wr>=40?'var(--warn)':'var(--loss)'};">${wr}% win</div><div class="grade-card-stat ${pCls(avgPnl)}">${fINR(avgPnl,true)} avg</div></div>`;
      }).join('')}</div>`;
      gradeEl.innerHTML=`<div class="an-pie-row" style="align-items:flex-start"><div class="an-pie-wrap">${pieHTML}</div><div style="flex:1;min-width:0">${cardsHTML}</div></div>`;
    }
  }

  // ── Feature 5: Best performing setup insight ──
  const insightEl=document.getElementById('an-insights');
  if(insightEl && closed.length >= 3){
    const insights = [];
    // Best setup
    const setupMap={};
    closed.forEach(t=>{
      const s=t.setup; if(!s||s==='No Setup') return;
      if(!setupMap[s])setupMap[s]={wins:0,total:0,pnl:0};
      setupMap[s].total++;
      const c=fullCalcs(t);
      if(c.pnlV!==null){setupMap[s].pnl+=c.pnlV;if(c.pnlV>=0)setupMap[s].wins++;}
    });
    const setups=Object.entries(setupMap).filter(([,d])=>d.total>=2);
    if(setups.length){
      const best=setups.sort((a,b)=>(b[1].wins/b[1].total)-(a[1].wins/a[1].total))[0];
      const wr=Math.round(best[1].wins/best[1].total*100);
      if(wr>=50) insights.push({icon:'🏆',type:'success',text:`<strong>${escHtml(best[0])}</strong> is your best setup — ${wr}% win rate over ${best[1].total} trades. <em>Double down on what works.</em>`});
    }
    // High SL loss rate
    const slHits=closed.filter(t=>t.exitR==='SL Hit');
    const slRate=closed.length?slHits.length/closed.length:0;
    if(slRate>0.6) insights.push({icon:'🛑',type:'warn',text:`${Math.round(slRate*100)}% of your trades exited at SL. Review entry timing — are you buying at the right stage of the pattern?`});
    // Avg hold duration
    const allDays=closed.map(t=>fullCalcs(t).days).filter(x=>x!==null&&x>0);
    const avgD=allDays.length?Math.round(allDays.reduce((a,b)=>a+b,0)/allDays.length):null;
    if(avgD!==null&&avgD<=3) insights.push({icon:'⏱️',type:'warn',text:`Average hold is only ${avgD}d. Swing trades typically need 5-20 days — you may be cutting winners too early.`});
    if(avgD!==null&&avgD>=20) insights.push({icon:'📅',type:'info',text:`Average hold of ${avgD}d is long. Check if losers are being held too long — let winners run, cut losers fast.`});
    // Win rate overall
    const allWins=closed.filter(t=>{const c=fullCalcs(t);return c.pnlV!==null&&c.pnlV>0;});
    const wr=closed.length?Math.round(allWins.length/closed.length*100):0;
    if(wr<30) insights.push({icon:'📉',type:'warn',text:`Win rate is ${wr}%. For a trend-following swing system, 30–50% with R:R ≥ 2x is the target. Focus on reducing losses, not increasing wins.`});
    // Position sizing
    const bigAllocs=trades.filter(t=>t.status==='Open').map(t=>{const c=fullCalcs(t);return c.ap||0;}).filter(x=>x>15);
    if(bigAllocs.length>0) insights.push({icon:'⚖️',type:'warn',text:`${bigAllocs.length} open position${bigAllocs.length>1?'s':''} exceed 15% allocation. Consider sizing down to reduce concentration risk.`});

    if(insights.length){
      insightEl.innerHTML=`<div class="section-hd" style="margin-top:16px">📌 INSIGHTS FOR YOU</div><div class="insight-list">${insights.map(ins=>`<div class="insight-card insight-${ins.type}"><span class="insight-ico">${ins.icon}</span><span>${ins.text}</span></div>`).join('')}</div>`;
    } else {
      insightEl.innerHTML='';
    }
  } else if(insightEl){ insightEl.innerHTML=''; }

  // ── Calendar heatmap ──
  renderCalendarHeatmap();

  // ── Exit reason breakdown ──
  const exitEl=document.getElementById('an-exit');
  if(exitEl){
    const exitMap={};
    closed.forEach(t=>{
      const e=t.exitR||'Untagged';
      if(!exitMap[e])exitMap[e]={count:0,pnl:0,wins:0};
      exitMap[e].count++;
      const c=fullCalcs(t);
      if(c.pnlV!==null){exitMap[e].pnl+=c.pnlV;if(c.pnlV>=0)exitMap[e].wins++;}
    });
    const rows=Object.entries(exitMap).sort((a,b)=>b[1].count-a[1].count);
    if(!rows.length){exitEl.innerHTML='<div class="an-empty">No closed trades yet</div>';}
    else{
      const exitCols=['var(--profit)','var(--loss)','var(--accent)','var(--warn)','#9b59b6','#e67e22','#1abc9c','#e74c3c'];
      const pieSlices=rows.map((r,i)=>({val:r[1].count,col:exitCols[i%exitCols.length]}));
      const pieHTML=drawPie(pieSlices,110);
      const legendHTML=rows.map(([e,d],i)=>{
        const wr=d.count?Math.round(d.wins/d.count*100):0;
        const col=exitCols[i%exitCols.length];
        return `<div class="an-row"><div class="an-row-top"><span class="an-label" style="color:${col}">${escHtml(e)}</span><span class="an-meta">${d.count} trades &nbsp;·&nbsp;<span class="${pCls(d.pnl)}">${fINR(d.pnl,true)}</span></span></div><div class="an-bar-bg"><div class="an-bar" style="width:${wr}%;background:${col}"></div><span class="an-bar-lbl">${wr}%</span></div></div>`;
      }).join('');
      exitEl.innerHTML=`<div class="an-pie-row"><div class="an-pie-wrap">${pieHTML}</div><div class="an-legend">${legendHTML}</div></div>`;
    }
  }
}


/* ═══════════════════════════════════════════════
   PDF EXPORT
/* ═══════════════════════════════════════════════
   LIVE PRICE FETCH
   Strategy: AllOrigins + Yahoo-v8 only (proven working)
   Key fix: 1.2s delay between symbols to avoid rate limiting
   Cache: skip symbols fetched < 4 min ago unless manual
═══════════════════════════════════════════════ */

// Only AllOrigins — CodeTabs always returns "Edge: Too Many Requests"
const ALLORIGINS = u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`;

function yahooV8URL(sym) {
  const clean = sym.replace(/\.(NS|BO|NSE|BSE|IN)$/i,'').toUpperCase() + '.NS';
  // Two Yahoo hosts — query2 is primary, query1 as fallback
  return [
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?interval=1d&range=2d`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?interval=1d&range=2d`,
  ];
}

function parseYahooV8(text) {
  const data = JSON.parse(text);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'No result in response');
  const meta  = result.meta;
  const price = meta.regularMarketPrice ?? meta.previousClose;
  const prev  = meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? meta.previousClose;
  if (!price) throw new Error('Price is null');
  const chg = prev ? (price - prev) / prev * 100 : 0;
  return { price: (+price).toFixed(2), chg: +chg.toFixed(2) };
}

/* ─── Debug log ─── */
const lpLog = [];
function lpDebug(msg, type='info') {
  lpLog.unshift({ ts: new Date().toLocaleTimeString('en-IN'), msg, type });
  if (lpLog.length > 120) lpLog.pop();
  renderDebugLog();
}
function renderDebugLog() {
  const panel = document.getElementById('lp-debug-log');
  if (!panel) return;
  if (!lpLog.length) { panel.innerHTML = '<div class="dbg-empty">Tap Fetch or test a symbol</div>'; return; }
  panel.innerHTML = lpLog.map(e => {
    const col = e.type==='ok'?'var(--profit)':e.type==='err'?'var(--loss)':e.type==='warn'?'var(--warn)':'var(--text2)';
    return `<div class="dbg-row"><span class="dbg-ts">${e.ts}</span><span class="dbg-msg" style="color:${col}">${escHtml(e.msg)}</span></div>`;
  }).join('');
}

/* ─── Timeout-safe fetch (works on all Android WebViews) ─── */
function fetchWithTimeout(url, ms=9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, headers: { Accept: '*/*' } }).finally(() => clearTimeout(t));
}

/* ─── Fetch single symbol — tries query2 then query1, both via AllOrigins ─── */
async function fetchSymbolPrice(sym) {
  const clean = sym.replace(/\.(NS|BO|NSE|BSE|IN)$/i,'').toUpperCase();
  const urls  = yahooV8URL(clean);

  for (let i = 0; i < urls.length; i++) {
    const label    = i === 0 ? 'query2' : 'query1';
    const proxyURL = ALLORIGINS(urls[i]);
    lpDebug(`[${clean}] Trying AllOrigins/${label}…`);
    try {
      const res = await fetchWithTimeout(proxyURL, 9000);
      lpDebug(`[${clean}] HTTP ${res.status} ← AllOrigins/${label}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.trim().length < 10) throw new Error('Empty response');
      if (text.includes('Too Many Requests') || text.includes('rate limit')) throw new Error('Rate limited');
      const r = parseYahooV8(text);
      r.ts  = Date.now();
      r.via = `AllOrigins/${label}`;
      lpDebug(`[${clean}] ✓ ₹${r.price} (${r.chg>=0?'+':''}${r.chg}%)`, 'ok');
      return r;
    } catch(e) {
      const isLast = i === urls.length - 1;
      lpDebug(`[${clean}] ✗ AllOrigins/${label}: ${e.message}`, isLast ? 'err' : 'warn');
      // Brief pause before trying the alternate Yahoo host
      if (!isLast) await new Promise(r => setTimeout(r, 400));
    }
  }
  return null;
}

/* ─── Fetch all open trades — serial with 1.2s gap to avoid rate limiting ─── */
const LP_CACHE_MS = 4 * 60 * 1000; // 4 min cache

async function fetchOpenPrices(manual=false) {
  if (!featOn('livePrice') && !manual) return;
  const openTrades = trades.filter(t => t.status==='Open' && t.stock);
  if (!openTrades.length) { lpDebug('No open trades to fetch', 'warn'); updateLPIndicator(0,0); return; }
  if (lpFetching) { lpDebug('Already in progress…', 'warn'); return; }
  lpFetching = true;

  updateLPIndicator(-1, 0); // loading state

  const symbols = [...new Set(openTrades.map(t => t.stock.replace(/\.(NS|BO|NSE|BSE|IN)$/i,'').toUpperCase()))];

  // Skip symbols with fresh cache (unless manual refresh)
  const toFetch = manual
    ? symbols
    : symbols.filter(s => !livePrices[s] || livePrices[s].error || (Date.now() - (livePrices[s].ts||0)) > LP_CACHE_MS);

  if (!toFetch.length) {
    lpDebug('All prices are fresh (< 4 min old) — skipping', 'ok');
    lpFetching = false;
    updateLPIndicator(symbols.length, 0);
    return;
  }

  lpDebug(`━━ Fetching ${toFetch.length} symbol(s): ${toFetch.join(', ')} ━━`);
  if (toFetch.length < symbols.length) {
    lpDebug(`(${symbols.length - toFetch.length} skipped — cached)`, 'ok');
  }

  let ok=0, fail=0;
  for (let i = 0; i < toFetch.length; i++) {
    const sym = toFetch[i];
    const r = await fetchSymbolPrice(sym);
    if (r) { livePrices[sym] = r; ok++; }
    else   { livePrices[sym] = { error:true, ts:Date.now() }; fail++; }

    // KEY FIX: 1.2s gap between requests — prevents AllOrigins rate limiting
    if (i < toFetch.length - 1) {
      lpDebug(`[pause 1.2s before next symbol…]`);
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  lpFetching = false;
  const totalOk = symbols.filter(s => livePrices[s] && !livePrices[s].error).length;
  lpDebug(`━━ Done: ${ok} fetched, ${fail} failed, ${totalOk}/${symbols.length} total available ━━`, fail===0?'ok':ok===0?'err':'warn');

  // Update debug panel badge
  const badge = document.getElementById('lp-status-badge');
  if (badge) {
    if (fail===0) { badge.textContent=`✓ ${ok} updated`; badge.className='lp-badge lp-badge-ok'; }
    else if (ok===0) { badge.textContent=`✗ ${fail} failed`; badge.className='lp-badge lp-badge-err'; }
    else { badge.textContent=`⚠ ${ok}✓ ${fail}✗`; badge.className='lp-badge lp-badge-warn'; }
  }
  const le = document.getElementById('lp-last-time');
  if (le) le.textContent = `Last: ${new Date().toLocaleTimeString('en-IN')}`;

  updateLPIndicator(totalOk, fail);
  if (curView==='table') renderTable();
  renderDash();
}

/* ─── Dashboard LP status indicator ─── */
function updateLPIndicator(ok, fail) {
  const el = document.getElementById('lp-dash-indicator');
  if (!el) return;
  if (ok === -1) {
    el.innerHTML = `<span class="lp-ind-ing">⟳ Fetching prices…</span>`;
  } else if (ok === 0 && fail === 0) {
    el.innerHTML = '';
  } else {
    const t = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    const cls = fail===0 ? 'lp-ind-ok' : 'lp-ind-warn';
    const txt = fail===0 ? `✓ Prices updated ${t}` : `⚠ ${ok} updated, ${fail} failed ${t}`;
    el.innerHTML = `<span class="${cls}" onclick="fetchOpenPrices(true)" style="cursor:pointer">${txt} ⟳</span>`;
  }
}

/* ─── Auto-refresh every 5 min ─── */
setInterval(() => { if (curView==='table' || curView==='dashboard') fetchOpenPrices(); }, 5*60*1000);

/* ─── Manual single-symbol test ─── */
async function testSingleSymbol() {
  const inp = document.getElementById('lp-test-sym');
  const sym = (inp?.value||'').trim().toUpperCase();
  if (!sym) { toast('⚠ Enter a symbol first'); return; }
  lpDebug(`━━ Manual test: ${sym} ━━`);
  const badge = document.getElementById('lp-status-badge');
  if (badge) { badge.textContent='⏳ Testing…'; badge.className='lp-badge lp-badge-ing'; }
  const r = await fetchSymbolPrice(sym);
  if (r) {
    livePrices[sym] = r;
    if (badge) { badge.textContent=`✓ ₹${r.price}`; badge.className='lp-badge lp-badge-ok'; }
    toast(`✓ ${sym}: ₹${r.price} (${r.chg>=0?'+':''}${r.chg}%) via ${r.via}`);
  } else {
    if (badge) { badge.textContent='✗ Failed'; badge.className='lp-badge lp-badge-err'; }
    toast(`✗ ${sym}: fetch failed — is market open? check debug log`);
  }
  if (curView==='table') renderTable();
  renderDash();
}


/* ═══════════════════════════════════════════════
   PDF EXPORT
═══════════════════════════════════════════════ */
function exportPDF() {
  const closed=trades.filter(t=>t.status==='Closed');
  const open=trades.filter(t=>t.status==='Open');
  let totalPnL=0;
  closed.forEach(t=>{const c=fullCalcs(t);if(c.pnlV!==null)totalPnL+=c.pnlV;});
  const wins=closed.filter(t=>{const c=fullCalcs(t);return c.pnlV!==null&&c.pnlV>0;});
  const wr=closed.length?Math.round(wins.length/closed.length*100):0;
  const rrs=closed.map(t=>fullCalcs(t).rr).filter(x=>x!==null);
  const avgRR=rrs.length?(rrs.reduce((a,b)=>a+b,0)/rrs.length).toFixed(2):'—';
  const totPct=cfg.portVal>0?(totalPnL/cfg.portVal*100).toFixed(2):'—';
  const winPnls=closed.map(t=>fullCalcs(t).pnlP).filter(x=>x!==null&&x>0);
  const lossPnls=closed.map(t=>fullCalcs(t).pnlP).filter(x=>x!==null&&x<0);
  const winR=closed.length?wins.length/closed.length:0;
  const avgWin=winPnls.length?winPnls.reduce((a,b)=>a+b,0)/winPnls.length:0;
  const avgLoss=lossPnls.length?Math.abs(lossPnls.reduce((a,b)=>a+b,0)/lossPnls.length):0;
  const exp=((winR*avgWin)-((1-winR)*avgLoss)).toFixed(2);
  const now=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const isDark=(document.documentElement.getAttribute('data-theme')||'dark')==='dark';
  const bg=isDark?'#060b14':'#f4f7fb',bg2=isDark?'#0a1422':'#fff',textC=isDark?'#e8f4ff':'#06192e',text2=isDark?'#90b8d8':'#1e4a72',accent=isDark?'#00b4ff':'#005faa',profit=isDark?'#00e676':'#007a46',loss=isDark?'#ff4560':'#c0202e',bord=isDark?'#14263e':'#c8d8e8';

  const rowsHTML=[...trades].map((t,i)=>{
    const c=fullCalcs(t);
    const sc=t.status==='Open'?accent:(c.pnlV>=0?profit:loss);
    return `<tr style="border-bottom:1px solid ${bord}"><td>${i+1}</td><td style="font-weight:700">${t.stock}</td><td style="color:${sc}">${t.status}</td><td>${fDate(t.buyDate)}</td><td>\u20B9${t.buyPx||'—'}</td><td>${t.qty||'—'}</td><td>${fDate(t.sellDate)}</td><td>${t.sellPx?'\u20B9'+t.sellPx:'—'}</td><td style="color:${c.pnlV===null?text2:c.pnlV>=0?profit:loss}">${c.pnlV!==null?fINR(c.pnlV):t.status==='Open'?'Open':'—'}</td><td style="color:${c.pnlP===null?text2:c.pnlP>=0?profit:loss}">${c.pnlP!==null?(sgn(c.pnlP)+f2(c.pnlP)+'%'):'—'}</td><td style="color:${c.rr===null?text2:c.rr>=1?profit:loss}">${c.rr!==null?f2(c.rr)+'x':'—'}</td><td>${t.grade||'—'}</td><td style="font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.setup||'—'}</td></tr>`;
  }).join('');

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TradeLog Report ${now}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:${bg};color:${textC};font-size:13px;padding:32px}h1{font-size:28px;font-weight:700;letter-spacing:2px;color:${accent};margin-bottom:4px}.sub{font-size:12px;color:${text2};margin-bottom:24px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}.sc{background:${bg2};border:1px solid ${bord};border-radius:8px;padding:12px;text-align:center}.sc-lbl{font-size:10px;color:${text2};text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}.sc-val{font-size:22px;font-weight:700}h2{font-size:14px;font-weight:700;letter-spacing:2px;color:${text2};text-transform:uppercase;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid ${bord}}table{width:100%;border-collapse:collapse;font-size:11px}th{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:${text2};padding:7px 8px;text-align:left;background:${bg};border-bottom:2px solid ${bord}}td{padding:7px 8px}@media print{body{padding:16px}}</style></head><body>
  <h1>TRADELOG</h1><div class="sub">Report: ${now} &nbsp;&bull;&nbsp; Portfolio: ${fBig(cfg.portVal)}</div>
  <div class="stats">
    <div class="sc"><div class="sc-lbl">Total Trades</div><div class="sc-val" style="color:${accent}">${trades.length}</div></div>
    <div class="sc"><div class="sc-lbl">Win Rate</div><div class="sc-val" style="color:${profit}">${wr}%</div></div>
    <div class="sc"><div class="sc-lbl">Realized P&L</div><div class="sc-val" style="color:${totalPnL>=0?profit:loss}">${fINR(totalPnL,true)}</div></div>
    <div class="sc"><div class="sc-lbl">Port P&L %</div><div class="sc-val" style="color:${parseFloat(totPct||0)>=0?profit:loss}">${totPct!=='—'?(parseFloat(totPct)>=0?'+':'')+totPct+'%':totPct}</div></div>
    <div class="sc"><div class="sc-lbl">Avg R:R</div><div class="sc-val" style="color:${accent}">${avgRR}x</div></div>
    <div class="sc"><div class="sc-lbl">Expectancy</div><div class="sc-val" style="color:${parseFloat(exp)>=0?profit:loss}">${parseFloat(exp)>=0?'+':''}${exp}%</div></div>
    <div class="sc"><div class="sc-lbl">Open</div><div class="sc-val" style="color:${accent}">${open.length}</div></div>
    <div class="sc"><div class="sc-lbl">Closed</div><div class="sc-val" style="color:${textC}">${closed.length}</div></div>
  </div>
  <h2>All Trades</h2>
  <table><thead><tr><th>#</th><th>Stock</th><th>Status</th><th>Buy Date</th><th>Buy</th><th>Qty</th><th>Sell Date</th><th>Sell</th><th>P&L</th><th>P&L%</th><th>R:R</th><th>Grade</th><th>Setup</th></tr></thead><tbody>${rowsHTML}</tbody></table>
  <div style="font-size:10px;color:${text2};text-align:center;padding-top:12px;border-top:1px solid ${bord}">TradeLog NSE Journal &bull; ${now}</div>
  <script>window.onload=()=>window.print();<\/script></body></html>`;

  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`tradelog_report_${new Date().toISOString().slice(0,10)}.html`});
  a.click(); URL.revokeObjectURL(a.href);
  toast('📄 Report downloaded — open in browser, then Print → Save as PDF');
}

/* ─── TradingView link helper ─── */
function tvURL(stock) {
  // Strip common suffixes users might type, then prefix NSE:
  // Handle & in stock names correctly (e.g. GVT&D)
  const sym = stock.replace(/\.(NS|BO|NSE|BSE)$/i, '').toUpperCase();
  return `https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(sym)}`;
}
function openTV(stock, e) {
  e.stopPropagation();
  window.open(tvURL(stock), '_blank', 'noopener');
}

function tradeCardHTML(t) {
  const c   = fullCalcs(t);
  const sel = selectMode && selectedIds.has(t.id);
  let cls   = 'trade-card';
  if (selectMode)                         cls += ' selecting';
  if (sel)                                cls += ' selected';
  else if (t.status==='Open')             cls += ' tc-open';
  else if (c.pnlV!==null && c.pnlV>=0)   cls += ' tc-profit';
  else if (c.pnlV!==null && c.pnlV<0)    cls += ' tc-loss';

  const pnlStr = t.status==='Open'
    ? (() => {
        const lp = livePrices[t.stock];
        if (lp && featOn('livePrice')) {
          const chgCls = lp.chg >= 0 ? 'val-p' : 'val-l';
          return `<span style="font-family:var(--ff-m);font-size:13px">₹${lp.price} <span class="${chgCls}">${lp.chg>=0?'+':''}${lp.chg}%</span></span>`;
        }
        return `<span style="color:var(--open-c);font-size:12px;font-family:var(--ff-m)">OPEN · ${c.days!==null?c.days+'d':''}</span>`;
      })()
    : (c.pnlV!==null
        ? `<span class="${pCls(c.pnlV)}" style="font-family:var(--ff-m);font-size:14px">${fINR(c.pnlV,true)} &nbsp;${sgn(c.pnlP)}${f2(c.pnlP)}%</span>`
        : '—');

  const checkCls = `tc-check${selectMode?' visible':''}${sel?' checked':''}`;
  const cardClick = selectMode
    ? `onclick="toggleCardSelect('${t.id}',event)"`
    : `onclick="openDetailMo('${t.id}')"`;

  return `<div class="${cls}" data-id="${t.id}" ${cardClick}>
    <div class="${checkCls}" onclick="toggleCardSelect('${t.id}',event)"></div>
    <div class="tc-top">
      <div class="tc-stock">${t.stock}</div>
      <div class="tc-badges">
        <span class="badge b-${t.status.toLowerCase()}">${t.status}</span>
        <span class="badge b-${t.type.toLowerCase()}">${t.type==='Virtual'?'VIRT':'REAL'}</span>
        <button class="tv-btn" onclick="openTV('${t.stock}',event)" title="Open on TradingView">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
          TV
        </button>
      </div>
    </div>
    <div class="tc-metrics">
      <div class="tc-m"><span class="ml">Buy</span><span class="mv">₹${t.buyPx||'—'}</span></div>
      <div class="tc-m"><span class="ml">SL</span><span class="mv">${t.sl?'₹'+t.sl:'—'}</span></div>
      <div class="tc-m"><span class="ml">SL%</span><span class="mv val-l">${c.sl!==null?f2(c.sl)+'%':'—'}</span></div>
      <div class="tc-m"><span class="ml">Alloc</span><span class="mv">${c.al?fINR(c.al,true):'—'}</span></div>
      <div class="tc-m"><span class="ml">Qty</span><span class="mv">${c.q!==null?c.q:'—'}</span></div>
      <div class="tc-m"><span class="ml">${t.status==='Open'?'Days':'R:R'}</span><span class="mv ${pCls(c.rr)}">${t.status==='Open'?(c.days!==null?c.days+'d':'—'):(c.rr!==null?f2(c.rr)+'x':'—')}</span></div>
    </div>
    <div class="tc-bottom">
      <span class="tc-setup">${t.setup||t.mktState||'—'}</span>
      <span style="display:flex;align-items:center;gap:6px">
        ${t.grade ? gradeBadgeHTML(t.grade) : ''}
        <span class="tc-pnl">${pnlStr}</span>
      </span>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════
   RENDER — TRADES LIST
═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   RENDER — TABLE
═══════════════════════════════════════════════ */
function renderTable() {
  renderTableHead();
  const list    = sortedTrades(filteredTrades());
  const tbody   = document.getElementById('tbl-body');
  const countEl = document.getElementById('ledger-count-hd');
  if (countEl) {
    const shown = list.length, total = trades.length;
    countEl.textContent = shown < total ? `LEDGER — ${shown} of ${total} trades` : `TRADE LEDGER — ${total} trade${total===1?'':'s'}`;
  }
  if (!list.length) {
    const colspan = visibleCols().length;
    tbody.innerHTML=`<tr><td colspan="${colspan}" style="text-align:center;color:var(--text3);padding:30px">${ledgerSearch?'No trades match your search':'No trades yet'}</td></tr>`;
    return;
  }
  const cols = visibleCols();
  tbody.innerHTML = list.map((t,i) => {
    const c  = fullCalcs(t);
    const lp = livePrices[t.stock];
    const get = lbl => {
      switch(lbl) {
        case '#':         return `<td class="td-num" style="text-align:left;position:sticky;left:0;background:var(--bg2);z-index:1">${i+1}</td>`;
        case 'Stock':     return `<td class="td-stock" style="text-align:left;position:sticky;left:38px;background:var(--bg2);z-index:1">${escHtml(t.stock)}<a href="${tvURL(t.stock)}" target="_blank" rel="noopener" class="tv-tbl-link" onclick="event.stopPropagation()">↗</a></td>`;
        case 'Status':    return `<td><span class="badge b-${t.status.toLowerCase()}">${t.status}</span></td>`;
        case 'Type':      return `<td><span class="badge b-${t.type.toLowerCase()}">${t.type==='Virtual'?'VIRT':'REAL'}</span></td>`;
        case 'Live ₹':  {
          if (!lp) return `<td class="lp-cell" id="lp-${t.id}">${t.status==='Open'?'<span class="lp-loading">…</span>':'—'}</td>`;
          const chgCls = lp.chg>=0?'val-p':'val-l';
          return `<td class="lp-cell ${chgCls}">₹${lp.price} <span class="lp-chg">${lp.chg>=0?'+':''}${f2(lp.chg)}%</span></td>`;
        }
        case 'Buy Date':  return `<td>${fDate(t.buyDate)}</td>`;
        case 'Buy ₹': return `<td>${t.buyPx?'₹'+t.buyPx:'—'}</td>`;
        case 'EM Prev':   return `<td>${t.emPrev?'₹'+t.emPrev:'—'}</td>`;
        case 'EM Day':    return `<td>${t.emDay?'₹'+t.emDay:'—'}</td>`;
        case 'Sell Date': return `<td>${fDate(t.sellDate)}</td>`;
        case 'Sell ₹':return `<td>${t.sellPx?'₹'+t.sellPx:'—'}</td>`;
        case 'SL ₹': return `<td>${t.sl?'₹'+t.sl:'—'}</td>`;
        case 'SL %':      return `<td class="${pCls(c.sl!==null?-c.sl:null)}">${c.sl!==null?f2(c.sl)+'%':'—'}</td>`;
        case 'Alloc ₹':return `<td>${c.al?fINR(c.al,true):'—'}</td>`;
        case 'Alloc %':   return `<td>${c.ap!==null?f2(c.ap)+'%':'—'}</td>`;
        case 'Qty':       return `<td>${c.q!==null?c.q:'—'}</td>`;
        case 'P&L ₹': {
          if (c.pnlV !== null) return `<td class="${pCls(c.pnlV)}">${fINR(c.pnlV,true)}</td>`;
          if (t.status === 'Open') {
            const lp2 = livePrices[t.stock];
            const cmp2 = lp2 && !lp2.error ? +lp2.price : null;
            const qty2 = c.q || t.qty || null;
            const unrV = (cmp2 && qty2 && t.buyPx) ? (cmp2 - t.buyPx) * qty2 : null;
            return `<td class="${pCls(unrV)}" title="Unrealised">${unrV !== null ? fINR(unrV,true) + '<span style="font-size:9px;opacity:.55"> U</span>' : '<span style="font-size:10px;color:var(--text3)">OPEN</span>'}</td>`;
          }
          return `<td>—</td>`;
        }
        case 'P&L %': {
          if (c.pnlP !== null) return `<td class="${pCls(c.pnlP)}">${sgn(c.pnlP)+f2(c.pnlP)+'%'}</td>`;
          if (t.status === 'Open') {
            const lp3 = livePrices[t.stock];
            const cmp3 = lp3 && !lp3.error ? +lp3.price : null;
            const unrP = (cmp3 && t.buyPx) ? (cmp3 - t.buyPx) / t.buyPx * 100 : null;
            return `<td class="${pCls(unrP)}" title="Unrealised">${unrP !== null ? sgn(unrP)+f2(unrP)+'%' + '<span style="font-size:9px;opacity:.55"> U</span>' : '—'}</td>`;
          }
          return `<td>—</td>`;
        }
        case 'Port P&L%': {
          if (c.portPnl !== null) return `<td class="${pCls(c.portPnl)}">${sgn(c.portPnl)+f2(c.portPnl)+'%'}</td>`;
          if (t.status === 'Open') {
            const lp4 = livePrices[t.stock];
            const cmp4 = lp4 && !lp4.error ? +lp4.price : null;
            const qty4 = c.q || t.qty || null;
            const unrV4 = (cmp4 && qty4 && t.buyPx) ? (cmp4 - t.buyPx) * qty4 : null;
            const pv4 = cfg.portVal || 0;
            const unrPP = (unrV4 !== null && pv4 > 0) ? unrV4 / pv4 * 100 : null;
            return `<td class="${pCls(unrPP)}" title="Unrealised">${unrPP !== null ? sgn(unrPP)+f2(unrPP)+'%' + '<span style="font-size:9px;opacity:.55"> U</span>' : '—'}</td>`;
          }
          return `<td>—</td>`;
        }
        case 'R:R':       return `<td class="${pCls(c.rr)}">${c.rr!==null?f2(c.rr)+'x':'—'}</td>`;
        case 'Days':      return `<td>${c.days!==null?c.days+'d':'—'}</td>`;
        case 'Grade':     return `<td>${t.grade?gradeBadgeHTML(t.grade):'—'}</td>`;
        case 'Setup':     return `<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.setup||'—'}</td>`;
        case 'Exit':      return `<td>${t.exitR||'—'}</td>`;
        case 'Mkt State': return `<td>${t.mktState||'—'}</td>`;
        default:          return `<td>—</td>`;
      }
    };
    return `<tr onclick="openDetailMo('${t.id}')">${cols.map(c=>get(c.lbl)).join('')}</tr>`;
  }).join('');
}

/* ═══════════════════════════════════════════════
   FEATURE TOGGLE SYSTEM
═══════════════════════════════════════════════ */

// Master feature registry — id matches CSS class `feat-{id}` on form elements
const FEATURES = [
  { id:'tradeType', label:'Real / Virtual Tag',      desc:'Tag trades as Real or Paper/Virtual',    icon:'🏷️',  group:'Entry',    def:true  },
  { id:'ema',       label:'EM Values',               desc:'Record EM on prev day & entry day',       icon:'📈',  group:'Entry',    def:true  },
  { id:'sl',        label:'Stop Loss (SL)',           desc:'SL price and auto-calculated SL %',       icon:'🛡️',  group:'Risk',     def:true  },
  { id:'alloc',     label:'Allocation / Position',   desc:'Allocation ₹, Alloc %, Quantity auto',    icon:'💰',  group:'Risk',     def:true  },
  { id:'portPnl',   label:'Portfolio P&L %',         desc:'P&L as % of total portfolio value',       icon:'📊',  group:'Results',  def:true  },
  { id:'rr',        label:'Risk:Reward Ratio',       desc:'R:R = Profit booked ÷ SL distance',       icon:'⚖️',  group:'Results',  def:true  },
  { id:'days',      label:'Days Held',               desc:'Number of days trade was held',           icon:'📅',  group:'Results',  def:true  },
  { id:'setup',     label:'Setup / Pattern',         desc:'Chart pattern dropdown (VCP, Flag…)',     icon:'🔭',  group:'Analysis', def:true  },
  { id:'exitR',     label:'Exit Reason',             desc:'Why you closed the trade',                icon:'🚪',  group:'Analysis', def:true  },
  { id:'mktState',  label:'Market State',            desc:'Overall market condition at trade time',  icon:'🌡️',  group:'Analysis', def:true  },
  { id:'notes',     label:'Notes / Journal',         desc:'Free-text observations and lessons',      icon:'📝',  group:'Analysis', def:true  },
  { id:'grade',     label:'Execution Grade',          desc:'Rate your trade discipline (A/B/C/D)',    icon:'🎯',  group:'Analysis', def:true  },
  { id:'livePrice', label:'Live Price Column',         desc:'Current price for open trades in Ledger', icon:'📡',  group:'Analysis', def:true  },
];

// Active features stored in cfg
function defaultFeatures() {
  const f={};
  FEATURES.forEach(ft=>{ f[ft.id]=ft.def; });
  return f;
}

function featOn(id) {
  return cfg.features ? (cfg.features[id] !== false) : true;
}

function applyFeatures() {
  FEATURES.forEach(ft=>{
    const on = featOn(ft.id);
    // Show/hide all elements with class feat-{id}
    document.querySelectorAll(`.feat-${ft.id}`).forEach(el=>{
      el.style.display = on ? '' : 'none';
    });
  });
  // Hide analysis section divider entirely if all analysis fields are off
  const analysisFeatIds = ['setup','exitR','mktState','notes'];
  const anyAnalysis = analysisFeatIds.some(id=>featOn(id));
  // The divider before analysis already uses feat classes, handled above
}

function renderFeatureList() {
  if(!cfg.features) cfg.features = defaultFeatures();
  const el = document.getElementById('feat-list');
  if(!el) return;

  // Group features
  const groups = {};
  FEATURES.forEach(ft=>{
    if(!groups[ft.group]) groups[ft.group]=[];
    groups[ft.group].push(ft);
  });

  let html='';
  Object.entries(groups).forEach(([grp, feats])=>{
    html += `<div class="feat-group-lbl">${grp}</div>`;
    feats.forEach(ft=>{
      const on = featOn(ft.id);
      html += `<div class="feat-row" onclick="toggleFeat('${ft.id}')">
        <div class="feat-ico">${ft.icon}</div>
        <div class="feat-info">
          <div class="feat-name">${ft.label}</div>
          <div class="feat-desc">${ft.desc}</div>
        </div>
        <div class="feat-tog ${on?'feat-on':'feat-off'}" id="ftog-${ft.id}">
          <div class="feat-thumb"></div>
        </div>
      </div>`;
    });
  });

  // Reset to defaults button
  html += `<button class="feat-reset-btn" onclick="resetFeatures()">↺ Reset All to Defaults</button>`;
  el.innerHTML = html;
}

function toggleFeat(id) {
  if(!cfg.features) cfg.features = defaultFeatures();
  cfg.features[id] = !featOn(id);
  localStorage.setItem(LS_C, JSON.stringify(cfg));
  // Update the toggle visually
  const tog = document.getElementById('ftog-'+id);
  if(tog) {
    tog.className = 'feat-tog ' + (cfg.features[id] ? 'feat-on' : 'feat-off');
  }
  applyFeatures();
  // Re-render table head if on table view
  if(curView==='table') renderTableHead();
}

function resetFeatures() {
  cfg.features = defaultFeatures();
  localStorage.setItem(LS_C, JSON.stringify(cfg));
  renderFeatureList();
  applyFeatures();
  if(curView==='table') renderTableHead();
  toast('✓ All fields restored to defaults');
}

/* ═══════════════════════════════════════════════
   TABLE — DYNAMIC COLUMNS BASED ON FEATURES
═══════════════════════════════════════════════ */
// Column definitions: [label, alwaysOn, featId or null]
const TABLE_COLS = [
  { lbl:'#',          always:true  },
  { lbl:'Stock',      always:true  },
  { lbl:'Status',     always:true  },
  { lbl:'Type',       feat:'tradeType' },
  { lbl:'Live ₹',     feat:'livePrice'},
  { lbl:'Buy Date',   always:true  },
  { lbl:'Buy ₹',      always:true  },
  { lbl:'EM Prev',    feat:'ema'   },
  { lbl:'EM Day',     feat:'ema'   },
  { lbl:'Sell Date',  always:true  },
  { lbl:'Sell ₹',     always:true  },
  { lbl:'SL ₹',       feat:'sl'    },
  { lbl:'SL %',       feat:'sl'    },
  { lbl:'Alloc ₹',    feat:'alloc' },
  { lbl:'Alloc %',    feat:'alloc' },
  { lbl:'Qty',        feat:'alloc' },
  { lbl:'P&L ₹',      always:true  },
  { lbl:'P&L %',      always:true  },
  { lbl:'Port P&L%',  feat:'portPnl'},
  { lbl:'R:R',        feat:'rr'    },
  { lbl:'Days',       feat:'days'  },
  { lbl:'Grade',      feat:'grade' },
  { lbl:'Setup',      feat:'setup' },
  { lbl:'Exit',       feat:'exitR' },
  { lbl:'Mkt State',  feat:'mktState'},
];

function visibleCols() {
  return TABLE_COLS.filter(c => (c.always || featOn(c.feat)) && !hiddenCols.has(c.lbl));
}

function renderTableHead() {
  const thead = document.getElementById('tbl-head');
  if (!thead) return;
  const cols = visibleCols();
  const stickyLeft = ['#','Stock'];
  // # col is not sortable (it's just row index)
  const nonSortable = new Set(['#']);
  let th = cols.map((c,i) => {
    const isSticky  = stickyLeft.includes(c.lbl);
    const noSort    = nonSortable.has(c.lbl);
    const isSorted  = sortCol === c.lbl;
    const arrow     = isSorted ? (sortDir==='asc' ? ' ▲' : ' ▼') : '';
    const cursor    = noSort ? '' : 'cursor:pointer;user-select:none;';
    const highlight = isSorted ? 'color:var(--accent);' : '';
    const stickyStyle = isSticky
      ? `text-align:left;position:sticky;left:${i===0?'0':'38px'};z-index:3;background:var(--bg);`
      : '';
    const onclick = noSort ? '' : `onclick="sortByCol('${c.lbl.replace(/'/g,"\\'")}')"`;
    return `<th style="${stickyStyle}${cursor}${highlight}" ${onclick} title="${noSort?'':('Sort by '+c.lbl)}">${c.lbl}${arrow}</th>`;
  }).join('');
  thead.innerHTML = `<tr>${th}</tr>`;
}

function sortByCol(lbl) {
  if (sortCol === lbl) {
    // cycle: asc → desc → none
    if (sortDir === 'asc') { sortDir = 'desc'; }
    else { sortCol = null; sortDir = 'asc'; }
  } else {
    sortCol = lbl; sortDir = 'asc';
  }
  renderTableHead();
  renderTable();
}

/* Extract a comparable sort value from a trade for a given column label */
function sortVal(t, lbl) {
  const c = fullCalcs(t);
  switch(lbl) {
    case 'Stock':      return t.stock || '';
    case 'Status':     return t.status || '';
    case 'Type':       return t.type || '';
    case 'Buy Date':   return t.buyDate || '';
    case 'Buy ₹':      return t.buyPx || 0;
    case 'EM Prev':    return t.emPrev || 0;
    case 'EM Day':     return t.emDay || 0;
    case 'Sell Date':  return t.sellDate || '';
    case 'Sell ₹':     return t.sellPx || 0;
    case 'SL ₹':       return t.sl || 0;
    case 'SL %':       return c.sl ?? 0;
    case 'Alloc ₹':    return c.al ?? 0;
    case 'Alloc %':    return c.ap ?? 0;
    case 'Qty':        return c.q ?? 0;
    case 'P&L ₹':      return c.pnlV ?? -Infinity;
    case 'P&L %':      return c.pnlP ?? -Infinity;
    case 'Port P&L%':  return c.portPnl ?? -Infinity;
    case 'R:R':        return c.rr ?? -Infinity;
    case 'Days':       return c.days ?? -1;
    case 'Grade':      return ['A','B','C','D'].indexOf(t.grade ?? '') + 1 || 99;
    case 'Setup':      return t.setup || '';
    case 'Exit':       return t.exitR || '';
    case 'Mkt State':  return t.mktState || '';
    case 'Live ₹':     return livePrices[t.stock]?.price ?? 0;
    default:           return 0;
  }
}

function sortedTrades(list) {
  if (!sortCol) return list;
  return [...list].sort((a, b) => {
    const va = sortVal(a, sortCol);
    const vb = sortVal(b, sortCol);
    let cmp = 0;
    if (typeof va === 'string') cmp = va.localeCompare(vb);
    else cmp = va - vb;
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

/* ═══════════════════════════════════════════════
   BULK SELECT / DELETE
═══════════════════════════════════════════════ */

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  document.querySelectorAll('.fp').forEach(x => x.classList.remove('active'));
  document.getElementById('fp-select')?.classList.add('active');
  renderTable();
  updateBulkToolbar();
}

function exitSelectMode() {
  selectMode   = false;
  selectedIds.clear();
  ledgerFilter = 'all';
  document.querySelectorAll('.fp').forEach(x => x.classList.remove('active'));
  document.querySelector('.fp[data-f="all"]')?.classList.add('active');
  document.getElementById('fp-select')?.classList.remove('active');
  renderTable();
  updateBulkToolbar();
}

function toggleCardSelect(id, e) {
  e.stopPropagation();
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  // Update just this card visually
  const card = document.querySelector(`.trade-card[data-id="${id}"]`);
  if (card) {
    const chk = card.querySelector('.tc-check');
    if (selectedIds.has(id)) {
      card.classList.add('selected');
      chk?.classList.add('checked');
    } else {
      card.classList.remove('selected');
      chk?.classList.remove('checked');
    }
  }
  updateBulkToolbar();
}

function updateBulkToolbar() {
  const tb  = document.getElementById('bulk-toolbar');
  const cnt = document.getElementById('bulk-count');
  if (!tb) return;
  if (selectMode && selectedIds.size > 0) {
    tb.classList.add('show');
    cnt.textContent = `${selectedIds.size} trade${selectedIds.size===1?'':'s'} selected`;
  } else {
    tb.classList.remove('show');
  }
}

function bulkDelete() {
  if (!selectedIds.size) return;
  const n = selectedIds.size;
  // Confirm via the existing confirm dialog
  // Temporarily hijack doDelete for bulk
  document.querySelector('#confirm-box h3').textContent = `Delete ${n} Trade${n===1?'':'s'}?`;
  document.querySelector('#confirm-box p').textContent  = `This will permanently remove ${n} selected trade${n===1?'':'s'}.`;
  document.getElementById('confirm-ov').classList.add('open');
  // Override confirm action just for this call
  window._bulkDeletePending = true;
}

function closeConfirm() {
  document.getElementById('confirm-ov').classList.remove('open');
  // Restore normal confirm text
  document.querySelector('#confirm-box h3').textContent = 'Delete Trade?';
  document.querySelector('#confirm-box p').textContent  = 'This action cannot be undone.';
  window._bulkDeletePending = false;
}

function doDelete() {
  if (window._bulkDeletePending) {
    const ids = [...selectedIds];
    trades = trades.filter(t => !selectedIds.has(t.id));
    const n = ids.length;
    saveTrades();
    ids.forEach(id => deleteTradeCloud(id));
    exitSelectMode(); closeConfirm(); renderAll();
    toast(`🗑 Deleted ${n} trade${n===1?'':'s'}`);
    window._bulkDeletePending = false;
    return;
  }
  // Single delete
  if (!editId) return;
  const delId = editId;
  trades = trades.filter(t => t.id !== delId);
  saveTrades(); deleteTradeCloud(delId);
  closeConfirm(); closeTradeMo(); closeDetailMo(); renderAll();
  toast('Trade deleted');
}

function deleteFromDetail() {
  // Trigger delete confirm from detail modal
  editId = detId;
  window._bulkDeletePending = false;
  document.querySelector('#confirm-box h3').textContent = 'Delete Trade?';
  document.querySelector('#confirm-box p').textContent  = 'This action cannot be undone.';
  document.getElementById('confirm-ov').classList.add('open');
}

/* ═══════════════════════════════════════════════
   LEDGER FILTER + SEARCH STATE
═══════════════════════════════════════════════ */

function applyLedgerFilters() {
  const inp = document.getElementById('ledger-search');
  ledgerSearch = inp ? inp.value.trim().toLowerCase() : '';
  const clr = document.getElementById('search-clear');
  if (clr) clr.style.display = ledgerSearch ? 'block' : 'none';
  renderTable();
}

function clearSearch() {
  const inp = document.getElementById('ledger-search');
  if (inp) inp.value = '';
  ledgerSearch = '';
  const clr = document.getElementById('search-clear');
  if (clr) clr.style.display = 'none';
  renderTable();
}

function filteredTrades() {
  let list = [...trades];
  // Pill filter
  if (ledgerFilter==='open')    list=list.filter(t=>t.status==='Open');
  if (ledgerFilter==='closed')  list=list.filter(t=>t.status==='Closed');
  if (ledgerFilter==='profit')  list=list.filter(t=>{const c=fullCalcs(t);return c.pnlV!==null&&c.pnlV>=0;});
  if (ledgerFilter==='loss')    list=list.filter(t=>{const c=fullCalcs(t);return c.pnlV!==null&&c.pnlV<0;});
  if (ledgerFilter==='real')    list=list.filter(t=>t.type==='Real');
  if (ledgerFilter==='virtual') list=list.filter(t=>t.type==='Virtual');
  // Search
  if (ledgerSearch) {
    list = list.filter(t => {
      return [t.stock, t.setup, t.exitR, t.mktState, t.notes, t.grade, t.type, t.status]
        .some(v => v && String(v).toLowerCase().includes(ledgerSearch));
    });
  }
  return list;
}

/* ─── Column visibility panel ─── */
function toggleColFilter() {
  const panel = document.getElementById('col-filter-panel');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  if (open) { panel.style.display='none'; return; }
  // Build checkboxes for each column
  panel.innerHTML = TABLE_COLS
    .filter(c=>!c.always) // always-on cols can't be hidden
    .map(c => {
      const on = !hiddenCols.has(c.lbl);
      return `<label class="col-check">
        <input type="checkbox" ${on?'checked':''} onchange="toggleCol('${c.lbl}',this.checked)">
        ${c.lbl}
      </label>`;
    }).join('');
  panel.style.display = 'flex';
}

function toggleCol(lbl, show) {
  if (show) hiddenCols.delete(lbl);
  else hiddenCols.add(lbl);
  renderTableHead();
  renderTable();
}

/* ─── Pill filter bar in Ledger ─── */
document.querySelectorAll('.fp[data-f]').forEach(el=>{
  el.addEventListener('click', () => {
    if (el.dataset.f === 'select') {
      if (selectMode) exitSelectMode();
      else enterSelectMode();
      return;
    }
    if (selectMode) exitSelectMode();
    document.querySelectorAll('.fp').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    ledgerFilter = el.dataset.f;
    renderTable();
  });
});

/* ═══════════════════════════════════════════════
   NAV
═══════════════════════════════════════════════ */
document.querySelectorAll('.nav-item[data-view]').forEach(el=>{
  el.addEventListener('click',()=>switchView(el.dataset.view));
});

/* ═══════════════════════════════════════════════
   SERVICE WORKER (PWA offline)
═══════════════════════════════════════════════ */
function registerSW() {
  if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}

/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════
   CALENDAR HEATMAP
═══════════════════════════════════════════════ */
function renderCalendarHeatmap() {
  const el = document.getElementById('an-calendar');
  if (!el) return;
  if (!trades.length) { el.innerHTML = '<div class="an-empty">No trades to show</div>'; return; }

  // Build date map: date → {pnl, count, wins, losses, open}
  const dateMap = {};
  const mark = (date, pnl, isOpen) => {
    if (!date) return;
    if (!dateMap[date]) dateMap[date] = {pnl:0, count:0, wins:0, losses:0, open:0};
    const d = dateMap[date];
    d.count++;
    if (isOpen) { d.open++; }
    else { d.pnl += pnl; if(pnl>=0) d.wins++; else d.losses++; }
  };
  trades.forEach(t => {
    const c = fullCalcs(t);
    if (t.status === 'Open') {
      mark(t.buyDate, 0, true);
    } else {
      mark(t.buyDate, 0, true);
      if (t.sellDate && c.pnlV !== null) mark(t.sellDate, c.pnlV, false);
    }
  });

  const allDates = Object.keys(dateMap).sort();
  if (!allDates.length) { el.innerHTML = '<div class="an-empty">No dates found</div>'; return; }

  // Show last 6 months of weeks
  const today = new Date();
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  // Align to Sunday start of that week
  const startDate = new Date(sixMonthsAgo);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const maxAbsPnl = Math.max(...Object.values(dateMap).map(d => Math.abs(d.pnl)), 1);

  const CELL = 13, GAP = 2, STEP = CELL + GAP;
  const weeks = [];
  let cur = new Date(startDate);
  while (cur <= today) {
    const week = [];
    for (let dow = 0; dow < 7; dow++) {
      const iso = cur.toISOString().slice(0,10);
      week.push({ iso, data: dateMap[iso] || null, future: cur > today });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  const W = weeks.length * STEP + 30; // extra left for day labels
  const H = 7 * STEP + 24; // +24 for month labels
  const LEFT = 22;

  let cells = '';
  let monthLabels = '';
  let lastMonth = -1;

  weeks.forEach((week, wi) => {
    const x = LEFT + wi * STEP;
    // Month label at start of new month
    const firstNonFuture = week.find(d => !d.future);
    if (firstNonFuture) {
      const m = new Date(firstNonFuture.iso).getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        monthLabels += `<text x="${x}" y="10" font-size="8" fill="var(--text3)" font-family="Rajdhani,sans-serif">${mNames[m]}</text>`;
      }
    }
    week.forEach((day, dow) => {
      const y = 18 + dow * STEP;
      if (day.future) {
        cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="transparent"/>`;
        return;
      }
      let fill = 'var(--bg3)';
      let opacity = 1;
      let title = day.iso;
      if (day.data) {
        const d = day.data;
        title = `${day.iso}: ${d.count} trade${d.count!==1?'s':''}`;
        if (d.pnl !== 0) title += ` | P&L: ${d.pnl>=0?'+':''}${d.pnl.toFixed(0)}`;
        if (d.open > 0 && d.wins===0 && d.losses===0) {
          fill = 'var(--accent)'; opacity = 0.5 + 0.5*(d.count/5);
        } else if (d.pnl > 0) {
          const intensity = Math.min(1, Math.abs(d.pnl) / maxAbsPnl);
          opacity = 0.25 + intensity * 0.75;
          fill = 'var(--profit)';
        } else if (d.pnl < 0) {
          const intensity = Math.min(1, Math.abs(d.pnl) / maxAbsPnl);
          opacity = 0.25 + intensity * 0.75;
          fill = 'var(--loss)';
        } else {
          fill = 'var(--accent)'; opacity = 0.35;
        }
      }
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}" opacity="${opacity.toFixed(2)}" onclick="heatmapClick('${day.iso}')" style="cursor:pointer"><title>${title}</title></rect>`;
    });
  });

  // Day labels Mon/Wed/Fri
  const dayLabels = ['S','M','T','W','T','F','S'];
  let dayLbls = '';
  [1,3,5].forEach(d => {
    dayLbls += `<text x="${LEFT-4}" y="${18 + d*STEP + CELL*0.75}" text-anchor="end" font-size="8" fill="var(--text3)" font-family="Rajdhani,sans-serif">${dayLabels[d]}</text>`;
  });

  el.innerHTML = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${monthLabels}${dayLbls}${cells}
    </svg>
  </div>
  <div class="heatmap-legend">
    <span style="color:var(--text3);font-size:10px">Less</span>
    <svg width="70" height="12"><rect x="0"  y="0" width="12" height="12" rx="2" fill="var(--bg3)"/>
    <rect x="15" y="0" width="12" height="12" rx="2" fill="var(--loss)" opacity=".4"/>
    <rect x="30" y="0" width="12" height="12" rx="2" fill="var(--loss)" opacity=".8"/>
    <rect x="45" y="0" width="12" height="12" rx="2" fill="var(--profit)" opacity=".4"/>
    <rect x="60" y="0" width="12" height="12" rx="2" fill="var(--profit)" opacity=".8"/></svg>
    <span style="color:var(--text3);font-size:10px">More</span>
    <span style="color:var(--accent);font-size:10px;margin-left:8px">■ Entry/Open</span>
  </div>`;
}

function heatmapClick(iso) {
  // Switch to ledger filtered to that date
  const matches = trades.filter(t => t.buyDate===iso || t.sellDate===iso);
  if(!matches.length) return;
  if(matches.length===1){ openDetailMo(matches[0].id); return; }
  // Multiple trades — switch to table with search
  ledgerSearch = iso;
  const inp = document.getElementById('ledger-search');
  if(inp) inp.value = iso;
  switchView('table');
  renderTable();
  toast(`Showing ${matches.length} trades on ${iso}`);
}

(function init() {
  loadTheme();
  loadCfg();
  migrateSettings();   // safely adds new keys, never touches existing user data
  loadTrades();
  initDropdowns();
  initSB();
  applyFeatures();
  renderTableHead();
  renderDash();
  registerSW();
})();

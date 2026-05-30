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
   SUPABASE
═══════════════════════════════════════════════ */
function initSB() {
  const pill = document.getElementById('sync-pill');
  if (cfg.sbUrl && cfg.sbKey && window.supabase) {
    try {
      sbClient = window.supabase.createClient(cfg.sbUrl.trim(), cfg.sbKey.trim());
      if (pill) pill.innerHTML = '<span class="sync-pill">☁ SYNC ON</span>';
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
  // NOTE: do NOT mutate cfg.dropdowns here — getters use ?? fallback to defaults

  // ── Tab bar
  let tabHtml = '<div class="dd-tabs">';
  DD_META.forEach(m => {
    const active = ddActiveKey === m.key ? ' dd-tab-active' : '';
    tabHtml += `<div class="dd-tab${active}" onclick="switchDdTab('${m.key}')">${m.icon} ${m.label}</div>`;
  });
  tabHtml += '</div>';

  // ── Active list
  const meta  = DD_META.find(m => m.key === ddActiveKey);
  const items = meta.getter();

  let listHtml = '<div class="dd-list" id="dd-list">';
  items.forEach((item, i) => {
    listHtml += `
      <div class="dd-item" id="ddi-${i}">
        <div class="dd-drag">⠿</div>
        <div class="dd-item-text">${escHtml(item)}</div>
        <div class="dd-item-actions">
          <button class="dd-btn dd-edit-btn" onclick="startEditDdItem(${i})" title="Edit">✏️</button>
          <button class="dd-btn dd-del-btn"  onclick="deleteDdItem(${i})"    title="Remove">✕</button>
        </div>
      </div>`;
  });
  listHtml += '</div>';

  // ── Add new input
  const addHtml = `
    <div class="dd-add-row">
      <input id="dd-new-input" class="f-ctrl" type="text"
             placeholder="Type new option and press Add…"
             onkeydown="if(event.key==='Enter') addDdItem()">
      <button class="btn btn-primary dd-add-btn" onclick="addDdItem()">Add</button>
    </div>`;

  // ── Footer buttons
  const footHtml = `
    <div class="dd-footer">
      <button class="feat-reset-btn" onclick="resetDdList('${ddActiveKey}')">↺ Reset to defaults</button>
    </div>`;

  wrap.innerHTML = tabHtml + listHtml + addHtml + footHtml;
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

  const oDiv=document.getElementById('dash-open');
  if(open.length){oDiv.innerHTML=`<div class="section-hd">OPEN POSITIONS (${open.length})</div>`+open.slice(0,8).map(tradeCardHTML).join('');}
  else{oDiv.innerHTML='';}

  const rDiv=document.getElementById('dash-recent');
  if(closed.length){rDiv.innerHTML=`<div class="section-hd">RECENT CLOSED</div>`+closed.slice(0,5).map(tradeCardHTML).join('');}
  else if(!open.length){rDiv.innerHTML=`<div class="empty"><div class="empty-ico">📊</div><div class="empty-title">No trades yet</div><div class="empty-sub">Tap the + button to log your first trade</div></div>`;}
  else{rDiv.innerHTML='';}
}

/* ═══════════════════════════════════════════════
   TRADE CARD HTML
═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   MONTHLY P&L CHART (pure SVG)
═══════════════════════════════════════════════ */
function renderMonthlyChart(closed) {
  const el = document.getElementById('monthly-chart');
  if (!el) return;
  const byMonth = {};
  closed.forEach(t => {
    const d = t.sellDate||t.buyDate; if(!d) return;
    const key = d.slice(0,7);
    const c = fullCalcs(t); if(c.pnlV===null) return;
    byMonth[key] = (byMonth[key]||0) + c.pnlV;
  });
  const keys = Object.keys(byMonth).sort();
  if(!keys.length){el.innerHTML='<div class="chart-empty">No closed trades to chart yet</div>';return;}
  const vals  = keys.map(k=>byMonth[k]);
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
    if(h>20){const ly=v>=0?y-3:y+h+9;bars+=`<text x="${(x+barW/2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="8" fill="${col}" font-family="IBM Plex Mono,monospace">${fINR(v,true)}</text>`;}
    labels+=`<text x="${(x+barW/2).toFixed(1)}" y="${H-2}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="Rajdhani,sans-serif">${months[+k.slice(5)]||k.slice(5)} ${k.slice(2,4)}</text>`;
  });
  el.innerHTML=`<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><line x1="${pad}" y1="${midY}" x2="${W-pad}" y2="${midY}" stroke="var(--border2)" stroke-width="1"/>${bars}${labels}</svg>`;
}

/* ═══════════════════════════════════════════════
   ANALYTICS VIEW
═══════════════════════════════════════════════ */
function renderAnalytics() {
  const closed = trades.filter(t=>t.status==='Closed');

  // Setup win rate
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
      setupEl.innerHTML=rows.map(([s,d])=>{
        const wr=d.total?Math.round(d.wins/d.total*100):0;
        const col=wr>=60?'var(--profit)':wr>=40?'var(--warn)':'var(--loss)';
        return `<div class="an-row"><div class="an-row-top"><span class="an-label">${escHtml(s)}</span><span class="an-meta">${d.wins}W/${d.total-d.wins}L &nbsp;·&nbsp;<span class="${pCls(d.pnl)}">${fINR(d.pnl,true)}</span></span></div><div class="an-bar-bg"><div class="an-bar" style="width:${wr}%;background:${col}"></div><span class="an-bar-lbl">${wr}%</span></div></div>`;
      }).join('');
    }
  }

  // Duration buckets
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
      durEl.innerHTML=active.map(b=>{
        const wr=b.trades.length?Math.round(b.wins/b.trades.length*100):0;
        const avgPnl=b.trades.length?b.pnl/b.trades.length:0;
        const col=wr>=60?'var(--profit)':wr>=40?'var(--warn)':'var(--loss)';
        return `<div class="an-row"><div class="an-row-top"><span class="an-label">${b.label}</span><span class="an-meta">${b.trades.length} trades &nbsp;·&nbsp; Avg <span class="${pCls(avgPnl)}">${fINR(avgPnl,true)}</span></span></div><div class="an-bar-bg"><div class="an-bar" style="width:${wr}%;background:${col}"></div><span class="an-bar-lbl">${wr}% win</span></div></div>`;
      }).join('');
    }
  }

  // Grade breakdown
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
    const active=Object.entries(gm).filter(([,d])=>d.count>0);
    if(!active.length){gradeEl.innerHTML='<div class="an-empty">Grade trades using A/B/C/D when logging</div>';}
    else{
      gradeEl.innerHTML=`<div class="grade-grid">${active.map(([g,d])=>{
        const wr=d.count?Math.round(d.wins/d.count*100):0;
        const avgPnl=d.count?d.pnl/d.count:0;
        const gcls=g==='?'?'grade-none':'grade-'+g.toLowerCase();
        return `<div class="grade-card"><div class="grade-badge-big ${gcls}">${g}</div><div class="grade-card-label">${glabels[g]}</div><div class="grade-card-stat" style="color:var(--text)">${d.count} trades</div><div class="grade-card-stat" style="color:${wr>=60?'var(--profit)':wr>=40?'var(--warn)':'var(--loss)'};">${wr}% win</div><div class="grade-card-stat ${pCls(avgPnl)}">${fINR(avgPnl,true)} avg</div></div>`;
      }).join('')}</div>`;
    }
  }
}

/* ═══════════════════════════════════════════════
   PDF EXPORT
═══════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════
   LIVE PRICE FETCH — multi-proxy with debug log
═══════════════════════════════════════════════ */

// Multiple CORS proxies tried in order — first success wins
const CORS_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
];

// Debug log — visible in Settings
const lpLog = [];
function lpDebug(msg, type='info') {
  const entry = { ts: new Date().toLocaleTimeString('en-IN'), msg, type };
  lpLog.unshift(entry);
  if (lpLog.length > 60) lpLog.pop();
  // Live-update if debug panel is open
  const panel = document.getElementById('lp-debug-log');
  if (panel) renderDebugLog();
}

function renderDebugLog() {
  const panel = document.getElementById('lp-debug-log');
  if (!panel) return;
  if (!lpLog.length) { panel.innerHTML = '<div class="dbg-empty">No activity yet — tap Fetch Now</div>'; return; }
  panel.innerHTML = lpLog.map(e => {
    const col = e.type==='ok' ? 'var(--profit)' : e.type==='err' ? 'var(--loss)' : e.type==='warn' ? 'var(--warn)' : 'var(--text2)';
    return `<div class="dbg-row"><span class="dbg-ts">${e.ts}</span><span class="dbg-msg" style="color:${col}">${escHtml(e.msg)}</span></div>`;
  }).join('');
}

// Timeout helper that works on all Android WebViews (AbortSignal.timeout not always available)
function fetchWithTimeout(url, ms=10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function fetchSymbolPrice(sym) {
  const yahooSym = sym.replace(/\.(NS|BO|NSE|BSE)$/i, '') + '.NS';
  const targetURL = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=2d&events=&corsDomain=finance.yahoo.com`;

  for (let pi = 0; pi < CORS_PROXIES.length; pi++) {
    const proxyURL = CORS_PROXIES[pi](targetURL);
    lpDebug(`[${sym}] Proxy ${pi+1}: ${proxyURL.slice(0,60)}…`);
    try {
      const res = await fetchWithTimeout(proxyURL, 9000);
      lpDebug(`[${sym}] Proxy ${pi+1} → HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      lpDebug(`[${sym}] Response length: ${text.length} chars`);

      let data;
      try { data = JSON.parse(text); }
      catch(pe) { throw new Error(`JSON parse failed: ${text.slice(0,80)}`); }

      const result = data?.chart?.result?.[0];
      if (!result) {
        const errMsg = data?.chart?.error?.description || 'No result in chart data';
        throw new Error(errMsg);
      }

      const meta  = result.meta;
      const price = meta.regularMarketPrice ?? meta.previousClose;
      const prev  = meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? meta.previousClose;

      if (!price) throw new Error('price is null/undefined in meta');

      const chg = prev ? ((price - prev) / prev * 100) : 0;
      const out = { price: (+price).toFixed(2), chg: +chg.toFixed(2), ts: Date.now(), proxy: pi+1 };
      lpDebug(`[${sym}] ✓ ₹${out.price} (${out.chg>=0?'+':''}${out.chg}%) via Proxy ${pi+1}`, 'ok');
      return out;

    } catch(e) {
      lpDebug(`[${sym}] Proxy ${pi+1} failed: ${e.message}`, pi === CORS_PROXIES.length-1 ? 'err' : 'warn');
      if (pi < CORS_PROXIES.length - 1) {
        await new Promise(r => setTimeout(r, 400)); // small delay before next proxy
      }
    }
  }
  return null; // all proxies failed
}

async function fetchOpenPrices(manual=false) {
  if (!featOn('livePrice') && !manual) return;
  const openTrades = trades.filter(t => t.status === 'Open' && t.stock);
  if (!openTrades.length) {
    lpDebug('No open trades to fetch prices for', 'warn');
    renderDebugLog();
    return;
  }
  if (lpFetching) { lpDebug('Fetch already in progress…', 'warn'); return; }
  lpFetching = true;
  lpDebug(`━━ Starting fetch for ${openTrades.length} open trade(s) ━━`);

  // Update status badge in debug panel
  const badge = document.getElementById('lp-status-badge');
  if (badge) { badge.textContent = '⏳ Fetching…'; badge.className = 'lp-badge lp-badge-ing'; }

  const symbols = [...new Set(openTrades.map(t => t.stock.replace(/\.(NS|BO|NSE|BSE)$/i, '').toUpperCase()))];
  lpDebug(`Symbols: ${symbols.join(', ')}`);

  let ok=0, fail=0;
  for (const sym of symbols) {
    const result = await fetchSymbolPrice(sym);
    if (result) { livePrices[sym] = result; ok++; }
    else         { livePrices[sym] = { error: true, ts: Date.now() }; fail++; }
  }

  lpFetching = false;
  lpDebug(`━━ Done — ${ok} ok, ${fail} failed ━━`, fail===0?'ok':ok===0?'err':'warn');

  if (badge) {
    badge.textContent = fail===0 ? `✓ ${ok} updated` : ok===0 ? `✗ All failed` : `⚠ ${ok} ok / ${fail} failed`;
    badge.className   = `lp-badge ${fail===0?'lp-badge-ok':ok===0?'lp-badge-err':'lp-badge-warn'}`;
  }
  const lastEl = document.getElementById('lp-last-time');
  if (lastEl) lastEl.textContent = `Last fetch: ${new Date().toLocaleTimeString('en-IN')}`;

  renderDebugLog();
  if (curView === 'table') renderTable();
  renderDash();
}

// Auto-refresh every 5 min when on ledger
setInterval(() => { if (curView==='table' || curView==='dashboard') fetchOpenPrices(); }, 5*60*1000);

async function testSingleSymbol() {
  const inp = document.getElementById('lp-test-sym');
  const sym = (inp?.value||'').trim().toUpperCase();
  if (!sym) { toast('⚠ Enter a symbol first'); return; }
  lpDebug(`━━ Manual test: ${sym} ━━`);
  renderDebugLog();
  const badge = document.getElementById('lp-status-badge');
  if (badge) { badge.textContent='⏳ Testing…'; badge.className='lp-badge lp-badge-ing'; }
  const result = await fetchSymbolPrice(sym);
  if (result) {
    livePrices[sym] = result;
    if (badge) { badge.textContent=`✓ ₹${result.price}`; badge.className='lp-badge lp-badge-ok'; }
  } else {
    if (badge) { badge.textContent='✗ Failed'; badge.className='lp-badge lp-badge-err'; }
  }
  renderDebugLog();
  if (curView==='table') renderTable();
}

/* ═══════════════════════════════════════════════
   PDF EXPORT
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
  const list    = filteredTrades();
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
        case 'Stock':     return `<td class="td-stock" style="text-align:left;position:sticky;left:38px;background:var(--bg2);z-index:1">${t.stock}<a href="${tvURL(t.stock)}" target="_blank" rel="noopener" class="tv-tbl-link" onclick="event.stopPropagation()">↗</a></td>`;
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
        case 'P&L ₹':return `<td class="${pCls(c.pnlV)}">${c.pnlV!==null?fINR(c.pnlV,true):'—'}</td>`;
        case 'P&L %':     return `<td class="${pCls(c.pnlP)}">${c.pnlP!==null?sgn(c.pnlP)+f2(c.pnlP)+'%':'—'}</td>`;
        case 'Port P&L%': return `<td class="${pCls(c.portPnl)}">${c.portPnl!==null?sgn(c.portPnl)+f2(c.portPnl)+'%':'—'}</td>`;
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
  if(!thead) return;
  const cols = visibleCols();
  const stickyLeft = ['#','Stock'];
  let th = cols.map((c,i)=>{
    const isSticky = stickyLeft.includes(c.lbl);
    const style = isSticky
      ? `style="text-align:left;position:sticky;left:${i===0?'0':'38px'};z-index:3;background:var(--bg)"`
      : '';
    return `<th ${style}>${c.lbl}</th>`;
  }).join('');
  thead.innerHTML = `<tr>${th}</tr>`;
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
    trades = trades.filter(t => !selectedIds.has(t.id));
    const n = selectedIds.size;
    saveTrades();
    exitSelectMode();
    closeConfirm();
    renderAll();
    toast(`🗑 Deleted ${n} trade${n===1?'':'s'}`);
    window._bulkDeletePending = false;
    return;
  }
  // Single delete (from edit modal)
  if (!editId) return;
  trades = trades.filter(t => t.id !== editId);
  saveTrades();
  closeConfirm();
  closeTradeMo();
  closeDetailMo();
  renderAll();
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

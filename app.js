'use strict';

/* ═══════════════════════════════════════════════
   CONSTANTS — DROPDOWNS
═══════════════════════════════════════════════ */
const SETUPS = [
  'VCP – Volatility Contraction','Flag & Pole','EMA Pullback (20 EMA)',
  'EMA Pullback (50 EMA)','Cup & Handle','Double Bottom','Double Top',
  'Head & Shoulders','Breakout – Prior High','Breakout – 52W High',
  'Inside Bar / NR7','Momentum / Relative Strength','Gap Up Play',
  'News / Event Based','Trend Reversal','MA Crossover',
  'Support Bounce','Resistance Break','Consolidation Breakout','Other'
];
const EXITS = [
  'SL Hit','Target Hit','Manual Exit – Planned',
  'Manual Exit – Discretionary','Trailing SL','Partial + Trailing SL',
  'Time-based Exit','News Exit','Other'
];
const MKT_STATES = [
  'Confirmed Uptrend – Strong','Confirmed Uptrend – Moderate',
  'Uptrend Under Pressure','Rally Attempt – Unconfirmed',
  'Market in Correction – Mild','Market in Correction – Severe',
  'Sideways / Rangebound','High Volatility – Choppy',
  'Distribution Phase','Strong Downtrend'
];

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
let trades    = [];
let cfg       = { portVal: 0, sbUrl: '', sbKey: '' };
let curView   = 'dashboard';
let curFilter = 'all';
let editId    = null;
let detId     = null;
let formSt    = 'Open';
let formTp    = 'Real';
let sbClient  = null;

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
  const pv = t.portVal || cfg.portVal || 0;
  const q  = calcQty(t.alloc, t.buyPx);
  const sl = slPct(t.buyPx, t.sl);
  const ap = allocPct(t.alloc, pv);
  const closed = t.status === 'Closed' && t.sellPx;
  const pv2 = closed ? calcPnlV(t.buyPx, t.sellPx, q) : null;
  const pp  = closed ? calcPnlP(t.buyPx, t.sellPx)    : null;
  const ppp = portPnlP(pv2, pv);
  const rr  = closed ? calcRR(t.buyPx, t.sellPx, t.sl) : null;
  const days= daysHeld(t.buyDate, closed ? t.sellDate : null);
  return { q, sl, ap, pnlV:pv2, pnlP:pp, portPnl:ppp, rr, days };
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
   STORAGE
═══════════════════════════════════════════════ */
const LS_T='tl_trades', LS_C='tl_cfg';
function saveTrades() { localStorage.setItem(LS_T, JSON.stringify(trades)); }
function loadTrades() { trades = JSON.parse(localStorage.getItem(LS_T)||'[]'); }
function persistSettings() {
  cfg.portVal = parseFloat(document.getElementById('s-port').value)||0;
  // SB creds are saved explicitly via saveAndTestSB()
  localStorage.setItem(LS_C, JSON.stringify(cfg));
}
function loadCfg() {
  const r = localStorage.getItem(LS_C);
  if (r) cfg = {...cfg,...JSON.parse(r)};
}

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
  localStorage.setItem(LS_C, JSON.stringify(cfg));

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
  document.getElementById('v-'+v).classList.add('active');
  document.querySelector(`.nav-item[data-view="${v}"]`)?.classList.add('active');
  if (v==='dashboard') renderDash();
  if (v==='trades')    renderTrades();
  if (v==='table')     renderTable();
}

/* ═══════════════════════════════════════════════
   DROPDOWN INIT
═══════════════════════════════════════════════ */
function initDropdowns() {
  const fill = (id, arr) => {
    const sel = document.getElementById(id);
    arr.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v; sel.appendChild(o);
    });
  };
  fill('f-setup', SETUPS);
  fill('f-exit',  EXITS);
  fill('f-mkt',   MKT_STATES);
}

/* ═══════════════════════════════════════════════
   FORM AUTO-CALC
═══════════════════════════════════════════════ */
function calc() {
  const bp  = num(document.getElementById('f-buypx').value);
  const sl  = num(document.getElementById('f-sl').value);
  const al  = num(document.getElementById('f-alloc-input').value);
  const pv  = num(document.getElementById('f-port').value) || cfg.portVal;
  const sp  = num(document.getElementById('f-sellpx').value);
  const bd  = document.getElementById('f-buydate').value;
  const sd  = document.getElementById('f-selldate').value;

  // SL %
  const slP = slPct(bp, sl);
  setAuto('f-slpct', slP!==null ? f2(slP)+'%' : '—');

  // Alloc %
  const alP = allocPct(al, pv);
  setAuto('f-allocpct', alP!==null ? f2(alP)+'%' : '—');

  // Qty
  const q = calcQty(al, bp);
  setAuto('f-qty', q!==null ? q.toString() : '—');

  // Days (live count if open)
  const days = daysHeld(bd, formSt==='Closed'&&sd ? sd : null);
  setAuto('f-days', days!==null ? days+'d' : '—');

  // P&L results (only if closed + sell price)
  if (formSt==='Closed' && sp && bp) {
    const pv2 = calcPnlV(bp, sp, q);
    const pp  = calcPnlP(bp, sp);
    const ppp = portPnlP(pv2, pv);
    const rr  = calcRR(bp, sp, sl);
    setAutoCol('f-pnlv',   pv2!==null ? fINR(pv2)              : '—', pv2);
    setAutoCol('f-pnlp',   pp!==null  ? sgn(pp)+f2(pp)+'%'     : '—', pp);
    setAutoCol('f-portpnl',ppp!==null ? sgn(ppp)+f2(ppp)+'%'   : '—', ppp);
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
   'f-selldate','f-sellpx','f-sl','f-alloc-input','f-port','f-notes'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  ['f-setup','f-exit','f-mkt'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.selectedIndex=0;
  });
  ['f-slpct','f-allocpct','f-qty','f-pnlv','f-pnlp','f-portpnl','f-rr','f-days'].forEach(id=>{
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
  set('f-alloc-input', t.alloc);
  set('f-port',    t.portVal||cfg.portVal||'');
  set('f-setup',   t.setup);
  set('f-exit',    t.exitR);
  set('f-mkt',     t.mktState);
  set('f-notes',   t.notes);
  setStatus(t.status||'Open');
  setType(t.type||'Real');
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
    alloc:    num(document.getElementById('f-alloc-input').value),
    portVal:  num(document.getElementById('f-port').value)||cfg.portVal||0,
    setup:    document.getElementById('f-setup').value,
    exitR:    document.getElementById('f-exit').value,
    mktState: document.getElementById('f-mkt').value,
    notes:    document.getElementById('f-notes').value.trim(),
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
function confirmDelete() { document.getElementById('confirm-ov').classList.add('open'); }
function closeConfirm()  { document.getElementById('confirm-ov').classList.remove('open'); }
function doDelete() {
  if(!editId) return;
  trades = trades.filter(t=>t.id!==editId);
  saveTrades(); closeConfirm(); closeTradeMo(); closeDetailMo(); renderAll();
  toast('Trade deleted');
}

/* ═══════════════════════════════════════════════
   DETAIL MODAL
═══════════════════════════════════════════════ */
function openDetailMo(id) {
  detId=id;
  const t=trades.find(x=>x.id===id); if(!t) return;
  const c=fullCalcs(t);

  // Title with badges
  document.getElementById('det-title').innerHTML =
    `${t.stock}&nbsp;<span class="badge b-${t.status.toLowerCase()}">${t.status}</span>&nbsp;<span class="badge b-${t.type.toLowerCase()}">${t.type}</span>`;

  const row=(lbl,val)=>`<div class="dc"><div class="dc-lbl">${lbl}</div><div class="dc-val">${val}</div></div>`;
  const pRow=(lbl,val,n2)=>row(lbl,`<span class="${pCls(n2)}">${val}</span>`);

  let html='<div class="detail-grid">';
  html+=row('Buy Date',     fDate(t.buyDate));
  html+=row('Buy Price',    t.buyPx ? '₹'+t.buyPx : '—');
  html+=row('EMA Prev Day', t.emPrev ? '₹'+t.emPrev : '—');
  html+=row('EMA Entry Day',t.emDay  ? '₹'+t.emDay  : '—');
  html+=row('Sell Date',    fDate(t.sellDate));
  html+=row('Sell Price',   t.sellPx ? '₹'+t.sellPx : '—');
  html+=row('SL Price',     t.sl     ? '₹'+t.sl     : '—');
  html+=pRow('SL %',        c.sl!==null ? f2(c.sl)+'%' : '—', c.sl!==null?-c.sl:null);
  html+=row('Allocation',   t.alloc  ? fINR(t.alloc) : '—');
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
  document.getElementById('mo-settings').classList.add('open');
}
function closeSettings() {
  document.getElementById('mo-settings').classList.remove('open');
  renderAll();
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
  if(curView==='dashboard') renderDash();
  if(curView==='trades')    renderTrades();
  if(curView==='table')     renderTable();
  // always keep dashboard stats fresh
  if(curView!=='dashboard') renderDash();
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

  // Realized P&L
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

  // Win rate
  const wr=closed.length ? wins.length/closed.length*100 : null;
  document.getElementById('s-winrate').textContent = wr!==null ? Math.round(wr)+'%' : '—';

  // Avg R:R (positive trades only for meaningful avg)
  const rrs=closed.map(t=>fullCalcs(t).rr).filter(x=>x!==null);
  const avgRR=rrs.length ? rrs.reduce((a,b)=>a+b,0)/rrs.length : null;
  document.getElementById('s-rr').textContent = avgRR!==null ? f2(avgRR)+'x' : '—';

  // Avg days held
  const dys=closed.map(t=>fullCalcs(t).days).filter(x=>x!==null&&x>=0);
  const avgD=dys.length ? Math.round(dys.reduce((a,b)=>a+b,0)/dys.length) : null;
  document.getElementById('s-days').textContent = avgD!==null ? avgD+'d' : '—';

  // Best / Worst
  const ranked=closed
    .map(t=>({t,c:fullCalcs(t)}))
    .filter(x=>x.c.pnlP!==null)
    .sort((a,b)=>b.c.pnlP-a.c.pnlP);

  if(ranked.length) {
    const b=ranked[0], w=ranked[ranked.length-1];
    document.getElementById('bw-best-stock').textContent = b.t.stock;
    document.getElementById('bw-best-pct').textContent   = '+'+f2(b.c.pnlP)+'%';
    document.getElementById('bw-worst-stock').textContent= w.t.stock;
    document.getElementById('bw-worst-pct').textContent  = f2(w.c.pnlP)+'%';
  } else {
    ['bw-best-stock','bw-best-pct','bw-worst-stock','bw-worst-pct']
      .forEach(id=>{ document.getElementById(id).textContent='—'; });
  }

  // Open positions section
  const oDiv=document.getElementById('dash-open');
  if(open.length) {
    oDiv.innerHTML=`<div class="section-hd">OPEN POSITIONS (${open.length})</div>`
      +open.slice(0,8).map(tradeCardHTML).join('');
  } else { oDiv.innerHTML=''; }

  // Recent closed
  const rDiv=document.getElementById('dash-recent');
  if(closed.length) {
    rDiv.innerHTML=`<div class="section-hd">RECENT CLOSED</div>`
      +closed.slice(0,5).map(tradeCardHTML).join('');
  } else if(!open.length) {
    rDiv.innerHTML=`<div class="empty">
      <div class="empty-ico">📊</div>
      <div class="empty-title">No trades yet</div>
      <div class="empty-sub">Tap the + button to log your first trade</div>
    </div>`;
  } else { rDiv.innerHTML=''; }
}

/* ═══════════════════════════════════════════════
   TRADE CARD HTML
═══════════════════════════════════════════════ */
function tradeCardHTML(t) {
  const c=fullCalcs(t);
  let cls='trade-card';
  if(t.status==='Open')               cls+=' tc-open';
  else if(c.pnlV!==null&&c.pnlV>=0)  cls+=' tc-profit';
  else if(c.pnlV!==null&&c.pnlV<0)   cls+=' tc-loss';

  const pnlStr = t.status==='Open'
    ? `<span style="color:var(--open-c);font-size:12px;font-family:var(--ff-m)">OPEN · ${c.days!==null?c.days+'d':''}</span>`
    : (c.pnlV!==null
        ? `<span class="${pCls(c.pnlV)}" style="font-family:var(--ff-m);font-size:14px">${fINR(c.pnlV,true)} &nbsp;${sgn(c.pnlP)}${f2(c.pnlP)}%</span>`
        : '—');

  return `<div class="${cls}" onclick="openDetailMo('${t.id}')">
    <div class="tc-top">
      <div class="tc-stock">${t.stock}</div>
      <div class="tc-badges">
        <span class="badge b-${t.status.toLowerCase()}">${t.status}</span>
        <span class="badge b-${t.type.toLowerCase()}">${t.type==='Virtual'?'VIRT':'REAL'}</span>
      </div>
    </div>
    <div class="tc-metrics">
      <div class="tc-m"><span class="ml">Buy</span><span class="mv">₹${t.buyPx||'—'}</span></div>
      <div class="tc-m"><span class="ml">SL</span><span class="mv">${t.sl?'₹'+t.sl:'—'}</span></div>
      <div class="tc-m"><span class="ml">SL%</span><span class="mv val-l">${c.sl!==null?f2(c.sl)+'%':'—'}</span></div>
      <div class="tc-m"><span class="ml">Alloc</span><span class="mv">${t.alloc?fINR(t.alloc,true):'—'}</span></div>
      <div class="tc-m"><span class="ml">Qty</span><span class="mv">${c.q!==null?c.q:'—'}</span></div>
      <div class="tc-m"><span class="ml">${t.status==='Open'?'Days':'R:R'}</span><span class="mv ${pCls(c.rr)}">${t.status==='Open'?(c.days!==null?c.days+'d':'—'):(c.rr!==null?f2(c.rr)+'x':'—')}</span></div>
    </div>
    <div class="tc-bottom">
      <span class="tc-setup">${t.setup||t.mktState||'—'}</span>
      <span class="tc-pnl">${pnlStr}</span>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════
   RENDER — TRADES LIST
═══════════════════════════════════════════════ */
function renderTrades() {
  const f=curFilter;
  let list=[...trades];
  if(f==='open')    list=list.filter(t=>t.status==='Open');
  if(f==='closed')  list=list.filter(t=>t.status==='Closed');
  if(f==='profit')  list=list.filter(t=>{const c=fullCalcs(t);return c.pnlV!==null&&c.pnlV>=0;});
  if(f==='loss')    list=list.filter(t=>{const c=fullCalcs(t);return c.pnlV!==null&&c.pnlV<0;});
  if(f==='real')    list=list.filter(t=>t.type==='Real');
  if(f==='virtual') list=list.filter(t=>t.type==='Virtual');

  const el=document.getElementById('trades-list');
  if(!list.length) {
    el.innerHTML=`<div class="empty">
      <div class="empty-ico">🔍</div>
      <div class="empty-title">No trades found</div>
      <div class="empty-sub">Try a different filter or add a trade</div>
    </div>`;
    return;
  }
  el.innerHTML=list.map(tradeCardHTML).join('');
}

/* ═══════════════════════════════════════════════
   RENDER — TABLE
═══════════════════════════════════════════════ */
function renderTable() {
  renderTableHead();
  const tbody=document.getElementById('tbl-body');
  if(!trades.length) {
    const colspan = visibleCols().length;
    tbody.innerHTML=`<tr><td colspan="${colspan}" style="text-align:center;color:var(--text3);padding:30px">No trades yet</td></tr>`;
    return;
  }
  const cols = visibleCols();
  tbody.innerHTML=trades.map((t,i)=>{
    const c=fullCalcs(t);
    const get = (lbl) => {
      switch(lbl) {
        case '#':          return `<td class="td-num" style="text-align:left;position:sticky;left:0;background:var(--bg2);z-index:1">${i+1}</td>`;
        case 'Stock':      return `<td class="td-stock" style="text-align:left;position:sticky;left:38px;background:var(--bg2);z-index:1">${t.stock}</td>`;
        case 'Status':     return `<td><span class="badge b-${t.status.toLowerCase()}">${t.status}</span></td>`;
        case 'Type':       return `<td><span class="badge b-${t.type.toLowerCase()}">${t.type==='Virtual'?'VIRT':'REAL'}</span></td>`;
        case 'Buy Date':   return `<td>${fDate(t.buyDate)}</td>`;
        case 'Buy ₹':      return `<td>${t.buyPx?'₹'+t.buyPx:'—'}</td>`;
        case 'EMA Prev':   return `<td>${t.emPrev?'₹'+t.emPrev:'—'}</td>`;
        case 'EMA Day':    return `<td>${t.emDay?'₹'+t.emDay:'—'}</td>`;
        case 'Sell Date':  return `<td>${fDate(t.sellDate)}</td>`;
        case 'Sell ₹':     return `<td>${t.sellPx?'₹'+t.sellPx:'—'}</td>`;
        case 'SL ₹':       return `<td>${t.sl?'₹'+t.sl:'—'}</td>`;
        case 'SL %':       return `<td class="${pCls(c.sl!==null?-c.sl:null)}">${c.sl!==null?f2(c.sl)+'%':'—'}</td>`;
        case 'Alloc ₹':    return `<td>${t.alloc?fINR(t.alloc,true):'—'}</td>`;
        case 'Alloc %':    return `<td>${c.ap!==null?f2(c.ap)+'%':'—'}</td>`;
        case 'Qty':        return `<td>${c.q!==null?c.q:'—'}</td>`;
        case 'P&L ₹':      return `<td class="${pCls(c.pnlV)}">${c.pnlV!==null?fINR(c.pnlV,true):'—'}</td>`;
        case 'P&L %':      return `<td class="${pCls(c.pnlP)}">${c.pnlP!==null?sgn(c.pnlP)+f2(c.pnlP)+'%':'—'}</td>`;
        case 'Port P&L%':  return `<td class="${pCls(c.portPnl)}">${c.portPnl!==null?sgn(c.portPnl)+f2(c.portPnl)+'%':'—'}</td>`;
        case 'R:R':        return `<td class="${pCls(c.rr)}">${c.rr!==null?f2(c.rr)+'x':'—'}</td>`;
        case 'Days':       return `<td>${c.days!==null?c.days+'d':'—'}</td>`;
        case 'Setup':      return `<td>${t.setup||'—'}</td>`;
        case 'Exit':       return `<td>${t.exitR||'—'}</td>`;
        case 'Mkt State':  return `<td>${t.mktState||'—'}</td>`;
        default:           return `<td>—</td>`;
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
  { id:'ema',       label:'EMA Values',              desc:'Record EMA on prev day & entry day',      icon:'📈',  group:'Entry',    def:true  },
  { id:'sl',        label:'Stop Loss (SL)',           desc:'SL price and auto-calculated SL %',       icon:'🛡️',  group:'Risk',     def:true  },
  { id:'alloc',     label:'Allocation / Position',   desc:'Allocation ₹, Alloc %, Quantity auto',    icon:'💰',  group:'Risk',     def:true  },
  { id:'portPnl',   label:'Portfolio P&L %',         desc:'P&L as % of total portfolio value',       icon:'📊',  group:'Results',  def:true  },
  { id:'rr',        label:'Risk:Reward Ratio',       desc:'R:R = Profit booked ÷ SL distance',       icon:'⚖️',  group:'Results',  def:true  },
  { id:'days',      label:'Days Held',               desc:'Number of days trade was held',           icon:'📅',  group:'Results',  def:true  },
  { id:'setup',     label:'Setup / Pattern',         desc:'Chart pattern dropdown (VCP, Flag…)',     icon:'🔭',  group:'Analysis', def:true  },
  { id:'exitR',     label:'Exit Reason',             desc:'Why you closed the trade',                icon:'🚪',  group:'Analysis', def:true  },
  { id:'mktState',  label:'Market State',            desc:'Overall market condition at trade time',  icon:'🌡️',  group:'Analysis', def:true  },
  { id:'notes',     label:'Notes / Journal',         desc:'Free-text observations and lessons',      icon:'📝',  group:'Analysis', def:true  },
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
  { lbl:'Buy Date',   always:true  },
  { lbl:'Buy ₹',      always:true  },
  { lbl:'EMA Prev',   feat:'ema'   },
  { lbl:'EMA Day',    feat:'ema'   },
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
  { lbl:'Setup',      feat:'setup' },
  { lbl:'Exit',       feat:'exitR' },
  { lbl:'Mkt State',  feat:'mktState'},
];

function visibleCols() {
  return TABLE_COLS.filter(c => c.always || featOn(c.feat));
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
   FILTER BAR
═══════════════════════════════════════════════ */
document.querySelectorAll('.fp').forEach(el=>{
  el.addEventListener('click',()=>{
    document.querySelectorAll('.fp').forEach(x=>x.classList.remove('active'));
    el.classList.add('active');
    curFilter=el.dataset.f;
    renderTrades();
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
  if(!cfg.features) cfg.features = defaultFeatures();
  loadTrades();
  initDropdowns();
  initSB();
  applyFeatures();
  renderTableHead();
  renderDash();
  registerSW();
})();

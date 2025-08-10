/* ===== BDRY -> US Shipping Stocks (Multi) | iPhone-ready, no-CORS proxy | Chart.js ===== */

// --- Config ---
const PROXY = 'https://r.jina.ai/http://'; // read-only proxy with CORS enabled
const LAG_MIN = -60, LAG_MAX = 60;
const YEARS_DEFAULT = 3;

// --- DOM helpers ---
const $ = s => document.querySelector(s);
function getStocksInput(){
  return $('#stocks') || $('#stocksInput') || $('#stockSymbol')
    || document.querySelector('input[type="text"], textarea');
}
function getYearsInput(){
  return $('#yearsBack') || $('input[type="number"]') || { value: YEARS_DEFAULT };
}
function getRunBtn(){
  return $('#runBtn') || $('#run') ||
    [...document.querySelectorAll('button')].find(b=>/run/i.test(b.textContent)) || $('button');
}
function getExportBtn(){
  return $('#exportBtn') ||
    [...document.querySelectorAll('button')].find(b=>/export|csv/i.test(b.textContent));
}
function setStatus(msg){
  const el = $('#correlationResult') || $('.status') || $('#status');
  if(el) el.textContent = msg;
}

// --- Utils ---
function parseTickers(raw){
  if(!raw) return [];
  return raw.split(/[\s,]+/).map(s=>s.trim().toUpperCase()).filter(Boolean);
}
function yyyymmdd(d){
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}${mm}${dd}`;
}
function norm100(arr){ if(!arr.length) return arr; const b=arr[0]; return arr.map(v=>v/b*100); }
function pctReturns(series){ const r=[]; for(let i=1;i<series.length;i++) r.push((series[i]-series[i-1])/series[i-1]); return r; }
function pearson(a,b){
  const n=Math.min(a.length,b.length); if(n<5) return NaN;
  let ma=0,mb=0; for(let i=0;i<n;i++){ ma+=a[i]; mb+=b[i]; } ma/=n; mb/=n;
  let num=0,va=0,vb=0; for(let i=0;i<n;i++){ const da=a[i]-ma, db=b[i]-mb; num+=da*db; va+=da*da; vb+=db*db; }
  const den=Math.sqrt(va*vb); return den===0?NaN:num/den;
}
function toMap(arr){ const m=new Map(); for(const x of arr) m.set(x.date.toISOString().slice(0,10), x.close); return m; }
function intersectDates(m1,m2){ const k=[]; for(const key of m1.keys()) if(m2.has(key)) k.push(key); k.sort(); return k; }
function alignTo(refX, x, y){
  const m=new Map(); for(let i=0;i<x.length;i++) m.set(x[i].toISOString(), y[i]);
  return refX.map(d=>m.get(d.toISOString()) ?? null);
}

// --- Data fetch (Stooq via proxy) ---
async function fetchStooqDaily(ticker, d1, d2){
  // Stooq CSV (US listing use .us)
  const raw = `http://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&d1=${d1}&d2=${d2}&i=d`;
  const url = PROXY + raw; // r.jina.ai 需拼「明文 http://」URL，唔好 encode
  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = await res.text();
  if(!txt.startsWith('Date,')) throw new Error(`No data for ${ticker}`);
  const rows = txt.trim().split(/\r?\n/);
  const header = rows.shift().split(',');
  const idxDate = header.indexOf('Date');
  const idxClose = header.indexOf('Close');
  const out = [];
  for(const r of rows){
    const c = r.split(',');
    const dt = new Date(c[idxDate]);
    const close = parseFloat(c[idxClose]);
    if(!isNaN(close)) out.push({date: dt, close});
  }
  out.sort((a,b)=>a.date-b.date);
  return out;
}

// --- Best lag/corr ---
function bestLagCorr(bdrySeries, stockSeries){
  const mA = toMap(bdrySeries), mB = toMap(stockSeries);
  const dates = intersectDates(mA, mB);
  const a = dates.map(k=>mA.get(k));
  const b = dates.map(k=>mB.get(k));
  if(a.length<10 || b.length<10) return { lag:null, corr:NaN, N:0 };

  let bestLag=0, bestCorr=-2;
  for(let lag=LAG_MIN; lag<=LAG_MAX; lag++){
    let a2=[], b2=[];
    for(let i=0;i<dates.length;i++){
      const j=i+lag; if(j<0||j>=dates.length) continue;
      a2.push(a[i]); b2.push(b[j]);
    }
    const ra=pctReturns(a2), rb=pctReturns(b2);
    const c = pearson(ra, rb);
    if(Math.abs(c)>Math.abs(bestCorr)){ bestCorr=c; bestLag=lag; }
  }
  // 計算重疊樣本 N
  let aa=[], bb=[];
  for(let i=0;i<dates.length;i++){
    const j=i+bestLag; if(j<0||j>=dates.length) continue;
    aa.push(a[i]); bb.push(b[j]);
  }
  const N = Math.max(0, Math.min(aa.length-1, bb.length-1));
  return { lag:bestLag, corr:bestCorr, N };
}

// --- Chart & Table ---
let chart;
function renderChart(bdry, seriesDict){
  const ctx = $('#comparisonChart')?.getContext('2d');
  if(!ctx) return;

  const labels = bdry.map(x=>x.date);
  const datasets = [{
    label: 'BDRY（起點=100）',
    data: norm100(bdry.map(x=>x.close)),
    borderColor: '#888', borderWidth: 2, fill:false, tension:0.1, borderDash:[6,6]
  }];

  const palette = ['#1e88e5','#e53935','#43a047','#8e24aa','#fb8c00','#00acc1','#6d4c41','#3949ab','#c2185b','#7cb342'];
  let idx=0;
  for(const [sym, arr] of Object.entries(seriesDict)){
    const x = arr.map(p=>p.date), y = norm100(arr.map(p=>p.close));
    datasets.push({
      label: `${sym}（起點=100）`,
      data: alignTo(labels, x, y),
      borderColor: palette[idx++ % palette.length],
      borderWidth: 2, fill:false, tension:0.1
    });
  }

  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets },
    options:{
      responsive:true,
      plugins:{ legend:{ position:'bottom' } },
      scales:{ y:{ title:{display:true,text:'Normalized (Start=100)'} }, x:{ ticks:{ maxTicksLimit:10 } } }
    }
  });
}

function renderTable(results){
  const tbody = document.querySelector('table tbody') || $('tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  for(const r of results){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.stock}</td>
      <td>${r.lag>0?'+':''}${r.lag}</td>
      <td>${isNaN(r.corr)?'—':r.corr.toFixed(3)}</td>
      <td>${r.N}</td>`;
    tbody.appendChild(tr);
  }
}

function exportCSV(results){
  const header = ['Stock','Best Lag (days)','Max Corr','N (overlap)'];
  const lines = [header.join(',')];
  for(const r of results){ lines.push([r.stock,r.lag,r.corr,r.N].join(',')); }
  const blob = new Blob([lines.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'bdry_lag_results.csv'; a.click();
  URL.revokeObjectURL(url);
}

// --- Main flow ---
async function run(){
  try{
    setStatus('載入中…');

    const stocksRaw = getStocksInput()?.value || '';
    const tickers = parseTickers(stocksRaw);
    if(tickers.length===0){ setStatus('請輸入至少一隻美股代號（空格或逗號分隔）'); return; }

    const years = parseInt(getYearsInput().value || YEARS_DEFAULT, 10);
    const end = new Date();
    const start = new Date(end.getTime() - (365*years+30)*24*3600*1000);
    const d1 = yyyymmdd(start), d2 = yyyymmdd(end);

    // BDRY 作為 BDI 代理
    const bdry = await fetchStooqDaily('BDRY', d1, d2);

    // 拉股票 & 計算
    const seriesDict = {};
    const results = [];
    for(const sym of tickers){
      try{
        const arr = await fetchStooqDaily(sym, d1, d2);
        seriesDict[sym] = arr;
        const r = bestLagCorr(bdry, arr);
        results.push({ stock:sym, lag:r.lag, corr:r.corr, N:r.N });
      }catch(e){
        console.warn(`Skip ${sym}: ${e.message}`);
      }
    }

    if(Object.keys(seriesDict).length===0){ setStatus('Stooq 找不到任何輸入股票的數據。'); return; }

    renderChart(bdry, seriesDict);
    renderTable(results.sort((a,b)=>Math.abs(b.corr)-Math.abs(a.corr)));

    const txt = results.map(r=>`${r.stock}: lag=${r.lag>0?'+':''}${r.lag}, corr=${isNaN(r.corr)?'—':r.corr.toFixed(3)} (N=${r.N})`).join(' | ');
    setStatus(txt || '完成');
  }catch(e){
    console.error(e);
    setStatus(`錯誤：${e.message || e}`);
  }
}

// --- Bind events ---
const runBtn = getRunBtn(); if(runBtn) runBtn.addEventListener('click', run);
const exportBtn = getExportBtn(); if(exportBtn) exportBtn.addEventListener('click', ()=>{
  const tbody = document.querySelector('tbody');
  if(!tbody || !tbody.children.length){ alert('未有結果可匯出。請先 Run。'); return; }
  const rows = [...tbody.children].map(tr=>{
    const tds=[...tr.children].map(td=>td.textContent.trim());
    return { stock: tds[0], lag: tds[1], corr: tds[2], N: tds[3] };
  });
  exportCSV(rows);
});
const stockInput = getStocksInput();
if(stockInput){ stockInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); run(); } }); }

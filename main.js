// ====== BDRY vs Stock (Stooq) - Web (Chart.js) with CORS proxy ======
const YEARS_BACK = 3;              // 改年期就改呢度
const PROXY = 'https://corsproxy.io/?';  // 重要：解決 iOS Safari CORS
let chart;

// 工具
function yyyymmdd(d){
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}${mm}${dd}`;
}

// 從 Stooq 取 CSV（日線收市價），經 proxy
async function fetchStooqDaily(ticker, d1, d2){
  const raw = `https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&d1=${d1}&d2=${d2}&i=d`;
  const url = PROXY + encodeURIComponent(raw);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = await res.text();
  if (!txt.startsWith("Date,")) throw new Error(`No data for ${ticker}`);
  const rows = txt.trim().split(/\r?\n/);
  const header = rows.shift().split(",");
  const idxDate = header.indexOf("Date");
  const idxClose = header.indexOf("Close");
  const out = [];
  for (const r of rows){
    const cols = r.split(",");
    const dt = new Date(cols[idxDate]);
    const close = parseFloat(cols[idxClose]);
    if (!isNaN(close)) out.push({ date: dt, close });
  }
  out.sort((a,b)=>a.date-b.date);
  return out;
}

function toMap(arr){
  const m = new Map();
  for (const x of arr) m.set(x.date.toISOString().slice(0,10), x.close);
  return m;
}
function intersectDates(m1, m2){
  const k = [];
  for (const key of m1.keys()) if (m2.has(key)) k.push(key);
  k.sort();
  return k;
}
function pctReturns(series){
  const r = [];
  for (let i=1;i<series.length;i++) r.push((series[i]-series[i-1])/series[i-1]);
  return r;
}
function pearson(a,b){
  const n = Math.min(a.length, b.length);
  if (n < 5) return NaN;
  let ma=0, mb=0;
  for (let i=0;i<n;i++){ ma+=a[i]; mb+=b[i]; }
  ma/=n; mb/=n;
  let num=0, va=0, vb=0;
  for (let i=0;i<n;i++){
    const da=a[i]-ma, db=b[i]-mb;
    num += da*db; va += da*da; vb += db*db;
  }
  const den = Math.sqrt(va*vb);
  return den===0 ? NaN : num/den;
}
function norm100(arr){
  if (!arr.length) return arr;
  const base = arr[0];
  return arr.map(v=>v/base*100);
}

// 主流程
async function loadData(){
  const input = document.getElementById('stockSymbol');
  const sym = (input.value || 'SBLK').trim().toUpperCase();

  const end = new Date();
  const start = new Date(end.getTime() - (365*YEARS_BACK+30)*24*3600*1000);
  const d1 = yyyymmdd(start), d2 = yyyymmdd(end);

  document.getElementById('correlationResult').textContent = '載入中…';

  try{
    const [bdry, stock] = await Promise.all([
      fetchStooqDaily('BDRY', d1, d2),
      fetchStooqDaily(sym, d1, d2)
    ]);
    if (!bdry.length || !stock.length) throw new Error('資料不足');

    const bdryX = bdry.map(x=>x.date);
    const bdryY = norm100(bdry.map(x=>x.close));
    const stkX  = stock.map(x=>x.date);
    const stkY  = norm100(stock.map(x=>x.close));

    const mA = toMap(bdry), mB = toMap(stock);
    const dates = intersectDates(mA, mB);
    const a = dates.map(k=>mA.get(k));
    const b = dates.map(k=>mB.get(k));
    const ra = pctReturns(a), rb = pctReturns(b);
    const corr = pearson(ra, rb);
    const N = Math.min(ra.length, rb.length);

    const ctx = document.getElementById('comparisonChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: bdryX,
        datasets: [
          {
            label: 'BDRY（起點=100）',
            data: bdryY,
            borderColor: '#888',
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            borderDash: [6,6]
          },
          {
            label: `${sym}（起點=100）`,
            data: alignSeries(bdryX, stkX, stkY),
            borderColor: '#1e88e5',
            borderWidth: 2,
            fill: false,
            tension: 0.1
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: { title: { display: true, text: 'Normalized (Start=100)' } },
          x: { ticks: { maxTicksLimit: 10 } }
        },
        plugins: { legend: { position: 'bottom' } }
      }
    });

    document.getElementById('correlationResult').textContent =
      `相關係數（以重疊日回報計）：${isNaN(corr)? '—' : corr.toFixed(3)}　N=${N}`;

  }catch(e){
    console.error(e);
    document.getElementById('correlationResult').textContent =
      `載入失敗：${e.message || e}`;
  }
}

// 對齊股票序列去 BDRY 時間軸
function alignSeries(refX, x, y){
  const m = new Map();
  for (let i=0;i<x.length;i++) m.set(x[i].toISOString(), y[i]);
  return refX.map(d => m.get(d.toISOString()) ?? null);
}

// 允許 Enter 執行
document.getElementById('stockSymbol').addEventListener('keydown', (e)=>{
  if (e.key === 'Enter') loadData();
});

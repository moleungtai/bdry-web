// ---- Helpers ----
function yyyymmdd(d){
  return d.getFullYear().toString() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}
async function fetchStooqDaily(ticker, d1, d2){
  const url = `https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&d1=${d1}&d2=${d2}&i=d`;
  const res = await fetch(url, {cache:"no-store"});
  const txt = await res.text();
  if(!txt.startsWith("Date,")) throw new Error("No CSV for "+ticker);
  const rows = txt.trim().split(/\r?\n/);
  const head = rows.shift().split(",");
  const idxD = head.indexOf("Date"), idxC = head.indexOf("Close");
  const out = [];
  for(const r of rows){
    const cols = r.split(",");
    const date = new Date(cols[idxD]);
    const close = parseFloat(cols[idxC]);
    if(!isNaN(close)) out.push({date, close});
  }
  out.sort((a,b)=>a.date-b.date);
  return out;
}

function toSeriesMap(arr){ // [{date, close}] -> {dateISO: value}
  const m = new Map();
  for(const x of arr){
    const k = x.date.toISOString().slice(0,10);
    m.set(k, x.close);
  }
  return m;
}

function intersectDates(m1, m2){
  const keys = [];
  for(const k of m1.keys()) if(m2.has(k)) keys.push(k);
  keys.sort();
  return keys;
}

function pctChange(arr){ // daily returns
  const out=[]; for(let i=1;i<arr.length;i++){ out.push((arr[i]-arr[i-1])/arr[i-1]); } return out;
}

function corr(a, b){
  const n = Math.min(a.length,b.length);
  if(n<5) return NaN;
  let ma=0, mb=0;
  for(let i=0;i<n;i++){ ma+=a[i]; mb+=b[i]; }
  ma/=n; mb/=n;
  let num=0, va=0, vb=0;
  for(let i=0;i<n;i++){ const da=a[i]-ma, db=b[i]-mb; num+=da*db; va+=da*da; vb+=db*db; }
  const den = Math.sqrt(va*vb);
  return den===0 ? NaN : (num/den);
}

function bestLag(retA, retB, maxLag=120){ // try -maxLag..maxLag
  let best = {lag:0, corr:-2};
  for(let L=-maxLag; L<=maxLag; L++){
    let X=[], Y=[];
    if(L>=0){
      X = retA.slice(0, retA.length-L);
      Y = retB.slice(L, retB.length);
    }else{
      X = retA.slice(-L, retA.length);
      Y = retB.slice(0, retB.length+L);
    }
    const c = corr(X, Y);
    if(!Number.isNaN(c) && Math.abs(c) > Math.abs(best.corr)){
      best = {lag:L, corr:c, n: Math.min(X.length,Y.length)};
    }
  }
  return best;
}

function normalizeTo100(values){
  if(values.length===0) return values;
  const base = values[0];
  return values.map(v => v/base*100.0);
}

// ---- Main ----
async function run(){
  const years = parseInt(document.getElementById('years').value || '5', 10);
  const stocksSel = Array.from(document.getElementById('stocks').selectedOptions).map(o=>o.value);
  const stocks = stocksSel.length ? stocksSel : ["SBLK","GNK","GOGL","DSX","STNG","FRO"];

  const end = new Date();
  const start = new Date(end.getTime() - (365*years+30)*24*3600*1000);
  const d1 = yyyymmdd(start), d2 = yyyymmdd(end);

  // Fetch BDRY (proxy for BDI)
  const bdry = await fetchStooqDaily("BDRY", d1, d2);
  const mBDI = toSeriesMap(bdry);

  const traces = [{
    x: bdry.map(x=>x.date),
    y: normalizeTo100(bdry.map(x=>x.close)),
    name: "BDRY (proxy BDI)",
    mode: "lines",
    line: {dash:"dash"}
  }];

  const tbody = document.querySelector("#result tbody");
  tbody.innerHTML = "";
  const summaryRows = [];

  for(const s of stocks){
    try{
      const arr = await fetchStooqDaily(s, d1, d2);
      const mS = toSeriesMap(arr);
      const dates = intersectDates(mBDI, mS);
      const a = dates.map(k=>mBDI.get(k));
      const b = dates.map(k=>mS.get(k));
      const retA = pctChange(a);
      const retB = pctChange(b);
      const best = bestLag(retA, retB, 120);

      // push table
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${s}</td><td>${best.lag}</td><td>${best.corr.toFixed(3)}</td><td>${best.n}</td>`;
      tbody.appendChild(tr);
      summaryRows.push({Stock:s, Best_Lag_Days:best.lag, Max_Corr:best.corr.toFixed(3), N:best.n});

      // trace for chart (normalized to 100)
      traces.push({
        x: arr.map(x=>x.date),
        y: normalizeTo100(arr.map(x=>x.close)),
        name: s,
        mode: "lines"
      });
    }catch(e){
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${s}</td><td colspan="3">無數據（Stooq 未提供）</td>`;
      tbody.appendChild(tr);
    }
  }

  Plotly.newPlot("chart", traces, {
    paper_bgcolor:"#0e1530", plot_bgcolor:"#0e1530",
    font:{color:"#e7e9f3"},
    margin:{t:40,l:50,r:20,b:40},
    legend:{orientation:"h"},
    yaxis:{title:"Start=100"},
    xaxis:{title:"Date"}
  }, {responsive:true});

  // export handler
  document.getElementById('export').onclick = ()=>{
    const csv = ["Stock,Best_Lag_Days,Max_Corr,N"].concat(
      summaryRows.map(r=>`${r.Stock},${r.Best_Lag_Days},${r.Max_Corr},${r.N}`)
    ).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "summary_best_lag.csv";
    a.click();
  };
}

document.getElementById('run').addEventListener('click', ()=>{
  document.querySelector("#result tbody").innerHTML = "<tr><td colspan='4'>Loading…</td></tr>";
  run().catch(err=>{
    document.querySelector("#result tbody").innerHTML = `<tr><td colspan='4'>錯誤：${err}</td></tr>`;
  });
});

// auto run on load
run().catch(()=>{});

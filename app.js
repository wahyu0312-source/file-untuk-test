/* =========================================================
 * app.js — Tokyo Seimitsu ERP Frontend (stable full)
 * ========================================================= */

/* ====== KONFIGURASI ====== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwnU2BvQ6poO4EmMut3g5Zuu_cuojNbTmM8oRSCyNJDwm_38VgS7BhsFLKU0eoUt-BAKw/exec"; // contoh: https://script.google.com/macros/s/AKfycb.../exec
const API_KEY  = ""; // (opsional)

/* ====== KONST & STATE ====== */
const $  = (sel)=> document.querySelector(sel);
const $$ = (sel)=> Array.from(document.querySelectorAll(sel));

const PAGES = ['authView','pageDash','pageSales','pagePlan','pageShip','pageInventory','pageFinished','pageInvoice','pageCharts'];

const PROCESSES = [
  'レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング',
  '外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程'
];

let SESSION     = null;            // {user, role, token}
let scanStream  = null;            // media stream untuk QR
let INV_PREVIEW = { info:null, lines:[], inv_id:'' }; // state preview invoice

/* ====== UTIL WAKTU ====== */
const fmtDT = (s)=> s? new Date(s).toLocaleString(): '';
const fmtD  = (s)=> s? new Date(s).toLocaleDateString(): '';

/* ====== SERVICE WORKER (optional) ====== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.getRegistration().then(reg=>{
      if(!reg){ navigator.serviceWorker.register('./sw.js').catch(console.warn); }
    });
  });
}

/* ====== SWR CACHE SEDERHANA ====== */
const SWR = {
  get(key){ try{ const x=localStorage.getItem(key); return x? JSON.parse(x):null; }catch(e){ return null; } },
  set(key,val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} },
  del(key){ try{ localStorage.removeItem(key); }catch(e){} }
};

/* ====== API HELPERS ====== */
async function apiPost(action, body){
  const payload = { action, ...body };
  if(API_KEY) payload.apiKey = API_KEY;

  let res, txt;
  try{
    res = await fetch(API_BASE, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(payload),
      cache:'no-store',
    });
    txt = await res.text();
  }catch(err){
    throw new Error('Network error: ' + (err.message||err));
  }

  try{
    const j = JSON.parse(txt);
    if(!j.ok) throw new Error(j.error||'API error');
    return j.data;
  }catch(e){
    console.error('API RAW (POST '+action+'):\n', txt);
    throw new Error('Invalid response (cek deploy/izin Apps Script).');
  }
}

async function apiGet(params, {swrKey=null, revalidate=true}={}){
  const url = API_BASE + '?' + new URLSearchParams(params).toString();
  const key = swrKey || ('GET:'+url);

  const cached = SWR.get(key);
  if (cached && revalidate){
    // revalidate in background
    fetch(url,{cache:'no-store'}).then(r=>r.text()).then(txt=>{
      try{
        const j=JSON.parse(txt);
        if(j.ok){ SWR.set(key, j.data); document.dispatchEvent(new CustomEvent('swr:update',{detail:{key}})); }
      }catch(_){}
    }).catch(()=>{});
    return cached;
  }

  let res, txt;
  try{ res = await fetch(url,{cache:'no-store'}); txt = await res.text(); }
  catch(err){ if(cached) return cached; throw new Error('Network error: '+(err.message||err)); }

  try{
    const j = JSON.parse(txt);
    if(!j.ok) throw new Error(j.error||'API error');
    SWR.set(key, j.data);
    return j.data;
  }catch(e){
    console.error('API RAW (GET):\n', txt);
    if(cached) return cached;
    throw new Error('Invalid response (cek deploy/izin Apps Script).');
  }
}

function showApiError(action, err){
  console.error('API FAIL:', action, err);
  let bar = $('#errbar');
  if(!bar){
    bar = document.createElement('div');
    bar.id='errbar';
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;background:#fee;border:1px solid #f99;color:#900;padding:10px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08);z-index:9999';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<b>APIエラー</b> <code>${action}</code> — ${err.message||err}`;
}

/* ====== VIEW/DOM HELPERS ====== */
function showPage(id){
  PAGES.forEach(pid=>{
    const el = document.getElementById(pid);
    if(!el) return;
    if(pid === id) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

function tableSkeleton(tbody, rows=7, cols=8){
  if(!tbody) return;
  const frag = document.createDocumentFragment();
  for(let i=0;i<rows;i++){
    const tr = document.createElement('tr');
    for(let c=0;c<cols;c++){
      const td = document.createElement('td');
      td.innerHTML = `<div class="shimmer" style="height:14px;border-radius:6px"></div>`;
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  }
  tbody.innerHTML = '';
  tbody.appendChild(frag);
}
function clearSkeleton(tbody){ if(tbody) tbody.innerHTML=''; }

/* ====== AUTH ====== */
async function doLogin(){
  const user = $('#inUser')?.value?.trim() || '';
  const pass = $('#inPass')?.value || '';
  if(!user || !pass){ alert('ユーザー名とパスワードを入力してください'); return; }

  try{
    const data = await apiPost('login', { user, pass });
    SESSION = { user:data.user, role:data.role||'admin', token:data.token||'' };
    localStorage.setItem('erp_session', JSON.stringify(SESSION));
    enter();
  }catch(err){
    showApiError('login', err);
  }
}
function logout(){
  SESSION=null; localStorage.removeItem('erp_session');
  showPage('authView');
}

/* ====== MASUK APP ====== */
function enter(){
  showPage('pageDash');
  bindNav();     // jaga-jaga jika belum
  loadDashboard();
}

/* ====== DASHBOARD ====== */
async function loadDashboard(){
  showPage('pageDash');

  // contoh skeleton untuk “today” list
  const body = $('#listToday'); if (body) tableSkeleton(body, 6, 4);

  try{
    const d = await apiGet({action:'dashboard'}, {swrKey:'dashboard', revalidate:true});

    // Stats ringkasan (aman kalau tidak ada)
    if($('#statFinished')) $('#statFinished').textContent = d?.finished ?? '-';
    if($('#statReady'))    $('#statReady').textContent    = d?.ready ?? '-';
    if($('#statShipped'))  $('#statShipped').textContent  = d?.shipped ?? '-';

    // List hari ini
    if(body){
      clearSkeleton(body);
      const rows = (d?.today||[]).map((x,i)=>`
        <tr>
          <td>${i+1}</td>
          <td>${x.po || ''}</td>
          <td>${x.customer || ''}</td>
          <td>${fmtD(x.due)}</td>
        </tr>`).join('');
      body.innerHTML = rows || `<tr><td colspan="4" style="text-align:center;color:#888">データなし</td></tr>`;
    }

  }catch(err){
    clearSkeleton(body);
    showApiError('dashboard', err);
  }
}

/* ====== CHARTS ====== */
function destroyChartByCanvas(el){
  if(!el) return;
  const inst = Chart.getChart(el);
  if (inst) inst.destroy();
}

async function renderCharts(){
  showPage('pageCharts');

  // Ambil tahun dari selector (kalau ada)
  const yearSel = $('#chartYear');
  const year = yearSel ? +yearSel.value : (new Date()).getFullYear();

  try{
    const d = await apiGet({action:'charts', year}, {swrKey:`charts:${year}`, revalidate:true});

    // Bentuk data safe
    const ms = (arr)=>({labels:['1','2','3','4','5','6','7','8','9','10','11','12'], datasets:[{label:'数量', data: arr||[]}]});
    // By process object -> labels & data
    const objToBar = (obj)=>({labels:Object.keys(obj||{}), datasets:[{label:'点数', data:Object.values(obj||{})}]});

    // Render
    drawBar('chMonthly', ms(d?.perMonth));
    drawPie('chCustomer', d?.perCust);
    drawPie('chStock', d?.stockBuckets);
    drawBar('chWipProc', objToBar(d?.wipByProcess));
    drawBar('chSales', ms(d?.salesPerMonth));
    drawBar('chPlan', ms(d?.planPerMonth));
  }catch(err){
    showApiError('charts', err);
  }
}

function drawBar(id, data){
  const el = document.getElementById(id);
  if (!el) return;
  destroyChartByCanvas(el);
  new Chart(el, { type:'bar', data, options:{ responsive:true, maintainAspectRatio:false, animation:{duration:300} } });
}
function drawPie(id, obj){
  const el = document.getElementById(id);
  if (!el) return;
  destroyChartByCanvas(el);
  new Chart(el, {
    type:'doughnut',
    data:{ labels:Object.keys(obj||{}), datasets:[{ data:Object.values(obj||{}) }] },
    options:{ responsive:true, maintainAspectRatio:false, animation:{duration:300} }
  });
}

/* ====== QR SCAN (minimal) ====== */
async function initScan(){
  const video = $('#scanVideo');
  if (!video) return;
  try{
    // stop stream lama kalau ada
    if (scanStream) scanStream.getTracks().forEach(t=>t.stop());

    scanStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } });
    video.srcObject = scanStream;
    await video.play();

    // loop scanning
    const canvas = $('#scanCanvas') || document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const tick = ()=>{
      if (!video.videoWidth) return requestAnimationFrame(tick);
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0,0, canvas.width, canvas.height);
      const img = ctx.getImageData(0,0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code && code.data){
        $('#scanResult') && ($('#scanResult').textContent = code.data);
        stopScan();
      }else{
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }catch(err){
    showApiError('camera', err);
  }
}
function stopScan(){
  if (scanStream){
    scanStream.getTracks().forEach(t=>t.stop());
    scanStream = null;
  }
}

/* ====== INVOICE (preview, create, print, CSV) ====== */
async function previewInvoiceUI(){
  const info = {
    customer: $('#inv_customer')?.value?.trim() || '',
    from: $('#inv_from')?.value || '',
    to: $('#inv_to')?.value || '',
    date: $('#inv_date')?.value || '',
    currency: $('#inv_currency')?.value || '',
    memo: $('#inv_memo')?.value || ''
  };
  if(!info.from || !info.to){ alert('期間（自/至）を入力'); return; }

  try{
    const d = await apiGet({action:'previewInvoice', customer:info.customer, from:info.from, to:info.to}, {swrKey:`inv:${info.customer}:${info.from}:${info.to}`});
    INV_PREVIEW.info = {
      得意先: d?.info?.得意先 || info.customer,
      期間自: d?.info?.期間自 || info.from,
      期間至: d?.info?.期間至 || info.to,
      請求日: info.date || d?.info?.請求日 || '',
      通貨: info.currency || d?.info?.通貨 || '',
      メモ: info.memo || d?.info?.メモ || ''
    };
    INV_PREVIEW.lines = d?.lines || [];

    // render tabel preview
    const tb = $('#invLines');
    if (tb){
      tb.innerHTML = (INV_PREVIEW.lines || []).map((l,i)=>`
        <tr>
          <td>${i+1}</td>
          <td>${l['品名']||''}</td>
          <td style="text-align:right">${l['数量']||0}</td>
          <td style="text-align:right">${l['単価']||0}</td>
          <td style="text-align:right">${(l['数量']||0)*(l['単価']||0)}</td>
          <td>${l['PO']||l['POs']||''}</td>
          <td>${l['出荷ID']||l['出荷IDs']||''}</td>
        </tr>
      `).join('') || `<tr><td colspan="7" style="text-align:center;color:#888">データなし</td></tr>`;
    }

    // subtotal/total (kalau backend tidak kasih, hitung lokal)
    const sub = (INV_PREVIEW.lines||[]).reduce((a,l)=> a + Number(l['数量']||0)*Number(l['単価']||0), 0);
    const tax = Math.round(sub * 0.1); // contoh 10%
    const ttl = sub + tax;
    $('#invSub')   && ($('#invSub').textContent   = String(d?.info?.小計 ?? sub));
    $('#invTax')   && ($('#invTax').textContent   = String(d?.info?.消費税 ?? tax));
    $('#invTotal') && ($('#invTotal').textContent = String(d?.info?.合計 ?? ttl));
  }catch(err){
    showApiError('previewInvoice', err);
  }
}

async function createInvoiceUI(){
  if(!INV_PREVIEW || !INV_PREVIEW.lines || !INV_PREVIEW.lines.length){
    alert('先に集計してください（「集計（出荷済）」を押してください）');
    return;
  }
  try{
    const payload = { info: INV_PREVIEW.info, lines: INV_PREVIEW.lines };
    const r = await apiPost('createInvoice', { payload, user:SESSION });
    INV_PREVIEW.inv_id = r?.inv_id || '';
    alert(`発行しました: ${INV_PREVIEW.inv_id}（合計: ${r?.合計 ?? ''}）`);
  }catch(err){
    showApiError('createInvoice', err);
  }
}

async function openInvoiceDoc(inv_id){
  const id = inv_id || INV_PREVIEW.inv_id;
  if(!id){ alert('請求書IDがありません'); return; }
  try{
    const d = await apiGet({action:'invoiceDoc', inv_id:id});
    const head = d?.inv || {};
    const lines = d?.lines || [];

    const html = `
      <h3>請求書</h3>
      <table class="kv">
        <tr><th>請求書</th><td>${head.inv_id||id}</td><th>請求日</th><td>${fmtD(head['請求日'])}</td></tr>
        <tr><th>得意先</th><td>${head['得意先']||''}</td><th>期間</th><td>${fmtD(head['期間自'])} 〜 ${fmtD(head['期間至'])}</td></tr>
        <tr><th>小計</th><td>${head['小計']||''}</td><th>合計</th><td>${head['合計']||''}</td></tr>
      </table>
      <h4>明細</h4>
      <table class="grid">
        <thead><tr><th>#</th><th>品名</th><th>数量</th><th>単価</th><th>金額</th><th>PO</th><th>出荷ID</th></tr></thead>
        <tbody>${(lines).map((l,i)=>`
          <tr>
            <td>${i+1}</td>
            <td>${l['品名']||''}</td>
            <td style="text-align:right">${l['数量']||0}</td>
            <td style="text-align:right">${l['単価']||0}</td>
            <td style="text-align:right">${(l['数量']||0)*(l['単価']||0)}</td>
            <td>${l['PO']||l['POs']||''}</td>
            <td>${l['出荷ID']||l['出荷IDs']||''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    showDoc('dlgTicket', html);
  }catch(err){
    showApiError('invoiceDoc', err);
  }
}

// ===== Invoice: CSV Export (global) =====
window.exportInvoiceCSV = function exportInvoiceCSV(){
  if(!INV_PREVIEW || !INV_PREVIEW.lines || !INV_PREVIEW.lines.length){
    alert('先に集計してください（「集計（出荷済）」を押してください）');
    return;
  }
  const info  = INV_PREVIEW.info  || {};
  const lines = INV_PREVIEW.lines || [];
  const metaRows = [
    ['得意先', info.得意先 || ''],
    ['期間自', info.期間自 || '', '期間至', info.期間至 || ''],
    ['請求日', info.請求日 || '', '通貨', info.通貨 || '', 'メモ', info.メモ || ''],
    []
  ];
  const headers = ['行No','品名','品番','図番','数量','単価','金額','PO','出荷ID'];
  const rows = (lines||[]).map((l,i)=>[
    i+1,
    l['品名'] || '',
    l['品番'] || '',
    l['図番'] || '',
    Number(l['数量'] || 0),
    Number(l['単価'] || 0),
    Number((l['数量']||0) * (l['単価']||0)),
    l['PO'] || l['POs'] || '',
    l['出荷ID'] || l['出荷IDs'] || ''
  ]);
  const esc   = v=> `"${String(v).replace(/"/g,'""')}"`;
  const toRow = arr=> arr.map(esc).join(',');
  const csv   = metaRows.map(toRow).join('\r\n')
               + '\r\n' + toRow(headers) + '\r\n'
               + rows.map(toRow).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const fn   = `invoice_${(info.得意先||'customer')}_${(info.請求日||'').replace(/-/g,'')}.csv`;
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

/* ====== DIALOG DOC HELPER ====== */
function showDoc(dialogId, html){
  const dlg = document.getElementById(dialogId);
  if(!dlg) return;
  const body = dlg.querySelector('.body') || dlg;
  body.innerHTML = html;
  try{ dlg.showModal(); }catch(_){ dlg.classList.remove('hidden'); }
}

/* ====== SALES / PLAN / SHIP / INVENTORY / FINISHED (stubs aman) ====== */
window.doSearchOrders = window.doSearchOrders || function(){ /* TODO: implement pencarian orders */ };
window.savePlan       = window.savePlan       || async function(){ /* TODO: implement simpan rencana */ };
window.exportPlan     = window.exportPlan     || function(){ /* TODO: implement ekspor rencana */ };
window.importPlan     = window.importPlan     || function(){ /* TODO: implement impor rencana (XLSX) */ };
window.openShipDlg    = window.openShipDlg    || function(){ /* TODO: implement dialog ship */ };
window.openTicket     = window.openTicket     || function(){ /* TODO: implement ticket viewer */ };

/* ====== NAVIGASI / BINDINGS ====== */
function bindNav(){
  // Navbar ke halaman
  $('#btnToDash')     ?.addEventListener('click', ()=> { showPage('pageDash'); loadDashboard(); });
  $('#btnToSales')    ?.addEventListener('click', ()=> showPage('pageSales'));
  $('#btnToPlan')     ?.addEventListener('click', ()=> showPage('pagePlan'));
  $('#btnToShip')     ?.addEventListener('click', ()=> showPage('pageShip'));
  $('#btnToInvPage')  ?.addEventListener('click', ()=> showPage('pageInventory'));
  $('#btnToFinPage')  ?.addEventListener('click', ()=> showPage('pageFinished'));
  $('#btnToInvoice')  ?.addEventListener('click', ()=> { showPage('pageInvoice'); });
  $('#btnToCharts')   ?.addEventListener('click', ()=> { showPage('pageCharts'); renderCharts(); });

  // Auth
  $('#btnLogin')      ?.addEventListener('click', doLogin);

  // Dashboard
  $('#btnRefresh')    ?.addEventListener('click', loadDashboard);

  // Charts
  $('#btnChartsRefresh')?.addEventListener('click', renderCharts);
  $('#chartYear')     ?.addEventListener('change', renderCharts);

  // Invoice
  $('#btnInvPreview') ?.addEventListener('click', previewInvoiceUI);
  $('#btnInvCreate')  ?.addEventListener('click', createInvoiceUI);
  $('#btnInvPrint')   ?.addEventListener('click', ()=> openInvoiceDoc(INV_PREVIEW.inv_id||''));
  $('#btnInvCSV')     ?.addEventListener('click', window.exportInvoiceCSV);

  // QR Scan
  $('#btnScanStart')  ?.addEventListener('click', initScan);
  $('#btnScanClose')  ?.addEventListener('click', stopScan);
}

/* ====== BOOTSTRAP ====== */
window.addEventListener('DOMContentLoaded', ()=>{
  bindNav();

  const saved = localStorage.getItem('erp_session');
  if (saved){
    try{ SESSION = JSON.parse(saved); }catch(_){}
  }
  if (SESSION){ enter(); } else { showPage('authView'); }
});

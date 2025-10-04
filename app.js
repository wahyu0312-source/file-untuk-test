/* =========================================================
 * app.js — Tokyo Seimitsu ERP (Frontend) — LEVEL MAX
 * - Nav active + underline slide-in (via CSS) + 3D tilt
 * - SWR cache: UI instant dari localStorage, refresh di background
 * - Import CSV/XLSX untuk 受注/生産計画/出荷予定
 * - QR scan (jsQR) + Station toggle (工程QR)
 * - Orders/Sales/Plan/Ship/Invoice/Inventory/Finished/Charts
 * - Keyboard shortcuts di dialog: E = export, R = reset filter
 * ========================================================= */

/* ===== Config ===== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwnU2BvQ6poO4EmMut3g5Zuu_cuojNbTmM8oRSCyNJDwm_38VgS7BhsFLKU0eoUt-BAKw/exec"; // GANTI ke WebApp URL Anda
const API_KEY = ""; // optional
const PROCESSES = [
  'レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング',
  '外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程'
];

/* ===== Station toggle rules ===== */
const STATION_RULES = {
  'レーザ加工': (o)=> ({ current_process:'レーザ加工' }),
  '曲げ工程': (o)=> ({ current_process:'曲げ加工' }),
  '外枠組立': (o)=> ({ current_process:'外枠組立' }),
  'シャッター組立': (o)=> ({ current_process:'シャッター組立' }),
  'シャッター溶接': (o)=> ({ current_process:'シャッター溶接' }),
  'コーキング': (o)=> ({ current_process:'コーキング' }),
  '外枠塗装': (o)=> ({ current_process:'外枠塗装' }),
  '組立工程': (o)=> (o.current_process==='組立（組立中）' ? { current_process:'組立（組立済）' } : { current_process:'組立（組立中）' }),
  '検査工程': (o)=> (o.current_process==='検査工程' && !['検査保留','不良品（要リペア）','検査済'].includes(o.status) ? { current_process:'検査工程', status:'検査済' } : { current_process:'検査工程' }),
  '出荷工程': (o)=> (o.status==='出荷準備' ? { current_process:o.current_process||'検査工程', status:'出荷済' } : { current_process:'検査工程', status:'出荷準備' })
};

const $ = (s)=> document.querySelector(s);
const fmtDT= (s)=> s? new Date(s).toLocaleString(): '';
const fmtD = (s)=> s? new Date(s).toISOString().slice(0,10): ''; // yyyy-mm-dd untuk form

/* ===== Global state ===== */
let SESSION=null, CURRENT_PO=null, scanStream=null, scanTimer=null;
let INV_PREVIEW={info:null, lines:[], inv_id:''};
let chartsLoaded=false;
let CHARTS={}; // instances

/* ===== Visual mapping ===== */
const STATUS_CLASS = {
  '生産開始':'st-begin',
  '検査工程':'st-inspect',
  '検査済':'st-inspect',
  '検査保留':'st-hold',
  '出荷準備':'st-ready',
  '出荷済':'st-shipped',
  '不良品（要リペア）':'st-ng'
};
const PROC_CLASS = {
  'レーザ加工':'prc-laser','曲げ加工':'prc-bend','外枠組立':'prc-frame','シャッター組立':'prc-shassy',
  'シャッター溶接':'prc-shweld','コーキング':'prc-caulk','外枠塗装':'prc-tosou',
  '組立（組立中）':'prc-asm-in','組立（組立済）':'prc-asm-ok','外注':'prc-out','検査工程':'prc-inspect'
};

/* ===== API helpers ===== */
async function apiPost(action, body){
  const payload={action,...body};
  if(API_KEY) payload.apiKey=API_KEY;
  const res=await fetch(API_BASE,{
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify(payload),
    cache:'no-store',
  });
  const j=await res.json();
  if(!j.ok) throw new Error(j.error||'API error');
  return j.data;
}
async function apiGet(params){
  const url=API_BASE+'?'+new URLSearchParams(params).toString();
  const res=await fetch(url,{cache:'no-store'});
  const j=await res.json();
  if(!j.ok) throw new Error(j.error||'API error');
  return j.data;
}
function showApiError(action, err){
  console.error('API FAIL:', action, err);
  let bar=document.getElementById('errbar');
  if(!bar){
    bar=document.createElement('div');
    bar.id='errbar';
    bar.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;background:#fee;border:1px solid #f99;color:#900;padding:10px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08);z-index:9999';
    document.body.appendChild(bar);
  }
  bar.innerHTML=`<b>APIエラー</b> <code>${action||'-'}</code> — ${err.message||err}`;
}

/* ===== Simple utils ===== */
function debounce(fn, ms=150){
  let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,args), ms); };
}

/* ===== SWR Cache helpers ===== */
const CACHE_KEYS = {
  ORDERS:'cache_orders',
  SALES:'cache_sales',
  STOCK:'cache_stock',
  TODAY:'cache_today',
  LOC:'cache_loc'
};
const setCache = (k, v)=> localStorage.setItem(k, JSON.stringify({t:Date.now(), v}));
const getCache = (k, maxAgeMs=1000*60*5)=>{ // 5 menit
  try{
    const raw=localStorage.getItem(k); if(!raw) return null;
    const {t,v}=JSON.parse(raw); if(Date.now()-t>maxAgeMs) return null;
    return v;
  }catch{return null}
};

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  // Nav ke pages
  const btnToDash = $('#btnToDash');
  const btnToSales = $('#btnToSales');
  const btnToPlan = $('#btnToPlan');
  const btnToShip = $('#btnToShip');
  const btnToInvPage = $('#btnToInvPage');
  const btnToFinPage = $('#btnToFinPage');
  const btnToInvoice = $('#btnToInvoice');
  const btnToCharts = $('#btnToCharts');

  if(btnToDash) btnToDash.onclick = ()=> show('pageDash');
  if(btnToSales) btnToSales.onclick = ()=> show('pageSales');
  if(btnToPlan) btnToPlan.onclick = ()=> show('pagePlan');
  if(btnToShip) btnToShip.onclick = ()=> show('pageShip');
  if(btnToInvPage) btnToInvPage.onclick = ()=> { show('pageInventory'); renderInventory(); };
  if(btnToFinPage) btnToFinPage.onclick = ()=> { show('pageFinished'); renderFinished(); };
  if(btnToInvoice) btnToInvoice.onclick = ()=> show('pageInvoice');
  if(btnToCharts) btnToCharts.onclick = ()=> { show('pageCharts'); ensureChartsLoaded(); };

  // Settings
  const miStationQR = $('#miStationQR');
  const miAddUser = $('#miAddUser');
  const miChangePass = $('#miChangePass');
  const btnLogoutMenu = $('#btnLogout');
  if(miStationQR) miStationQR.onclick = openStationQR;
  if(miAddUser) miAddUser.onclick = openAddUserModal;
  if(miChangePass) miChangePass.onclick = changePasswordUI;
  if(btnLogoutMenu) btnLogoutMenu.onclick= ()=>{ SESSION=null; localStorage.removeItem('erp_session'); location.reload(); };

  // Auth
  const btnLogin = $('#btnLogin');
  const btnNewUser = $('#btnNewUser');
  if(btnLogin) btnLogin.onclick = onLogin;
  if(btnNewUser) btnNewUser.onclick = addUserFromLoginUI;

  // Dashboard
  const btnRefresh = $('#btnRefresh');
  const searchQ = $('#searchQ');
  const btnExportOrders = $('#btnExportOrders');
  const btnExportShip = $('#btnExportShip');
  if(btnRefresh) btnRefresh.onclick = refreshAll;
  if(searchQ) searchQ.addEventListener('input', debounce(renderOrders, 200));
  if(btnExportOrders) btnExportOrders.onclick = exportOrdersCSV;
  if(btnExportShip) btnExportShip.onclick = exportShipCSV;

  // Sales
  const btnSalesSave = $('#btnSalesSave');
  const btnSalesDelete = $('#btnSalesDelete');
  const btnSalesExport = $('#btnSalesExport');
  const btnPromote = $('#btnPromote');
  const salesQ = $('#salesQ');
  const btnSalesImport = $('#btnSalesImport');
  const fileSales = $('#fileSales');
  if(btnSalesSave) btnSalesSave.onclick = saveSalesUI;
  if(btnSalesDelete) btnSalesDelete.onclick = deleteSalesUI;
  if(btnSalesExport) btnSalesExport.onclick = exportSalesCSV;
  if(btnPromote) btnPromote.onclick = promoteSalesUI;
  if(salesQ) salesQ.addEventListener('input', debounce(renderSales, 200));
  if(btnSalesImport) btnSalesImport.onclick = ()=> fileSales && fileSales.click();
  if(fileSales) fileSales.onchange = (e)=> handleImport(e, 'sales');

  // Plan
  const btnCreateOrder = $('#btnCreateOrder');
  const btnPlanExport = $('#btnPlanExport');
  const btnPlanEdit = $('#btnPlanEdit');
  const btnPlanDelete = $('#btnPlanDelete');
  const btnPlanImport = $('#btnPlanImport');
  const filePlan = $('#filePlan');
  if(btnCreateOrder) btnCreateOrder.onclick = createOrderUI;
  if(btnPlanExport) btnPlanExport.onclick = exportOrdersCSV;
  if(btnPlanEdit) btnPlanEdit.onclick = loadOrderForEdit;
  if(btnPlanDelete) btnPlanDelete.onclick = deleteOrderUI;
  if(btnPlanImport) btnPlanImport.onclick = ()=> filePlan && filePlan.click();
  if(filePlan) filePlan.onchange = (e)=> handleImport(e, 'orders');

  // Ship
  const btnSchedule = $('#btnSchedule');
  const btnShipExport = $('#btnShipExport');
  const btnShipEdit = $('#btnShipEdit');
  const btnShipDelete = $('#btnShipDelete');
  const btnShipByPO = $('#btnShipByPO');
  const btnShipByID = $('#btnShipByID');
  const btnShipImport = $('#btnShipImport');
  const fileShip = $('#fileShip');
  if(btnSchedule) btnSchedule.onclick = scheduleUI;
  if(btnShipExport) btnShipExport.onclick = exportShipCSV;
  if(btnShipEdit) btnShipEdit.onclick = loadShipForEdit;
  if(btnShipDelete) btnShipDelete.onclick = deleteShipUI;
  if(btnShipByPO) btnShipByPO.onclick = ()=>{ const po=$('#s_po').value.trim(); if(!po) return alert('注番入力'); openShipByPO(po); };
  if(btnShipByID) btnShipByID.onclick = ()=>{ const id=prompt('Ship ID:'); if(!id) return; openShipByID(id.trim()); };
  if(btnShipImport) btnShipImport.onclick = ()=> fileShip && fileShip.click();
  if(fileShip) fileShip.onchange = (e)=> handleImport(e, 'ship');

  // Invoice
  const btnInvPreview = $('#btnInvPreview');
  const btnInvCreate = $('#btnInvCreate');
  const btnInvPrint = $('#btnInvPrint');
  const btnInvCSV = $('#btnInvCSV');
  if(btnInvPreview) btnInvPreview.onclick = previewInvoiceUI;
  if(btnInvCreate) btnInvCreate.onclick = createInvoiceUI;
  if(btnInvPrint) btnInvPrint.onclick = ()=> openInvoiceDoc(INV_PREVIEW.inv_id||'');
  if(btnInvCSV) btnInvCSV.onclick = exportInvoiceCSV;

  // Charts page
  const btnChartsRefresh = $('#btnChartsRefresh');
  fillChartYearSelector();
  if(btnChartsRefresh) btnChartsRefresh.onclick = renderCharts;

  // Inventory & Finished filters
  const invQ = $('#invQ'); if(invQ) invQ.addEventListener('input', debounce(renderInventory, 200));
  const finQ = $('#finQ'); if(finQ) finQ.addEventListener('input', debounce(renderFinished, 200));

  // Keyboard shortcuts global untuk dialog (E=export, R=reset)
  document.addEventListener('keydown', dialogShortcuts);

  // Restore session
  const saved=localStorage.getItem('erp_session');
  if(saved){ SESSION=JSON.parse(saved); enter(); } else { show('authView'); }

  // Inisialisasi 3D tilt di tombol nav
  initNavTilt();
});

/* ===== UI helpers ===== */
function show(id){
  const ids=['authView','pageDash','pageSales','pagePlan','pageShip','pageInvoice','pageCharts','pageInventory','pageFinished'];
  ids.forEach(x=>{ const el=document.getElementById(x); if(el) el.classList.add('hidden'); });
  const target=document.getElementById(id);
  if(target) target.classList.remove('hidden');

  const map = {
    pageDash: 'btnToDash',
    pageSales: 'btnToSales',
    pagePlan: 'btnToPlan',
    pageShip: 'btnToShip',
    pageInventory: 'btnToInvPage',
    pageFinished: 'btnToFinPage',
    pageInvoice: 'btnToInvoice',
    pageCharts: 'btnToCharts'
  };
  ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvPage','btnToFinPage','btnToInvoice','btnToCharts']
    .forEach(idBtn => { const b=document.getElementById(idBtn); if(b) b.classList.remove('active'); });
  const btnId = map[id];
  if(btnId){ const b=document.getElementById(btnId); if(b) b.classList.add('active'); }
}
function enter(){
  const ui=$('#userInfo');
  if(ui && SESSION) ui.textContent = `${SESSION.full_name}・${SESSION.department}`;
  ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvPage','btnToFinPage','btnToInvoice','btnToCharts'].forEach(id=>{
    const el=$('#'+id); if(el) el.classList.remove('hidden');
  });
  const dd=$('#ddSetting'); if(dd) dd.classList.remove('hidden');
  if(!(SESSION.role==='admin' || SESSION.department==='生産技術')){
    const miAddUser=$('#miAddUser'); if(miAddUser) miAddUser.classList.add('hidden');
  }
  show('pageDash');
  loadMasters();
  // 1) render instan dari cache
  hydrateFromCache();
  // 2) revalidate di background
  requestIdleCallback(()=> refreshAll(), {timeout:1200});
}

/* ===== 3D Tilt ===== */
function initNavTilt(){
  const btnIds=['btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvPage','btnToFinPage','btnToInvoice','btnToCharts'];
  btnIds.forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.addEventListener('mousemove', (e)=>{
      const r=el.getBoundingClientRect();
      const cx=r.left + r.width/2, cy=r.top + r.height/2;
      const dx=(e.clientX - cx)/r.width;
      const dy=(e.clientY - cy)/r.height;
      const max=6;
      el.style.setProperty('--tiltY', `${dx*max}deg`);
      el.style.setProperty('--tiltX', `${-dy*max}deg`);
    });
    el.addEventListener('mouseleave', ()=>{
      el.style.setProperty('--tiltX','0deg');
      el.style.setProperty('--tiltY','0deg');
    });
  });
}

/* ===== Masters ===== */
async function loadMasters(){
  try{
    const m=await apiGet({action:'masters',types:'得意先,品名,品番,図番'});
    const fill=(id,arr)=>{ const el=$(id); if(el) el.innerHTML=(arr||[]).map(v=>`<option value="${v}"></option>`).join(''); };
    fill('#dl_tokui',m['得意先']); fill('#dl_hinmei',m['品名']); fill('#dl_hinban',m['品番']); fill('#dl_zuban',m['図番']);
  }catch(e){ console.warn(e); }
}

/* ===== Hydrate dari cache (instant) ===== */
async function hydrateFromCache(){
  const s = getCache(CACHE_KEYS.STOCK);
  if(s){
    const statFinished=$('#statFinished'), statReady=$('#statReady'), statShipped=$('#statShipped');
    if(statFinished) statFinished.textContent=s.finishedStock;
    if(statReady) statReady.textContent=s.ready;
    if(statShipped) statShipped.textContent=s.shipped;
  }
  const today = getCache(CACHE_KEYS.TODAY);
  if(today){
    const listToday=$('#listToday');
    if(listToday){
      listToday.innerHTML = today.length ? today.map(r=>`<div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join('') : '<div class="muted">本日予定なし</div>';
    }
  }
  const loc = getCache(CACHE_KEYS.LOC);
  if(loc){
    const grid=$('#gridProc');
    if(grid) grid.innerHTML = PROCESSES.map(p=> `<div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>`).join('');
  }
  const orders = getCache(CACHE_KEYS.ORDERS);
  if(orders && $('#tbOrders')) renderOrdersFrom(orders);
  const sales = getCache(CACHE_KEYS.SALES);
  if(sales && $('#tbSales')) renderSalesFrom(sales);
}

/* ===== Dashboard (tanpa charts) ===== */
async function refreshAll(keep=false){
  try{
    const [s, today, loc] = await Promise.all([
      apiGet({action:'stock'}),
      apiGet({action:'todayShip'}),
      apiGet({action:'locSnapshot'})
    ]);
    setCache(CACHE_KEYS.STOCK, s);
    setCache(CACHE_KEYS.TODAY, today);
    setCache(CACHE_KEYS.LOC, loc);

    const statFinished=$('#statFinished'), statReady=$('#statReady'), statShipped=$('#statShipped');
    if(statFinished) statFinished.textContent=s.finishedStock;
    if(statReady) statReady.textContent=s.ready;
    if(statShipped) statShipped.textContent=s.shipped;

    const listToday=$('#listToday');
    if(listToday) listToday.innerHTML = today.length ? today.map(r=>`<div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join('') : '<div class="muted">本日予定なし</div>';

    const grid=$('#gridProc');
    if(grid) grid.innerHTML = PROCESSES.map(p=> `<div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>`).join('');

    if(!keep){ const q=$('#searchQ'); if(q) q.value=''; }
    const orders=await apiGet({action:'listOrders',q:($('#searchQ')?.value||'')});
    setCache(CACHE_KEYS.ORDERS, orders);
    renderOrdersFrom(orders);

    const sales=await apiGet({action:'listSales',q:($('#salesQ')?.value||'')});
    setCache(CACHE_KEYS.SALES, sales);
    renderSalesFrom(sales);

  }catch(e){ console.error(e); }
}

/* ===== Orders table ===== */
async function listOrders(){
  const qEl=$('#searchQ'); const q = qEl ? qEl.value.trim() : '';
  return apiGet({action:'listOrders',q});
}
async function renderOrders(){
  const rows=await listOrders();
  setCache(CACHE_KEYS.ORDERS, rows);
  renderOrdersFrom(rows);
}
function renderOrdersFrom(rows){
  const tbody=$('#tbOrders'); if(!tbody) return;
  const frag=document.createDocumentFragment();
  rows.forEach(r=>{
    const tr=document.createElement('tr');
    const statusName = r.status || ''; const procName = r.current_process || '';
    const stClass = STATUS_CLASS[statusName] || 'st-begin'; const prClass = PROC_CLASS[procName] || 'prc-out';

    const leftCell = `
      <div class="row-main">
        <a href="javascript:void(0)" onclick="openTicket('${r.po_id}')" class="link"><b>${r.po_id}</b></a>
        <div class="row-sub">
          <div class="kv"><span class="muted">得意先:</span> <b>${r['得意先']||'-'}</b></div>
          ${r['製番号']?`<div class="kv"><span class="muted">製番号:</span> <b>${r['製番号']}</b></div>`:''}
          ${(r['品番']||r['図番'])?`<div class="kv"><span class="muted">品番/図番:</span> <b>${r['品番']||''}/${r['図番']||''}</b></div>`:''}
        </div>
      </div>`;

    const statusBadge = `<span class="badge ${stClass}"><span class="dot"></span><span>${statusName||'-'}</span></span>`;
    const procBadge = `<span class="badge ${prClass}"><span class="dot"></span><span>${procName||'-'}</span></span>`;

    const actions = `
      <div class="actions-2col">
        <button class="btn ghost s" onclick="openTicket('${r.po_id}')"><i class="fa-regular fa-file-lines"></i> 票</button>
        <button class="btn ghost s" onclick="startScanFor('${r.po_id}')"><i class="fa-solid fa-qrcode"></i> 更新</button>
        <button class="btn ghost s" onclick="openShipByPO('${r.po_id}')"><i class="fa-solid fa-truck"></i> 出荷票</button>
        <button class="btn ghost s" onclick="openHistory('${r.po_id}')"><i class="fa-solid fa-clock-rotate-left"></i> 履歴</button>
      </div>`;

    tr.innerHTML = `
      <td>${leftCell}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td class="col-status">${statusBadge}</td>
      <td class="col-proc">${procBadge}</td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
      <td class="s">${actions}</td>
    `;
    frag.appendChild(tr);
  });
  tbody.innerHTML=''; tbody.appendChild(frag);
}

/* ===== Sales (営業) ===== */
async function renderSales(){
  const qEl=$('#salesQ'); const q=(qEl&&qEl.value)? qEl.value.trim():'';
  const rows=await apiGet({action:'listSales',q});
  setCache(CACHE_KEYS.SALES, rows);
  renderSalesFrom(rows);
}
function renderSalesFrom(rows){
  const tbody=$('#tbSales'); if(!tbody) return;
  tbody.innerHTML = rows.map(r=> `
    <tr>
      <td>${r.so_id||''}</td>
      <td class="s muted">${fmtD(r['受注日'])}</td>
      <td>${r['得意先']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${(r['品番']||'')}/${(r['図番']||'')}</td>
      <td>${r['数量']||0}</td>
      <td class="s muted">${fmtD(r['希望納期'])}</td>
      <td><span class="badge">${r.status||''}</span></td>
      <td>${r['linked_po_id']||''}</td>
      <td class="s muted">${fmtDT(r['updated_at'])}</td>
    </tr>`).join('');
}
async function saveSalesUI(){
  const p={
    '受注日':$('#so_date')?$('#so_date').value:'', '得意先':$('#so_cust')?$('#so_cust').value:'',
    '品名':$('#so_item')?$('#so_item').value:'', '品番':$('#so_part')?$('#so_part').value:'',
    '図番':$('#so_drw')?$('#so_drw').value:'', '製番号':$('#so_sei')?$('#so_sei').value:'',
    '数量':$('#so_qty')?$('#so_qty').value:'', '希望納期':$('#so_req')?$('#so_req').value:'',
    '備考':$('#so_note')?$('#so_note').value:''
  };
  const soEl=$('#so_id'); const so=soEl?soEl.value.trim():'';
  try{
    if(so){ await apiPost('updateSalesOrder',{so_id:so,updates:p,user:SESSION}); alert('受注を更新しました'); }
    else { const r=await apiPost('createSalesOrder',{payload:p,user:SESSION}); alert('受注登録: '+r.so_id); if(soEl) soEl.value=r.so_id; }
    renderSales();
  }catch(e){ alert(e.message||e); }
}
async function deleteSalesUI(){
  const soEl=$('#so_id'); const so=soEl?soEl.value.trim():'';
  if(!so) return alert('SO入力'); if(!confirm('削除しますか？')) return;
  try{ const r=await apiPost('deleteSalesOrder',{so_id:so,user:SESSION}); alert('削除: '+r.deleted); renderSales(); }
  catch(e){ alert(e.message||e); }
}
async function promoteSalesUI(){
  const soEl=$('#so_id'); const so=soEl?soEl.value.trim():'';
  if(!so) return alert('SO入力');
  try{ const r=await apiPost('promoteSalesToPlan',{so_id:so,user:SESSION}); alert('生産計画を作成: '+r.po_id); refreshAll(); }
  catch(e){ alert(e.message||e); }
}
async function exportSalesCSV(){ const rows=await apiGet({action:'listSales'}); downloadCSV('sales_orders.csv', rows); }

/* ===== Plan CRUD ===== */
async function createOrderUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const p={
    '通知書番号':$('#c_tsuchi')?$('#c_tsuchi').value.trim():'', '得意先':$('#c_tokui')?$('#c_tokui').value.trim():'',
    '得意先品番':$('#c_tokui_hin')?$('#c_tokui_hin').value.trim():'', '製番号':$('#c_sei')?$('#c_sei').value.trim():'',
    '品名':$('#c_hinmei')?$('#c_hinmei').value.trim():'', '品番':$('#c_hinban')?$('#c_hinban').value.trim():'',
    '図番':$('#c_zuban')?$('#c_zuban').value.trim():'', '管理No':$('#c_kanri')?$('#c_kanri').value.trim():''
  };
  const editingPoEl=$('#c_po'); const editingPo=editingPoEl?editingPoEl.value.trim():'';
  try{
    if(editingPo){ await apiPost('updateOrder',{po_id:editingPo,updates:p,user:SESSION}); alert('編集保存しました'); }
    else{ const r=await apiPost('createOrder',{payload:p,user:SESSION}); alert('作成: '+r.po_id); if(editingPoEl) editingPoEl.value=r.po_id; }
    refreshAll();
  }catch(e){ alert(e.message||e); }
}
async function loadOrderForEdit(){
  const poEl=$('#c_po'); const po=poEl?poEl.value.trim():'';
  if(!po) return alert('注番入力');
  try{
    const o=await apiGet({action:'ticket',po_id:po});
    const set=(id,v)=>{ const el=$(id); if(el) el.value=v||''; };
    set('#c_tsuchi',o['通知書番号']); set('#c_tokui',o['得意先']); set('#c_tokui_hin',o['得意先品番']);
    set('#c_sei',o['製番号']); set('#c_hinmei',o['品名']); set('#c_hinban',o['品番']); set('#c_zuban',o['図番']); set('#c_kanri',o['管理No']);
    alert('読み込み完了。');
  }catch(e){ alert(e.message||e); }
}
async function deleteOrderUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const poEl=$('#c_po'); const po=poEl?poEl.value.trim():'';
  if(!po) return alert('注番入力'); if(!confirm('削除しますか？')) return;
  try{ const r=await apiPost('deleteOrder',{po_id:po,user:SESSION}); alert('削除:'+r.deleted); refreshAll(); }
  catch(e){ alert(e.message||e); }
}

/* ===== Ship CRUD ===== */
async function scheduleUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const poEl=$('#s_po'); const dateEl=$('#s_date'); const qtyEl=$('#s_qty'); const idEl=$('#s_shipid');
  const po = poEl?poEl.value.trim():'', dateIso=dateEl?dateEl.value:'', qty=qtyEl?qtyEl.value:'';
  if(!po||!dateIso) return alert('注番と日付');
  try{
    const shipId=idEl?idEl.value.trim():'';
    if(shipId){ await apiPost('updateShipment',{ship_id:shipId,updates:{po_id:po,scheduled_date:dateIso,qty:qty},user:SESSION}); alert('出荷予定を編集しました'); }
    else{ const r=await apiPost('scheduleShipment',{po_id:po,dateIso,qty,user:SESSION}); alert('登録: '+r.ship_id); }
    refreshAll(true);
  }catch(e){ alert(e.message||e); }
}
async function loadShipForEdit(){
  const idEl=$('#s_shipid'); const sid=idEl?idEl.value.trim():'';
  if(!sid) return alert('Ship ID入力');
  try{
    const d=await apiGet({action:'shipById',ship_id:sid});
    const set=(id,v)=>{ const el=$(id); if(el) el.value=v||''; };
    set('#s_po', d.shipment.po_id||'');
    set('#s_date', d.shipment.scheduled_date? new Date(d.shipment.scheduled_date).toISOString().slice(0,10):'');
    set('#s_qty', d.shipment.qty||0);
    alert('読み込み完了。');
  }catch(e){ alert(e.message||e); }
}
async function deleteShipUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const idEl=$('#s_shipid'); const sid=idEl?idEl.value.trim():'';
  if(!sid) return alert('Ship ID入力'); if(!confirm('削除しますか？')) return;
  try{ const r=await apiPost('deleteShipment',{ship_id:sid,user:SESSION}); alert('削除:'+r.deleted); refreshAll(true); }
  catch(e){ alert(e.message||e); }
}

/* ===== Docs ===== */
async function openTicket(po_id){
  try{
    const o=await apiGet({action:'ticket',po_id});
    const body=`<h3>生産現品票</h3><table>
      <tr><th>管理No</th><td>${o['管理No']||'-'}</td><th>通知書番号</th><td>${o['通知書番号']||'-'}</td></tr>
      <tr><th>得意先</th><td>${o['得意先']||''}</td><th>得意先品番</th><td>${o['得意先品番']||''}</td></tr>
      <tr><th>製番号</th><td>${o['製番号']||''}</td><th>投入日</th><td>${o['created_at']?new Date(o['created_at']).toLocaleDateString():'-'}</td></tr>
      <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
      <tr><th>工程</th><td colspan="3">${o.current_process||''}</td></tr>
      <tr><th>状態</th><td>${o.status||''}</td><th>更新</th><td>${fmtDT(o.updated_at)} / ${o.updated_by||''}</td></tr></table>`;
    showDoc('dlgTicket',body);
  }catch(e){ alert(e.message||e); }
}
function showShipDoc(s,o){
  const dt=s.scheduled_date? new Date(s.scheduled_date):null;
  const body=`<h3>出荷確認書</h3><table>
    <tr><th>得意先</th><td>${o['得意先']||''}</td><th>出荷日</th><td>${dt?dt.toLocaleDateString():'-'}</td></tr>
    <tr><th>注番(PO)</th><td>${o.po_id||s.po_id||''}</td><th>数量</th><td>${s.qty||0}</td></tr>
    <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
    <tr><th>状態</th><td>${o.status||''}</td><th>工程</th><td>${o.current_process||''}</td></tr>
  </table>`;
  showDoc('dlgShip', body);
}
async function openShipByPO(po){
  try{
    const d=await apiGet({action:'shipByPo',po_id:po});
    showShipDoc(d.shipment, d.order);
  }catch(e){ alert(e.message||e); }
}
async function openShipByID(id){
  try{
    const d=await apiGet({action:'shipById',ship_id:id});
    showShipDoc(d.shipment, d.order);
  }catch(e){ alert(e.message||e); }
}
function showDoc(id, html){
  const dlg=document.getElementById(id);
  if(!dlg) return;
  dlg.querySelector('.body').innerHTML=html;
  dlg.showModal();
}

/* ===== History ===== */
async function openHistory(po){
  const dlg=$('#dlgHistory'); if(!dlg) return;
  try{
    const h=await apiGet({action:'history',po_id:po});
    const body = Array.isArray(h)&&h.length ? h.map(x=>`
      <div class="row" style="justify-content:space-between;border-bottom:1px dashed var(--border);padding:.3rem 0">
        <div><b>${x.new_status||''}</b> / <span>${x.new_process||''}</span> <span class="muted s">(${x.note||''})</span></div>
        <div class="muted s">${fmtDT(x.timestamp)}・${x.updated_by||''}</div>
      </div>`).join('') : '<div class="muted">履歴がありません。</div>';
    dlg.querySelector('.body').innerHTML = `<h3>更新履歴（PO: ${po}）</h3><div id="histBody">${body}</div>`;
  }catch(e){
    dlg.querySelector('.body').innerHTML = `<h3>更新履歴（PO: ${po}）</h3><div class="muted">履歴API未対応：${e.message||e}</div>`;
  }
  dlg.showModal();
}

/* ===== QR Station ===== */
function openStationQR(){
  const dlg=$('#dlgStationQR'); if(!dlg) return;
  const wrap=$('#qrWrap'); if(!wrap) return;
  wrap.innerHTML='';
  const names = Object.keys(STATION_RULES);
  names.forEach(n=>{
    const d=document.createElement('div'); d.style.padding='6px';
    const el=document.createElement('div'); el.style.width='140px'; el.style.height='140px'; el.style.background='#fff'; el.style.border='1px solid var(--border)'; el.style.borderRadius='10px'; el.style.display='grid'; el.style.placeItems='center';
    d.appendChild(el); wrap.appendChild(d);
    new QRCode(el, {text:`ST:${n}`, width:120,height:120,correctLevel:QRCode.CorrectLevel.M});
    const cap=document.createElement('div'); cap.className='s muted'; cap.style.textAlign='center'; cap.style.marginTop='.4rem'; cap.textContent=n;
    d.appendChild(cap);
  });
  dlg.showModal();
}
function startScanFor(po_id){
  CURRENT_PO=po_id;
  const dlg=$('#dlgScan'); if(!dlg) return;
  $('#scanPO').textContent=po_id;
  $('#scanResult').textContent='';
  dlg.showModal();
}
const btnScanStartHandler = async ()=>{
  const video=$('#scanVideo'); const canvas=$('#scanCanvas'); const result=$('#scanResult');
  if(!video || !canvas) return;
  try{
    scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    video.srcObject=scanStream; await video.play();
    const ctx=canvas.getContext('2d');

    scanTimer = setInterval(async ()=>{
      if(video.readyState!==HTMLMediaElement.HAVE_ENOUGH_DATA) return;
      canvas.width=video.videoWidth; canvas.height=video.videoHeight;
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const imgData=ctx.getImageData(0,0,canvas.width,canvas.height);
      const code=jsQR(imgData.data, canvas.width, canvas.height);
      if(code && code.data){
        clearInterval(scanTimer); scanTimer=null;
        result.textContent='QR: '+code.data;
        try{
          if(!CURRENT_PO) throw new Error('PO不明');
          const order = await apiGet({action:'ticket',po_id:CURRENT_PO});
          const mark = String(code.data||'').replace(/^ST:/,'').trim();
          const rule = STATION_RULES[mark];
          if(!rule) throw new Error('工程QR不明: '+mark);
          const updates = rule(order);
          await apiPost('updateOrder',{po_id:CURRENT_PO,updates,user:SESSION});
          alert('更新OK: '+mark);
          refreshAll(true);
        }catch(err){ alert('更新失敗: '+(err.message||err)); }
      }
    }, 350);
  }catch(e){
    alert('カメラ起動失敗: '+(e.message||e));
  }
};
const btnScanCloseHandler = ()=>{
  const dlg=$('#dlgScan'); if(!dlg) return;
  if(scanTimer){ clearInterval(scanTimer); scanTimer=null; }
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
  dlg.close();
};
(function wireScanDialog(){
  const btnStart=$('#btnScanStart'); const btnClose=$('#btnScanClose');
  if(btnStart) btnStart.onclick = btnScanStartHandler;
  if(btnClose) btnClose.onclick = btnScanCloseHandler;
})();

/* ===== Inventory & Finished ===== */
async function renderInventory(){
  const qEl=$('#invQ'); const q=qEl? qEl.value.trim(): '';
  const rows=await apiGet({action:'listInventory',q});
  const tbody=$('#tbInv'); if(!tbody) return;
  tbody.innerHTML = rows.map(r=>{
    const stClass=STATUS_CLASS[r.status]||'st-begin';
    const prClass=PROC_CLASS[r.current_process]||'prc-out';
    return `<tr>
      <td><div class="row-main"><b>${r.po_id}</b><div class="row-sub"><div class="kv"><span class="muted">得意先:</span><b>${r['得意先']||''}</b></div></div></div></td>
      <td>${r['品名']||''}</td><td>${r['品番']||''}</td><td>${r['図番']||''}</td>
      <td><span class="badge ${stClass}"><span class="dot"></span>${r.status||''}</span></td>
      <td><span class="badge ${prClass}"><span class="dot"></span>${r.current_process||''}</span></td>
      <td class="s muted">${fmtDT(r.updated_at)}</td><td class="s muted">${r.updated_by||''}</td>
    </tr>`;
  }).join('');
}
async function renderFinished(){
  const qEl=$('#finQ'); const q=qEl? qEl.value.trim(): '';
  const rows=await apiGet({action:'listFinished',q});
  const tbody=$('#tbFin'); if(!tbody) return;
  tbody.innerHTML = rows.map(r=>{
    const stClass=STATUS_CLASS[r.status]||'st-begin';
    const prClass=PROC_CLASS[r.current_process]||'prc-out';
    return `<tr>
      <td><div class="row-main"><b>${r.po_id}</b><div class="row-sub"><div class="kv"><span class="muted">得意先:</span><b>${r['得意先']||''}</b></div></div></div></td>
      <td>${r['品名']||''}</td><td>${r['品番']||''}</td><td>${r['図番']||''}</td>
      <td><span class="badge ${stClass}"><span class="dot"></span>${r.status||''}</span></td>
      <td><span class="badge ${prClass}"><span class="dot"></span>${r.current_process||''}</span></td>
      <td class="s muted">${fmtDT(r.updated_at)}</td><td class="s muted">${r.updated_by||''}</td>
    </tr>`;
  }).join('');
}

/* ===== Invoice ===== */
async function previewInvoiceUI(){
  const customer=$('#inv_customer')?.value||'';
  const from=$('#inv_from')?.value; const to=$('#inv_to')?.value;
  if(!from||!to) return alert('期間自・期間至を入力してください');
  try{
    const p=await apiGet({action:'previewInvoice',customer,from,to});
    INV_PREVIEW.info = {
      得意先: p.info.得意先||customer, 期間自: from, 期間至: to,
      請求日: $('#inv_date')?.value||new Date().toISOString().slice(0,10),
      通貨: $('#inv_currency')?.value||'JPY',
      メモ: $('#inv_memo')?.value||''
    };
    INV_PREVIEW.lines = (p.lines||[]).map(l=>({
      行No:l.行No, 品名:l.品名, 品番:l.品番, 図番:l.図番,
      数量:Number(l.数量||0), 単価:Number(l.単価||0), 金額:Number(l.金額||0),
      POs:l.POs||'', 出荷IDs:l.出荷IDs||''
    }));
    renderInvoiceLines();
  }catch(e){ alert(e.message||e); }
}
function renderInvoiceLines(){
  const tb=$('#invLines'); if(!tb) return;
  let sub=0;
  tb.innerHTML = INV_PREVIEW.lines.map((l,i)=>{
    const amt = Number(l.数量||0)*Number(l.単価||0); sub += amt;
    return `<tr>
      <td>${i+1}</td>
      <td>${l.品名||''}</td>
      <td>${l.品番||''}</td>
      <td>${l.図番||''}</td>
      <td>${l.数量||0}</td>
      <td contenteditable="true" data-idx="${i}" oninput="editInvPrice(event)">${l.単価||0}</td>
      <td>${amt||0}</td>
      <td class="s">${l.POs||''}</td>
      <td class="s">${l.出荷IDs||''}</td>
    </tr>`;
  }).join('');
  const tax=Math.round(sub*0.1), total=sub+tax;
  $('#invSub').textContent=sub; $('#invTax').textContent=tax; $('#invTotal').textContent=total;
}
function editInvPrice(e){
  const idx=Number(e.target.dataset.idx);
  const v = Number(String(e.target.textContent||'0').replace(/[^\d.]/g,''))||0;
  INV_PREVIEW.lines[idx].単価=v;
  renderInvoiceLines();
}
async function createInvoiceUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  if(!INV_PREVIEW.info || !INV_PREVIEW.lines.length) return alert('先に「集計（出荷済）」を押してください');
  try{
    const payload = { info: {
      得意先: INV_PREVIEW.info.得意先, 請求日: $('#inv_date')?.value||INV_PREVIEW.info.請求日,
      期間自: INV_PREVIEW.info.期間自, 期間至: INV_PREVIEW.info.期間至, 通貨: $('#inv_currency')?.value||INV_PREVIEW.info.通貨, メモ: $('#inv_memo')?.value||INV_PREVIEW.info.メモ
    }, lines: INV_PREVIEW.lines.map(l=>({
      行No:l.行No, 品名:l.品名, 品番:l.品番, 図番:l.図番, 数量:l.数量, 単価:l.単価, 金額:l.数量*l.単価, POs:l.POs, 出荷IDs:l.出荷IDs
    }))};
    const r=await apiPost('createInvoice',{payload,user:SESSION});
    INV_PREVIEW.inv_id=r.inv_id;
    alert(`請求書発行: ${r.inv_id}\n合計: ${r.合計}`);
  }catch(e){ alert(e.message||e); }
}
async function openInvoiceDoc(inv_id){
  if(!inv_id) return alert('請求書IDがありません');
  try{
    const d=await apiGet({action:'invoiceDoc',inv_id});
    const inv=d.inv, lines=d.lines||[];
    const body = `<h3>請求書 ${inv.inv_id}</h3>
      <table>
        <tr><th>得意先</th><td>${inv['得意先']||''}</td><th>請求日</th><td>${fmtD(inv['請求日'])}</td></tr>
        <tr><th>期間</th><td colspan="3">${fmtD(inv['期間自'])} 〜 ${fmtD(inv['期間至'])}</td></tr>
        <tr><th>通貨</th><td>${inv['通貨']||'JPY'}</td><th>メモ</th><td>${inv['メモ']||''}</td></tr>
        <tr><th>小計</th><td>${inv['小計']||0}</td><th>税額</th><td>${inv['税額']||0}</td></tr>
        <tr><th>合計</th><td colspan="3"><b>${inv['合計']||0}</b></td></tr>
      </table>
      <h4 style="margin-top:.6rem">明細</h4>
      <table>
        <thead><tr><th>#</th><th>品名</th><th>品番</th><th>図番</th><th>数量</th><th>単価</th><th>金額</th><th>PO</th><th>出荷ID</th></tr></thead>
        <tbody>${lines.map(l=>`<tr><td>${l['行No']}</td><td>${l['品名']||''}</td><td>${l['品番']||''}</td><td>${l['図番']||''}</td><td>${l['数量']||0}</td><td>${l['単価']||0}</td><td>${l['金額']||0}</td><td>${l['PO']||''}</td><td>${l['出荷ID']||''}</td></tr>`).join('')}</tbody>
      </table>`;
    showDoc('dlgTicket', body);
  }catch(e){ alert(e.message||e); }
}
function exportInvoiceCSV(){
  if(!INV_PREVIEW.lines.length) return alert('明細なし');
  const rows = INV_PREVIEW.lines.map((l,i)=>({
    no:i+1, 品名:l.品名, 品番:l.品番, 図番:l.図番, 数量:l.数量, 単価:l.単価, 金額:l.数量*l.単価, POs:l.POs, 出荷IDs:l.出荷IDs
  }));
  downloadCSV('invoice_lines.csv', rows);
}

/* ===== Export CSV: Orders & TodayShip ===== */
async function exportOrdersCSV(){
  const rows=await apiGet({action:'listOrders'});
  downloadCSV('orders.csv', rows);
}
async function exportShipCSV(){
  const rows=await apiGet({action:'todayShip'});
  downloadCSV('today_shipments.csv', rows);
}

/* ===== Import (CSV/XLSX) ===== */
async function handleImport(e, type){
  const file = e.target.files?.[0];
  if(!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  try{
    let rows=[];
    if(ext==='csv'){
      const text = await file.text();
      rows = csvToObjects(text);
    }else{
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws);
    }
    if(!rows.length) return alert('データが空です。');
    if(type==='sales'){
      const r=await apiPost('importSales',{rows,user:SESSION,mode:'upsert'}); alert(`Sales: +${r.created} / ✎${r.updated}`); renderSales();
    }else if(type==='orders'){
      const r=await apiPost('importOrders',{rows,user:SESSION,mode:'upsert'}); alert(`Orders: +${r.created} / ✎${r.updated}`); refreshAll();
    }else if(type==='ship'){
      const r=await apiPost('importShipments',{rows,user:SESSION,mode:'upsert'}); alert(`Shipments: +${r.created} / ✎${r.updated}`); refreshAll(true);
    }
  }catch(err){ showApiError('import '+type, err); }
  e.target.value='';
}
function csvToObjects(csvText){
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  const head = lines[0].split(',').map(s=>s.trim());
  return lines.slice(1).map(line=>{
    const cols = line.split(','); const o={};
    head.forEach((h,i)=> o[h]=cols[i]);
    return o;
  });
}

/* ===== Charts ===== */
function ensureChartsLoaded(){ if(!chartsLoaded){ chartsLoaded=true; renderCharts(); } }
function fillChartYearSelector(){
  const sel=$('#chartYear'); if(!sel) return;
  const now=new Date().getFullYear();
  sel.innerHTML = Array.from({length:6},(_,i)=> now-4+i ).map(y=> `<option value="${y}" ${y===now?'selected':''}>${y}</option>`).join('');
}
async function renderCharts(){
  try{
    const d=await apiGet({action:'charts'});
    const year=d.year||new Date().getFullYear();
    const labels=Array.from({length:12},(_,i)=> (i+1)+'月');

    drawOrUpdateChart('chMonthly', 'bar', labels, d.perMonth||[], '月別出荷数量');
    drawOrUpdateChart('chCustomer', 'doughnut', Object.keys(d.perCust||{}), Object.values(d.perCust||{}), '得意先別出荷');
    drawOrUpdateChart('chStock', 'pie', Object.keys(d.stockBuckets||{}), Object.values(d.stockBuckets||{}), '在庫区分');
    drawOrUpdateChart('chWipProc', 'bar', Object.keys(d.wipByProcess||{}), Object.values(d.wipByProcess||{}), '工程内WIP');
    drawOrUpdateChart('chSales', 'line', labels, d.salesPerMonth||[], `営業 受注数 ${year}`);
    drawOrUpdateChart('chPlan', 'line', labels, d.planPerMonth||[], `生産計画 作成数 ${year}`);
  }catch(e){ console.warn(e); }
}
function drawOrUpdateChart(canvasId, type, labels, data, title){
  const ctx=document.getElementById(canvasId); if(!ctx) return;
  if(CHARTS[canvasId]){ CHARTS[canvasId].destroy(); }
  CHARTS[canvasId] = new Chart(ctx, {
    type,
    data: { labels, datasets: [{ label:title, data }] },
    options: {
      responsive:true,
      plugins:{
        legend:{ display: type!=='bar' },
        title:{ display:false }
      },
      scales: type==='bar' || type==='line' ? { y:{ beginAtZero:true } } : {}
    }
  });
}

/* ===== Auth ===== */
async function onLogin(){
  const u=$('#inUser')?$('#inUser').value.trim():'';
  const p=$('#inPass')?$('#inPass').value.trim():'';
  try{
    const r=await apiPost('login',{username:u,password:p});
    SESSION=r; localStorage.setItem('erp_session',JSON.stringify(r));
    enter();
  }catch(e){ alert(e.message||e); }
}
function openAddUserModal(){
  // diarahkan ke panel login card (sudah ada form Add User)
  document.getElementById('inUser')?.scrollIntoView({behavior:'smooth', block:'start'});
}
async function addUserFromLoginUI(){
  if(!SESSION) return alert('ログインしてください');
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術')) return alert('権限不足（生産技術）');
  const payload={
    username:$('#nuUser')?$('#nuUser').value.trim():'', password:$('#nuPass')?$('#nuPass').value.trim():'',
    full_name:$('#nuName')?$('#nuName').value.trim():'', department:$('#nuDept')?$('#nuDept').value:'', role:$('#nuRole')?$('#nuRole').value:'member'
  };
  if(!payload.username||!payload.password||!payload.full_name) return alert('必須項目');
  try{ await apiPost('createUser',{user:SESSION,payload}); alert('作成しました'); }
  catch(e){ alert(e.message||e); }
}
async function changePasswordUI(){
  if(!SESSION) return alert('ログインしてください');
  const oldPass=prompt('旧パスワード:'); if(oldPass===null) return;
  const newPass=prompt('新パスワード:'); if(newPass===null) return;
  try{
    await apiPost('changePassword',{user:SESSION,oldPass,newPass});
    alert('変更しました。再ログインしてください。');
    SESSION=null; localStorage.removeItem('erp_session'); location.reload();
  }catch(e){ alert(e.message||e); }
}

/* ===== Keyboard shortcuts inside dialogs ===== */
function dialogShortcuts(e){
  const anyOpen = Array.from(document.querySelectorAll('dialog')).some(d=> d.open);
  if(!anyOpen) return;
  const k = e.key.toLowerCase();
  if(k==='e'){ // export
    // prioritas invoice CSV atau export button lain
    if($('#dlgTicket')?.open && $('#btnInvCSV')){ $('#btnInvCSV').click(); return; }
    if($('#btnShipExport') && !$('#pageShip')?.classList.contains('hidden')){ $('#btnShipExport').click(); return; }
    if($('#btnExportOrders') && !$('#pageDash')?.classList.contains('hidden')){ $('#btnExportOrders').click(); return; }
  }else if(k==='r'){ // reset filter (tanggal/keyword)
    const inputs = document.querySelectorAll('dialog input[type="date"], dialog input[type="text"]');
    inputs.forEach(i=> i.value='');
  }
}

/* ===== CSV download util ===== */
function downloadCSV(filename, rows){
  const esc = (v)=> {
    if(v==null) return '';
    const s=String(v).replace(/"/g,'""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  };
  const cols = Array.from(rows.reduce((set,r)=>{ Object.keys(r).forEach(k=>set.add(k)); return set; }, new Set()));
  const lines = [cols.join(',')].concat(rows.map(r=> cols.map(c=> esc(r[c])).join(',')));
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ===== Expose some funcs to window (for inline onclick) ===== */
window.openTicket = openTicket;
window.startScanFor = startScanFor;
window.openHistory = openHistory;
window.openShipByPO = openShipByPO;
window.openShipByID = openShipByID;
window.editInvPrice = editInvPrice;

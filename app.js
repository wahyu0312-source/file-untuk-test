/* =========================================================
 * app.js — Tokyo Seimitsu ERP (Frontend)
 * - Setting terpadu (工程QR / ユーザー追加 / パス変更 / ログアウト)
 * - Import CSV/Excel untuk 受注・生産計画・出荷予定
 * - Halaman 在庫 & 完成品一覧
 * - Pewarnaan 状況/工程, operasi 2-baris, layout responsif
 * - Performa: lazy charts, minimal reflow, caching session
 * - History modal: filter tanggal + Export CSV + badge warna + hotkeys (E,R)
 * ========================================================= */

/* ===== Config ===== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwnU2BvQ6poO4EmMut3g5Zuu_cuojNbTmM8oRSCyNJDwm_38VgS7BhsFLKU0eoUt-BAKw/exec"; // << GANTI ke WebApp URL Anda
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
const fmtD = (s)=> s? new Date(s).toLocaleDateString(): '';

let SESSION=null, CURRENT_PO=null, scanStream=null, scanTimer=null;
let INV_PREVIEW={info:null, lines:[], inv_id:null};
let chartsLoaded=false;
let _charts = { monthly:null, customer:null, stock:null, wip:null, sales:null, plan:null };

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
  const res=await fetch(API_BASE,{ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
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

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  // Nav
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
  if(btnLogoutMenu)btnLogoutMenu.onclick= ()=>{ SESSION=null; localStorage.removeItem('erp_session'); location.reload(); };

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

  // Restore session
  const saved=localStorage.getItem('erp_session');
  if(saved){ SESSION=JSON.parse(saved); enter(); } else { show('authView'); }
});

/* ===== Small utils ===== */
function debounce(fn, ms=150){
  let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,args), ms); };
}

/* ===== UI helpers ===== */
function show(id){
  // hide semua page
  const ids=['authView','pageDash','pageSales','pagePlan','pageShip','pageInvoice','pageCharts','pageInventory','pageFinished'];
  ids.forEach(x=>{ const el=document.getElementById(x); if(el) el.classList.add('hidden'); });
  const target=document.getElementById(id);
  if(target) target.classList.remove('hidden');

  // map page -> tombol
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

  // reset active
  ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvPage','btnToFinPage','btnToInvoice','btnToCharts']
    .forEach(idBtn => { const b=document.getElementById(idBtn); if(b) b.classList.remove('active'); });

  // set active
  const btnId = map[id];
  if(btnId){ const b=document.getElementById(btnId); if(b) b.classList.add('active'); }
}

function showDoc(dlgId, innerHtml){
  const dlg=document.getElementById(dlgId);
  if(!dlg) return;
  const body = dlg.querySelector('.body');
  if(body) body.innerHTML = innerHtml;
  if(typeof dlg.showModal==='function') dlg.showModal(); else dlg.classList.remove('hidden');
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
  requestIdleCallback(()=> refreshAll(), {timeout:1200});
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

/* ===== Masters ===== */
async function loadMasters(){
  try{
    const m=await apiGet({action:'masters',types:'得意先,品名,品番,図番'});
    const fill=(id,arr)=>{ const el=$(id); if(el) el.innerHTML=(arr||[]).map(v=>`<option value="${v}"></option>`).join(''); };
    fill('#dl_tokui',m['得意先']); fill('#dl_hinmei',m['品名']); fill('#dl_hinban',m['品番']); fill('#dl_zuban',m['図番']);
  }catch(e){ console.warn(e); }
}

/* ===== Dashboard (tanpa charts) ===== */
async function refreshAll(keep=false){
  try{
    const s=await apiGet({action:'stock'});
    const statFinished=$('#statFinished'), statReady=$('#statReady'), statShipped=$('#statShipped');
    if(statFinished) statFinished.textContent=s.finishedStock;
    if(statReady) statReady.textContent=s.ready;
    if(statShipped) statShipped.textContent=s.shipped;

    const today=await apiGet({action:'todayShip'});
    const listToday=$('#listToday');
    if(listToday){
      listToday.innerHTML = today.length ? today.map(r=>`<div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join('') : '<div class="muted">本日予定なし</div>';
    }

    const loc=await apiGet({action:'locSnapshot'});
    const grid=$('#gridProc');
    if(grid) grid.innerHTML = PROCESSES.map(p=> `<div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>`).join('');

    if(!keep){ const q=$('#searchQ'); if(q) q.value=''; }
    await renderOrders();
    await renderSales();
  }catch(e){ console.error(e); }
}

/* ===== Orders table ===== */
async function listOrders(){
  const qEl=$('#searchQ'); const q = qEl ? qEl.value.trim() : '';
  return apiGet({action:'listOrders',q});
}
async function renderOrders(){
  const tbody=$('#tbOrders'); if(!tbody) return;
  const rows=await listOrders();
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
  const tbody=$('#tbSales'); if(!tbody) return;
  const qEl=$('#salesQ'); const q=(qEl&&qEl.value)? qEl.value.trim():'';
  const rows=await apiGet({action:'listSales',q});
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
    <tr><th>PO</th><td>${s.po_id||''}</td><th>数量</th><td>${s.qty||0}</td></tr>
    <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
    <tr><th>状態</th><td>${o.status||''}</td><th>工程</th><td>${o.current_process||''}</td></tr>
  </table>`;
  showDoc('dlgShip', body);
}
async function openShipByPO(po){
  try{
    const r=await apiGet({action:'shipByPo',po});
    showShipDoc(r.shipment, r.order);
  }catch(e){ alert(e.message||e); }
}
async function openShipByID(ship_id){
  try{
    const r=await apiGet({action:'shipById',ship_id});
    showShipDoc(r.shipment, r.order);
  }catch(e){ alert(e.message||e); }
}

/* =========================================================
 * History Modal — Figma Deluxe
 * - Filter tanggal + Export CSV + Badge warna + Hotkeys (E,R)
 * ========================================================= */
let HIST_CACHE = [];   // cache rows dari API (semua waktu)
let HIST_PO = null;    // po_id aktif di modal history
let HIST_HOTKEY_HANDLER = null;

function ymd(d){
  if(!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if(isNaN(dt)) return '';
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const dd = String(dt.getDate()).padStart(2,'0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
function parseDateOnly(s){
  if(!s) return null;
  const [y,m,d] = s.split('-').map(Number);
  if(!y||!m||!d) return null;
  return new Date(y, m-1, d);
}
function isBetween(ts, fromStr, toStr){
  if(!ts) return false;
  const t = (ts instanceof Date) ? ts : new Date(ts);
  if(isNaN(t)) return false;
  if(!fromStr && !toStr) return true;
  if(fromStr && !toStr){
    const f = parseDateOnly(fromStr); if(!f) return true;
    return t >= f;
  }
  if(!fromStr && toStr){
    const tmax = parseDateOnly(toStr); if(!tmax) return true;
    const t1 = new Date(tmax.getFullYear(), tmax.getMonth(), tmax.getDate()+1);
    return t < t1;
  }
  const f = parseDateOnly(fromStr);
  const tmax = parseDateOnly(toStr);
  if(!f || !tmax) return true;
  const t1 = new Date(tmax.getFullYear(), tmax.getMonth(), tmax.getDate()+1);
  return t >= f && t < t1;
}
function getFilteredHistory(){
  const from = (document.getElementById('histFrom') || {}).value || '';
  const to   = (document.getElementById('histTo')   || {}).value || '';
  const rows = (HIST_CACHE||[]).filter(r => isBetween(r.timestamp, from, to));
  rows.sort((a,b)=>{
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
  return rows;
}
function badge(htmlText, className){
  return `<span class="badge ${className}"><span class="dot"></span><span>${htmlText||''}</span></span>`;
}
function renderHistoryList(){
  const listEl = document.getElementById('histList');
  const emptyEl = document.getElementById('histEmpty');
  if(!listEl) return;

  const rows = getFilteredHistory();

  if(!rows.length){
    if(emptyEl) emptyEl.classList.remove('hidden');
    listEl.innerHTML = '';
    return;
  }
  if(emptyEl) emptyEl.classList.add('hidden');

  listEl.innerHTML = rows.map(r=>{
    // badge proses & status (pakai kelas yang ada)
    const procOldCls = PROC_CLASS[r.prev_process] || '';
    const procNewCls = PROC_CLASS[r.new_process] || '';
    const stOldCls   = STATUS_CLASS[r.prev_status] || '';
    const stNewCls   = STATUS_CLASS[r.new_status] || '';

    const procCell = (r.prev_process||'')
      ? `${badge(r.prev_process, procOldCls)} → ${badge(r.new_process||'', procNewCls)}`
      : (r.new_process ? badge(r.new_process, procNewCls) : '');

    const statCell = (r.prev_status||'')
      ? `${badge(r.prev_status, stOldCls)} → ${badge(r.new_status||'', stNewCls)}`
      : (r.new_status ? badge(r.new_status, stNewCls) : '');

    return `
    <tr>
      <td class="s muted">${r.timestamp? new Date(r.timestamp).toLocaleString() : '-'}</td>
      <td class="s">${r.updated_by||''}</td>
      <td>${procCell}</td>
      <td>${statCell}</td>
      <td class="s muted">${r.note||''}</td>
    </tr>`;
  }).join('');
}
function exportHistoryCSV(){
  const rows = getFilteredHistory();
  if(!rows.length){ alert('エクスポート対象データがありません'); return; }
  const flat = rows.map(r=>({
    時刻: r.timestamp ? new Date(r.timestamp).toLocaleString() : '',
    更新者: r.updated_by || '',
    旧工程: r.prev_process || '',
    新工程: r.new_process || '',
    旧状態: r.prev_status || '',
    新状態: r.new_status || '',
    メモ: r.note || '',
    PO: r.po_id || (HIST_PO||'')
  }));
  downloadCSV(`history_${HIST_PO||'PO'}.csv`, flat);
}
function attachHistoryHotkeys(){
  const dlg = document.getElementById('dlgHistory');
  const inFrom = document.getElementById('histFrom');
  const inTo   = document.getElementById('histTo');
  const resetBtn = document.getElementById('histReset');
  const expBtn   = document.getElementById('histExport');

  // hindari multiple attach
  if(HIST_HOTKEY_HANDLER) document.removeEventListener('keydown', HIST_HOTKEY_HANDLER);
  HIST_HOTKEY_HANDLER = (ev)=>{
    // abaikan jika fokus di input (biar user bisa ketik tanggal)
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if(tag === 'INPUT' || tag === 'TEXTAREA') return;

    // pastikan dialog terbuka
    if(!dlg || !dlg.open) return;

    if(ev.key === 'e' || ev.key === 'E'){
      ev.preventDefault();
      if(expBtn) expBtn.click();
    }else if(ev.key === 'r' || ev.key === 'R'){
      ev.preventDefault();
      if(inFrom) inFrom.value='';
      if(inTo) inTo.value='';
      renderHistoryList();
    }else if(ev.key === 'Escape'){
      // tutup dialog dengan ESC
      ev.preventDefault();
      if(typeof dlg.close === 'function') dlg.close();
    }
  };
  document.addEventListener('keydown', HIST_HOTKEY_HANDLER);

  // bersihkan saat dialog ditutup
  if(dlg){
    dlg.addEventListener('close', ()=>{
      if(HIST_HOTKEY_HANDLER){
        document.removeEventListener('keydown', HIST_HOTKEY_HANDLER);
        HIST_HOTKEY_HANDLER = null;
      }
    }, { once:true });
  }
}
async function openHistory(po_id){
  HIST_PO = po_id;
  const dlg = document.getElementById('dlgHistory');
  if(!dlg) return;

  // isi ulang header + toolbar filter + table
  const body = dlg.querySelector('.body');
  if(body) body.innerHTML = `
    <h3 class="row-between" style="margin-bottom:.6rem">
      <span>更新履歴 <span class="s muted">/ PO: ${po_id}</span></span>
      <div class="row gap">
        <input id="histFrom" type="date" class="input s" style="width:145px" />
        <span class="s muted">〜</span>
        <input id="histTo"   type="date" class="input s" style="width:145px" />
        <button id="histReset" class="btn ghost s" title="R"><i class="fa-solid fa-rotate"></i> クリア</button>
        <button id="histExport" class="btn ghost s" title="E"><i class="fa-solid fa-file-csv"></i> CSV</button>
      </div>
    </h3>
    <div id="histEmpty" class="muted" style="margin:.5rem 0;">該当データがありません</div>
    <div class="table-wrap">
      <table class="table s">
        <thead>
          <tr>
            <th style="width:170px">時刻</th>
            <th style="width:110px">更新者</th>
            <th>工程</th>
            <th>状態</th>
            <th style="width:24%">メモ</th>
          </tr>
        </thead>
        <tbody id="histList"></tbody>
      </table>
    </div>
    <div class="s muted" style="margin-top:.4rem">ショートカット: <b>E</b>=CSV エクスポート、<b>R</b>=フィルタリセット、<b>Esc</b>=閉じる</div>
  `;

  // default rentang: 30 hari terakhir
  const today = new Date();
  const d30   = new Date(today.getFullYear(), today.getMonth(), today.getDate()-30);
  const inFrom = document.getElementById('histFrom');
  const inTo   = document.getElementById('histTo');
  if(inFrom) inFrom.value = ymd(d30);
  if(inTo)   inTo.value   = ymd(today);

  // ambil data
  try{
    const rows = await apiGet({action:'history', po_id});
    HIST_CACHE = Array.isArray(rows) ? rows : [];
  }catch(e){
    HIST_CACHE = [];
    const warn = document.getElementById('histEmpty');
    if(warn) warn.innerHTML = `履歴APIが未実装です。Apps Script に <code>getHistory_()</code> を追加してください。`;
  }

  // event handlers
  const resetBtn = document.getElementById('histReset');
  const expBtn   = document.getElementById('histExport');

  if(inFrom) inFrom.addEventListener('change', renderHistoryList);
  if(inTo)   inTo.addEventListener('change', renderHistoryList);
  if(resetBtn){
    resetBtn.onclick = ()=>{
      if(inFrom) inFrom.value = '';
      if(inTo)   inTo.value   = '';
      renderHistoryList();
    };
  }
  if(expBtn) expBtn.onclick = exportHistoryCSV;

  // render & tampilkan + hotkeys
  renderHistoryList();
  attachHistoryHotkeys();
  if(typeof dlg.showModal==='function') dlg.showModal(); else dlg.classList.remove('hidden');
}

/* ===== QR Scan (jsQR) ===== */
async function startScanFor(po_id){
  CURRENT_PO = po_id;
  const dlg = document.getElementById('dlgScan'); if(!dlg) return;
  const span = document.getElementById('scanPO'); if(span) span.textContent = po_id;
  const btnStart = document.getElementById('btnScanStart');
  const btnClose = document.getElementById('btnScanClose');
  const video = document.getElementById('scanVideo');
  const canvas = document.getElementById('scanCanvas');
  const result = document.getElementById('scanResult');

  result.innerHTML='';
  dlg.showModal();

  const stop = async ()=>{
    try{
      if(scanTimer){ cancelAnimationFrame(scanTimer); scanTimer=null; }
      if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
    }catch(_){}
  };
  btnClose.onclick = ()=>{ stop(); dlg.close(); };

  btnStart.onclick = async ()=>{
    try{
      await stop();
      scanStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
      video.srcObject = scanStream;
      await video.play();

      const ctx = canvas.getContext('2d');

      const loop = async ()=>{
        if(!video.videoWidth){ scanTimer=requestAnimationFrame(loop); return; }
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if(code && code.data){
          const text = (code.data||'').trim();
          result.innerHTML = `<b>QR:</b> ${text}`;
          if(text.startsWith('ST:')){
            const stationName = text.slice(3).trim();
            try{
              const o = await apiGet({action:'ticket', po_id: CURRENT_PO});
              const rule = STATION_RULES[stationName];
              if(!rule){ alert('未知の工程: '+stationName); }
              else{
                const updates = rule(o);
                await apiPost('updateOrder',{ po_id: CURRENT_PO, updates:{...updates, note:`QR:${stationName}`}, user: SESSION });
                alert('更新しました');
                await refreshAll(true);
              }
            }catch(e){ alert(e.message||e); }
          }
        }
        scanTimer = requestAnimationFrame(loop);
      };
      loop();
    }catch(e){
      alert('カメラにアクセスできません：'+(e.message||e));
    }
  };
}

/* ===== Station QR ===== */
function openStationQR(){
  const dlg = document.getElementById('dlgStationQR'); if(!dlg) return;
  const wrap = document.getElementById('qrWrap'); if(!wrap) return;
  wrap.innerHTML='';
  const names = [
    'レーザ加工','曲げ工程','外枠組立','シャッター組立','シャッター溶接','コーキング',
    '外枠塗装','組立工程','検査工程','出荷工程'
  ];
  names.forEach(n=>{
    const cell=document.createElement('div'); cell.style.padding='8px'; cell.style.border='1px solid var(--border)'; cell.style.borderRadius='12px';
    const title=document.createElement('div'); title.textContent=n; title.className='s'; title.style.marginBottom='6px';
    const div=document.createElement('div');
    new QRCode(div,{text:'ST:'+n, width:128, height:128, correctLevel: QRCode.CorrectLevel.M});
    cell.appendChild(title); cell.appendChild(div);
    wrap.appendChild(cell);
  });
  dlg.showModal();
}
function openAddUserModal(){
  window.scrollTo({top:0, behavior:'smooth'});
  alert('ログインカードの「管理者: ユーザー追加」セクションをご利用ください。');
}

/* ===== Inventory & Finished ===== */
async function renderInventory(){
  const tbody=$('#tbInv'); if(!tbody) return;
  const qEl=$('#invQ'); const q=(qEl&&qEl.value)? qEl.value.trim():'';
  const rows=await apiGet({action:'listInventory', q});
  tbody.innerHTML = rows.map(r=>{
    const stClass=STATUS_CLASS[r.status]||'st-begin'; const prClass=PROC_CLASS[r.current_process]||'prc-out';
    return `<tr>
      <td><b>${r.po_id}</b><div class="s muted">${r['得意先']||'-'}</div></td>
      <td>${r['品名']||''}</td><td>${r['品番']||''}</td><td>${r['図番']||''}</td>
      <td><span class="badge ${stClass}"><span class="dot"></span>${r.status||''}</span></td>
      <td><span class="badge ${prClass}"><span class="dot"></span>${r.current_process||''}</span></td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
    </tr>`;
  }).join('');
}
async function renderFinished(){
  const tbody=$('#tbFin'); if(!tbody) return;
  const qEl=$('#finQ'); const q=(qEl&&qEl.value)? qEl.value.trim():'';
  const rows=await apiGet({action:'listFinished', q});
  tbody.innerHTML = rows.map(r=>{
    const stClass=STATUS_CLASS[r.status]||'st-ready'; const prClass=PROC_CLASS[r.current_process]||'prc-inspect';
    return `<tr>
      <td><b>${r.po_id}</b><div class="s muted">${r['得意先']||'-'}</div></td>
      <td>${r['品名']||''}</td><td>${r['品番']||''}</td><td>${r['図番']||''}</td>
      <td><span class="badge ${stClass}"><span class="dot"></span>${r.status||''}</span></td>
      <td><span class="badge ${prClass}"><span class="dot"></span>${r.current_process||''}</span></td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
    </tr>`;
  }).join('');
}

/* ===== Invoice ===== */
function recalcInvoiceTotals(){
  let subtotal = 0;
  INV_PREVIEW.lines.forEach((l,i)=>{
    const inId = `inv_line_price_${i}`;
    const el = document.getElementById(inId);
    const price = Number(el && el.value ? el.value : 0);
    l['単価'] = price;
    l['金額'] = Number(l['数量']||0) * price;
    const cellAmt = document.getElementById(`inv_amount_${i}`);
    if(cellAmt) cellAmt.textContent = l['金額'];
    subtotal += l['金額'];
  });
  const tax = Math.round(subtotal*0.1);
  const total = subtotal + tax;
  const subEl=$('#invSub'), taxEl=$('#invTax'), totEl=$('#invTotal');
  if(subEl) subEl.textContent = subtotal;
  if(taxEl) taxEl.textContent = tax;
  if(totEl) totEl.textContent = total;
}
function renderInvoiceLines(){
  const tbody = $('#invLines'); if(!tbody) return;
  tbody.innerHTML = INV_PREVIEW.lines.map((l,i)=>`
    <tr>
      <td>${l['行No']||i+1}</td>
      <td>${l['品名']||''}</td>
      <td>${l['品番']||''}</td>
      <td>${l['図番']||''}</td>
      <td>${l['数量']||0}</td>
      <td><input id="inv_line_price_${i}" type="number" min="0" value="${l['単価']||0}" style="width:110px" onchange="recalcInvoiceTotals()"></td>
      <td id="inv_amount_${i}">${l['金額']||0}</td>
      <td class="s muted">${l['POs']||''}</td>
      <td class="s muted">${l['出荷IDs']||''}</td>
    </tr>
  `).join('');
  recalcInvoiceTotals();
}
async function previewInvoiceUI(){
  const customer = $('#inv_customer')?$('#inv_customer').value.trim():'';
  const from = $('#inv_from')?$('#inv_from').value:'';
  const to = $('#inv_to')?$('#inv_to').value:'';
  if(!from || !to) return alert('期間（自/至）を入力してください');
  try{
    const r = await apiGet({action:'previewInvoice', customer, from, to});
    INV_PREVIEW.info = {
      得意先: customer || (r.info?.得意先||''),
      期間自: r.info?.期間自, 期間至: r.info?.期間至,
      請求日: $('#inv_date')?$('#inv_date').value:'',
      通貨: $('#inv_currency')?$('#inv_currency').value||'JPY':'JPY',
      メモ: $('#inv_memo')?$('#inv_memo').value:''
    };
    INV_PREVIEW.lines = (r.lines||[]).map(x=>({...x, 単価:x.単価||0, 金額:x.金額||0}));
    INV_PREVIEW.inv_id = null;
    renderInvoiceLines();
    alert(`集計完了：明細 ${INV_PREVIEW.lines.length} 行`);
  }catch(e){ alert(e.message||e); }
}
async function createInvoiceUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  if(!INV_PREVIEW.info || !INV_PREVIEW.lines.length) return alert('先に「集計（出荷済）」を実行してください');
  try{
    recalcInvoiceTotals();
    const payload = {
      info: {
        得意先: $('#inv_customer')?$('#inv_customer').value.trim():(INV_PREVIEW.info.得意先||''),
        期間自: $('#inv_from')?$('#inv_from').value: INV_PREVIEW.info.期間自,
        期間至: $('#inv_to')?$('#inv_to').value: INV_PREVIEW.info.期間至,
        請求日: $('#inv_date')?$('#inv_date').value: INV_PREVIEW.info.請求日,
        通貨: $('#inv_currency')?$('#inv_currency').value: (INV_PREVIEW.info.通貨||'JPY'),
        メモ: $('#inv_memo')?$('#inv_memo').value: (INV_PREVIEW.info.メモ||'')
      },
      lines: INV_PREVIEW.lines
    };
    const res = await apiPost('createInvoice', { payload, user: SESSION });
    INV_PREVIEW.inv_id = res.inv_id;
    alert(`請求書発行：${res.inv_id}\n合計: ${res.合計}`);
  }catch(e){ alert(e.message||e); }
}
async function openInvoiceDoc(inv_id){
  if(!inv_id){ alert('請求書IDが不明です（発行後にもう一度お試しください）'); return; }
  try{
    const {inv, lines} = await apiGet({action:'invoiceDoc', inv_id});
    const body = `
      <h3>請求書</h3>
      <table>
        <tr><th>請求書ID</th><td>${inv.inv_id}</td><th>請求日</th><td>${fmtD(inv['請求日'])}</td></tr>
        <tr><th>得意先</th><td>${inv['得意先']||''}</td><th>期間</th><td>${fmtD(inv['期間自'])} 〜 ${fmtD(inv['期間至'])}</td></tr>
        <tr><th>金額</th><td colspan="3">小計 ${inv['小計']} / 税額 ${inv['税額']} / 合計 <b>${inv['合計']}</b> ${inv['通貨']||'JPY'}</td></tr>
      </table>
      <h4 style="margin-top:10px">明細</h4>
      <table>
        <thead><tr><th>#</th><th>品名</th><th>品番</th><th>図番</th><th>数量</th><th>単価</th><th>金額</th><th>PO</th><th>出荷ID</th></tr></thead>
        <tbody>
          ${lines.map(l=>`<tr>
            <td>${l['行No']}</td><td>${l['品名']||''}</td><td>${l['品番']||''}</td><td>${l['図番']||''}</td>
            <td>${l['数量']||0}</td><td>${l['単価']||0}</td><td>${l['金額']||0}</td>
            <td>${l['PO']||''}</td><td>${l['出荷ID']||''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    showDoc('dlgShip', body); // reuse dialog
  }catch(e){ alert(e.message||e); }
}
function exportInvoiceCSV(){
  if(!INV_PREVIEW.lines || !INV_PREVIEW.lines.length){ alert('明細がありません'); return; }
  const rows = INV_PREVIEW.lines.map(l=>({
    行No: l['行No']||'',
    品名: l['品名']||'',
    品番: l['品番']||'',
    図番: l['図番']||'',
    数量: l['数量']||0,
    単価: l['単価']||0,
    金額: l['金額']||0,
    POs: l['POs']||'',
    出荷IDs: l['出荷IDs']||''
  }));
  downloadCSV('invoice_lines.csv', rows);
}

/* ===== Import & Export ===== */
function toCSV(rows){
  if(!rows || !rows.length) return '';
  const head = Object.keys(rows[0]);
  const esc = s=> `"${String(s??'').replace(/"/g,'""')}"`;
  const lines = [ head.join(',') ];
  rows.forEach(r=> lines.push(head.map(h=> esc(r[h])).join(',')));
  return lines.join('\n');
}
function downloadCSV(filename, rows){
  const csv = toCSV(rows||[]);
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display='none';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
}
async function exportOrdersCSV(){ const rows=await apiGet({action:'listOrders'}); downloadCSV('production_orders.csv', rows); }
async function exportShipCSV(){
  try{
    const rows=await apiGet({action:'todayShip'});
    downloadCSV('shipments_today.csv', rows);
  }catch(e){ alert(e.message||e); }
}
async function handleImport(e, type){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const ext = (file.name.split('.').pop()||'').toLowerCase();
  const asObjects = async ()=>{
    if(ext==='csv'){
      const text = await file.text();
      const wb = XLSX.read(text, {type:'string'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, {defval:''});
    }else{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, {defval:''});
    }
  };
  try{
    const rows = await asObjects();
    if(!rows.length) return alert('空データ');
    if(type==='sales'){
      const r=await apiPost('importSales',{ rows, user:SESSION, mode:'upsert' });
      alert(`Sales インポート: 追加 ${r.created}, 更新 ${r.updated}`); renderSales();
    }else if(type==='orders'){
      const r=await apiPost('importOrders',{ rows, user:SESSION, mode:'upsert' });
      alert(`Orders インポート: 追加 ${r.created}, 更新 ${r.updated}`); refreshAll(true);
    }else if(type==='ship'){
      const r=await apiPost('importShipments',{ rows, user:SESSION, mode:'upsert' });
      alert(`Shipments インポート: 追加 ${r.created}, 更新 ${r.updated}`); refreshAll(true);
    }
  }catch(err){
    showApiError('import-'+type, err);
    alert(err.message||err);
  }finally{
    e.target.value='';
  }
}

/* ===== Charts (Chart.js) ===== */
function ensureChartsLoaded(){
  if(chartsLoaded){ renderCharts(); return; }
  chartsLoaded=true;
  renderCharts();
}
function destroyChart(ref){ try{ if(ref && typeof ref.destroy==='function') ref.destroy(); }catch(_){ } }
async function renderCharts(){
  let data=null;
  try{
    data = await apiGet({action:'charts'});
  }catch(e){
    showApiError('charts', e);
    return;
  }
  const ym = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  const elM = document.getElementById('chMonthly');
  if(elM){
    destroyChart(_charts.monthly);
    _charts.monthly = new Chart(elM.getContext('2d'), {
      type:'bar',
      data:{ labels: ym, datasets:[{ label:'出荷数量', data: data.perMonth||[] }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
  const elC = document.getElementById('chCustomer');
  if(elC){
    const labels = Object.keys(data.perCust||{});
    const values = labels.map(k=> data.perCust[k]);
    destroyChart(_charts.customer);
    _charts.customer = new Chart(elC.getContext('2d'), {
      type:'doughnut',
      data:{ labels, datasets:[{ label:'数量', data: values }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
  const elS = document.getElementById('chStock');
  if(elS){
    const labels = Object.keys(data.stockBuckets||{});
    const values = labels.map(k=> data.stockBuckets[k]);
    destroyChart(_charts.stock);
    _charts.stock = new Chart(elS.getContext('2d'), {
      type:'bar',
      data:{ labels, datasets:[{ label:'在庫数', data: values }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
  const elW = document.getElementById('chWipProc');
  if(elW){
    const labels = Object.keys(data.wipByProcess||{});
    const values = labels.map(k=> data.wipByProcess[k]);
    destroyChart(_charts.wip);
    _charts.wip = new Chart(elW.getContext('2d'), {
      type:'bar',
      data:{ labels, datasets:[{ label:'WIP', data: values }] },
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false }
    });
  }
  const elSa = document.getElementById('chSales');
  if(elSa){
    destroyChart(_charts.sales);
    _charts.sales = new Chart(elSa.getContext('2d'), {
      type:'line',
      data:{ labels: ym, datasets:[{ label:'受注数', data: data.salesPerMonth||[] }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
  const elP = document.getElementById('chPlan');
  if(elP){
    destroyChart(_charts.plan);
    _charts.plan = new Chart(elP.getContext('2d'), {
      type:'line',
      data:{ labels: ym, datasets:[{ label:'計画作成数', data: data.planPerMonth||[] }] },
      options:{ responsive:true, maintainAspectRatio:false }
    });
  }
}
function fillChartYearSelector(){
  const sel = document.getElementById('chartYear'); if(!sel) return;
  const y = new Date().getFullYear();
  sel.innerHTML = [y-2,y-1,y].map(v=> `<option value="${v}" ${v===y?'selected':''}>${v}</option>`).join('');
  sel.title = '※ 現在は当年のみ対応（集計はサーバの今年データ）';
}

/* ===== Misc ===== */
function fmtNumber(n){ return Number(n||0).toLocaleString(); }

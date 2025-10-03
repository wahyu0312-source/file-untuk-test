/* ===== Config ===== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwnU2BvQ6poO4EmMut3g5Zuu_cuojNbTmM8oRSCyNJDwm_38VgS7BhsFLKU0eoUt-BAKw/exec";  // << GANTI jika perlu
const API_KEY  = ""; // optional

const PROCESSES = [
  'レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング',
  '外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程'
];

/* ===== Station toggle rules ===== */
const STATION_RULES = {
  'レーザ加工':      (o)=> ({ current_process:'レーザ加工' }),
  '曲げ工程':        (o)=> ({ current_process:'曲げ加工' }),
  '外枠組立':        (o)=> ({ current_process:'外枠組立' }),
  'シャッター組立':  (o)=> ({ current_process:'シャッター組立' }),
  'シャッター溶接':  (o)=> ({ current_process:'シャッター溶接' }),
  'コーキング':      (o)=> ({ current_process:'コーキング' }),
  '外枠塗装':        (o)=> ({ current_process:'外枠塗装' }),
  '組立工程':        (o)=> (o.current_process==='組立（組立中）'
                        ? { current_process:'組立（組立済）' }
                        : { current_process:'組立（組立中）' }),
  '検査工程':        (o)=> (o.current_process==='検査工程' &&
                        !['検査保留','不良品（要リペア）','検査済'].includes(o.status)
                        ? { current_process:'検査工程', status:'検査済' }
                        : { current_process:'検査工程' }),
  '出荷工程':        (o)=> (o.status==='出荷準備'
                        ? { current_process:o.current_process||'検査工程', status:'出荷済' }
                        : { current_process:'検査工程', status:'出荷準備' })
};

const $    = (s)=> document.querySelector(s);
const fmtDT= (s)=> s? new Date(s).toLocaleString(): '';
const fmtD = (s)=> s? new Date(s).toLocaleDateString(): '';

let SESSION=null, CURRENT_PO=null, scanStream=null, scanTimer=null;
let INV_PREVIEW={info:null, lines:[]};

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
  'レーザ加工':'prc-laser',
  '曲げ加工':'prc-bend',
  '外枠組立':'prc-frame',
  'シャッター組立':'prc-shassy',
  'シャッター溶接':'prc-shweld',
  'コーキング':'prc-caulk',
  '外枠塗装':'prc-tosou',
  '組立（組立中）':'prc-asm-in',
  '組立（組立済）':'prc-asm-ok',
  '外注':'prc-out',
  '検査工程':'prc-inspect'
};

/* ===== API helpers ===== */
async function apiPost(action, body){
  const payload={action,...body};
  if(API_KEY) payload.apiKey=API_KEY;
  try{
    const res=await fetch(API_BASE,{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(payload)
    });
    const j=await res.json();
    if(!j.ok) throw new Error(j.error||'API error');
    return j.data;
  }catch(err){
    showApiError(action, err);
    throw err;
  }
}
async function apiGet(params){
  const url=API_BASE+'?'+new URLSearchParams(params).toString();
  try{
    const res=await fetch(url,{cache:'no-store'});
    const j=await res.json();
    if(!j.ok) throw new Error(j.error||'API error');
    return j.data;
  }catch(err){
    showApiError(params.action, err);
    throw err;
  }
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
  const btnToDash     = $('#btnToDash');
  const btnToSales    = $('#btnToSales');
  const btnToPlan     = $('#btnToPlan');
  const btnToShip     = $('#btnToShip');
  const btnToInvoice  = $('#btnToInvoice');
  const btnToCharts   = $('#btnToCharts');
  // NEW: Setting dropdown items
  const ddSetting     = $('#ddSetting');
  const miStationQR   = $('#miStationQR');
  const miAddUser     = $('#miAddUser');
  const miChangePass  = $('#miChangePass');

  if(btnToDash)    btnToDash.onclick    = ()=> show('pageDash');
  if(btnToSales)   btnToSales.onclick   = ()=> show('pageSales');
  if(btnToPlan)    btnToPlan.onclick    = ()=> show('pagePlan');
  if(btnToShip)    btnToShip.onclick    = ()=> show('pageShip');
  if(btnToInvoice) btnToInvoice.onclick = ()=> show('pageInvoice');
  if(btnToCharts)  btnToCharts.onclick  = ()=> { show('pageCharts'); ensureChartsLoaded(); };

  // Connect Setting menu
  if(miStationQR)  miStationQR.onclick  = openStationQR;
  if(miAddUser)    miAddUser.onclick    = openAddUserModal;
  if(miChangePass) miChangePass.onclick = changePasswordUI;

  // Auth
  const btnLogin      = $('#btnLogin');
  const btnNewUser    = $('#btnNewUser');
  const btnLogout     = $('#btnLogout');

  if(btnLogin)      btnLogin.onclick      = onLogin;
  if(btnNewUser)    btnNewUser.onclick    = addUserFromLoginUI;
  if(btnLogout)     btnLogout.onclick     = ()=>{ SESSION=null; localStorage.removeItem('erp_session'); location.reload(); };

  // Dashboard
  const btnRefresh = $('#btnRefresh');
  const searchQ    = $('#searchQ');
  const btnExportOrders = $('#btnExportOrders');
  if(btnRefresh)       btnRefresh.onclick       = refreshAll;
  if(searchQ)          searchQ.addEventListener('input', renderOrders);
  if(btnExportOrders)  btnExportOrders.onclick  = exportOrdersCSV;

  // Sales
  const btnSalesSave   = $('#btnSalesSave');
  const btnSalesDelete = $('#btnSalesDelete');
  const btnSalesExport = $('#btnSalesExport');
  const btnPromote     = $('#btnPromote');
  const btnSalesImport = $('#btnSalesImport'); // NEW
  const salesQ         = $('#salesQ');

  if(btnSalesSave)   btnSalesSave.onclick   = saveSalesUI;
  if(btnSalesDelete) btnSalesDelete.onclick = deleteSalesUI;
  if(btnSalesExport) btnSalesExport.onclick = exportSalesCSV;
  if(btnPromote)     btnPromote.onclick     = promoteSalesUI;
  if(btnSalesImport) btnSalesImport.onclick = ()=> openImportDialog('sales'); // NEW
  if(salesQ)         salesQ.addEventListener('input', renderSales);

  // Plan
  const btnCreateOrder = $('#btnCreateOrder');
  const btnPlanExport  = $('#btnPlanExport');
  const btnPlanEdit    = $('#btnPlanEdit');
  const btnPlanDelete  = $('#btnPlanDelete');
  const btnPlanImport  = $('#btnPlanImport'); // NEW

  if(btnCreateOrder) btnCreateOrder.onclick = createOrderUI;
  if(btnPlanExport)  btnPlanExport.onclick  = exportOrdersCSV;
  if(btnPlanEdit)    btnPlanEdit.onclick    = loadOrderForEdit;
  if(btnPlanDelete)  btnPlanDelete.onclick  = deleteOrderUI;
  if(btnPlanImport)  btnPlanImport.onclick  = ()=> openImportDialog('orders'); // NEW

  // Ship
  const btnSchedule    = $('#btnSchedule');
  const btnShipExport  = $('#btnShipExport');
  const btnShipEdit    = $('#btnShipEdit');
  const btnShipDelete  = $('#btnShipDelete');
  const btnShipByPO    = $('#btnShipByPO');
  const btnShipByID    = $('#btnShipByID');
  const btnShipImport  = $('#btnShipImport'); // NEW

  if(btnSchedule)   btnSchedule.onclick   = scheduleUI;
  if(btnShipExport) btnShipExport.onclick = exportShipCSV;
  if(btnShipEdit)   btnShipEdit.onclick   = loadShipForEdit;
  if(btnShipDelete) btnShipDelete.onclick = deleteShipUI;
  if(btnShipByPO)   btnShipByPO.onclick   = ()=>{ const po=$('#s_po').value.trim(); if(!po) return alert('注番入力'); openShipByPO(po); };
  if(btnShipByID)   btnShipByID.onclick   = ()=>{ const id=prompt('Ship ID:'); if(!id) return; openShipByID(id.trim()); };
  if(btnShipImport) btnShipImport.onclick = ()=> openImportDialog('ship'); // NEW

  // Scan
  const btnScanStart = $('#btnScanStart');
  const btnScanClose = $('#btnScanClose');
  if(btnScanStart) btnScanStart.onclick = scanStart;
  if(btnScanClose) btnScanClose.onclick = scanClose;

  // Invoice
  const btnInvPreview = $('#btnInvPreview');
  const btnInvCreate  = $('#btnInvCreate');
  const btnInvPrint   = $('#btnInvPrint');
  const btnInvCSV     = $('#btnInvCSV');

  if(btnInvPreview) btnInvPreview.onclick = previewInvoiceUI;
  if(btnInvCreate)  btnInvCreate.onclick  = createInvoiceUI;
  if(btnInvPrint)   btnInvPrint.onclick   = ()=> openInvoiceDoc(INV_PREVIEW.inv_id||'');
  if(btnInvCSV)     btnInvCSV.onclick     = exportInvoiceCSV;

  // Charts page
  const btnChartsRefresh = $('#btnChartsRefresh');
  if(btnChartsRefresh) btnChartsRefresh.onclick = renderCharts;
  fillChartYearSelector();

  // Import dialog bindings
  bindImportDialog(); // NEW

  // Restore session
  const saved=localStorage.getItem('erp_session');
  if(saved){ SESSION=JSON.parse(saved); enter(); } else { show('authView'); }
});

/* ===== UI ===== */
function show(id){
  const ids=['authView','pageDash','pageSales','pagePlan','pageShip','pageInvoice','pageCharts'];
  ids.forEach(x=>{
    const el=document.getElementById(x);
    if(el) el.classList.add('hidden');
  });
  const target=document.getElementById(id);
  if(target) target.classList.remove('hidden');
}
function enter(){
  const ui=$('#userInfo');
  if(ui && SESSION) ui.textContent = `${SESSION.full_name}・${SESSION.department}`;

  // Tampilkan tombol/nav umum
  const ids=['btnLogout','btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvoice','btnToCharts'];
  ids.forEach(id=>{ const el=$('#'+id); if(el) el.classList.remove('hidden'); });

  // NEW: tampilkan dropdown Setting jika login
  const dd=$('#ddSetting'); if(dd) dd.classList.remove('hidden');

  // akses Add User di modal Setting hanya untuk admin/生産技術
  const addUserBtn=$('#miAddUser');
  if(addUserBtn){
    if (SESSION.role==='admin' || SESSION.department==='生産技術') addUserBtn.disabled=false;
    else addUserBtn.disabled=true;
  }

  show('pageDash');
  loadMasters();
  refreshAll();
}

/* ===== Auth ===== */
async function onLogin(){
  const u=$('#inUser')?$('#inUser').value.trim():'';
  const p=$('#inPass')?$('#inPass').value.trim():'';
  try{
    const r=await apiPost('login',{username:u,password:p});
    SESSION=r;
    localStorage.setItem('erp_session',JSON.stringify(r));
    enter();
  }catch(e){ alert(e.message||e); }
}
async function addUserFromLoginUI(){
  if(!SESSION) return alert('ログインしてください');
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術')) return alert('権限不足（生産技術）');
  const payload={
    username:$('#nuUser')?$('#nuUser').value.trim():'',
    password:$('#nuPass')?$('#nuPass').value.trim():'',
    full_name:$('#nuName')?$('#nuName').value.trim():'',
    department:$('#nuDept')?$('#nuDept').value:'',
    role:$('#nuRole')?$('#nuRole').value:'member'
  };
  if(!payload.username||!payload.password||!payload.full_name) return alert('必須項目');
  try{ await apiPost('createUser',{user:SESSION,payload}); alert('作成しました'); }catch(e){ alert(e.message||e); }
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
    fill('#dl_tokui',m['得意先']);
    fill('#dl_hinmei',m['品名']);
    fill('#dl_hinban',m['品番']);
    fill('#dl_zuban',m['図番']);
  }catch(e){ console.warn(e); }
}

/* ===== Dashboard ===== */
async function refreshAll(keep=false){
  try{
    const s=await apiGet({action:'stock'});
    const statFinished=$('#statFinished'); const statReady=$('#statReady'); const statShipped=$('#statShipped');
    if(statFinished) statFinished.textContent=s.finishedStock;
    if(statReady)    statReady.textContent=s.ready;
    if(statShipped)  statShipped.textContent=s.shipped;

    const today=await apiGet({action:'todayShip'});
    const listToday=$('#listToday');
    if(listToday){
      listToday.innerHTML = today.length
        ? today.map(r=>`<div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join('')
        : '<div class="muted">本日予定なし</div>';
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
  const qEl=$('#searchQ');
  const q = qEl ? qEl.value.trim() : '';
  return apiGet({action:'listOrders',q});
}
async function renderOrders(){
  const tbody=$('#tbOrders'); if(!tbody) return;
  const rows=await listOrders();

  const html = rows.map(r=>{
    const statusName = r.status || '';
    const procName   = r.current_process || '';

    const stClass = STATUS_CLASS[statusName] || 'st-begin';
    const prClass = PROC_CLASS[procName]   || 'prc-out';

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
    const procBadge   = `<span class="badge ${prClass}"><span class="dot"></span><span>${procName||'-'}</span></span>`;

    const actions = `
      <div class="actions-2col">
        <button class="btn ghost s icon" onclick="openTicket('${r.po_id}')">票</button>
        <button class="btn ghost s icon" onclick="startScanFor('${r.po_id}')">更新</button>
        <button class="btn ghost s icon" onclick="openShipByPO('${r.po_id}')">出荷票</button>
        <button class="btn ghost s icon" onclick="openHistory('${r.po_id}')">履歴</button>
      </div>`;

    return `<tr>
      <td>${leftCell}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td class="col-status">${statusBadge}</td>
      <td class="col-proc">${procBadge}</td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
      <td class="s">${actions}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = html;
}

/* ===== Sales (営業) ===== */
async function renderSales(){
  const tbody=$('#tbSales'); if(!tbody) return;
  const qEl=$('#salesQ'); const q=(qEl&&qEl.value)? qEl.value.trim():'';
  const rows=await apiGet({action:'listSales',q});
  tbody.innerHTML = rows.map(r=>`
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
    '受注日':$('#so_date')?$('#so_date').value:'',
    '得意先':$('#so_cust')?$('#so_cust').value:'',
    '品名':$('#so_item')?$('#so_item').value:'',
    '品番':$('#so_part')?$('#so_part').value:'',
    '図番':$('#so_drw')?$('#so_drw').value:'',
    '製番号':$('#so_sei')?$('#so_sei').value:'',
    '数量':$('#so_qty')?$('#so_qty').value:'',
    '希望納期':$('#so_req')?$('#so_req').value:'',
    '備考':$('#so_note')?$('#so_note').value:''
  };
  const soEl=$('#so_id'); const so=soEl?soEl.value.trim():'';
  try{
    if(so){ await apiPost('updateSalesOrder',{so_id:so,updates:p,user:SESSION}); alert('受注を更新しました'); }
    else  { const r=await apiPost('createSalesOrder',{payload:p,user:SESSION}); alert('受注登録: '+r.so_id); if(soEl) soEl.value=r.so_id; }
    renderSales();
  }catch(e){ alert(e.message||e); }
}
async function deleteSalesUI(){
  const soEl=$('#so_id'); const so=soEl?soEl.value.trim():'';
  if(!so) return alert('SO入力');
  if(!confirm('削除しますか？')) return;
  try{ const r=await apiPost('deleteSalesOrder',{so_id:so,user:SESSION}); alert('削除: '+r.deleted); renderSales(); }catch(e){ alert(e.message||e); }
}
async function promoteSalesUI(){
  const soEl=$('#so_id'); const so=soEl?soEl.value.trim():'';
  if(!so) return alert('SO入力');
  try{
    const r=await apiPost('promoteSalesToPlan',{so_id:so,user:SESSION}); alert('生産計画を作成: '+r.po_id); refreshAll();
  }catch(e){ alert(e.message||e); }
}
async function exportSalesCSV(){ const rows=await apiGet({action:'listSales'}); downloadCSV('sales_orders.csv', rows); }

/* ===== Plan CRUD ===== */
async function createOrderUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const p={
    '通知書番号':$('#c_tsuchi')?$('#c_tsuchi').value.trim():'',
    '得意先':$('#c_tokui')?$('#c_tokui').value.trim():'',
    '得意先品番':$('#c_tokui_hin')?$('#c_tokui_hin').value.trim():'',
    '製番号':$('#c_sei')?$('#c_sei').value.trim():'',
    '品名':$('#c_hinmei')?$('#c_hinmei').value.trim():'',
    '品番':$('#c_hinban')?$('#c_hinban').value.trim():'',
    '図番':$('#c_zuban')?$('#c_zuban').value.trim():'',
    '管理No':$('#c_kanri')?$('#c_kanri').value.trim():''
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
  if(!po) return alert('注番入力');
  if(!confirm('削除しますか？')) return;
  try{ const r=await apiPost('deleteOrder',{po_id:po,user:SESSION}); alert('削除:'+r.deleted); refreshAll(); }catch(e){ alert(e.message||e); }
}

/* ===== Ship CRUD ===== */
async function scheduleUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const poEl=$('#s_po'); const dateEl=$('#s_date'); const qtyEl=$('#s_qty'); const idEl=$('#s_shipid');
  const po = poEl?poEl.value.trim():''; const dateIso=dateEl?dateEl.value:''; const qty=qtyEl?qtyEl.value:'';
  if(!po||!dateIso) return alert('注番と日付');
  try{
    const shipId=idEl?idEl.value.trim():'';
    if(shipId){
      await apiPost('updateShipment',{ship_id:shipId,updates:{po_id:po,scheduled_date:dateIso,qty:qty},user:SESSION});
      alert('出荷予定を編集しました');
    }else{
      const r=await apiPost('scheduleShipment',{po_id:po,dateIso,qty,user:SESSION});
      alert('登録: '+r.ship_id);
    }
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
  if(!sid) return alert('Ship ID入力');
  if(!confirm('削除しますか？')) return;
  try{ const r=await apiPost('deleteShipment',{ship_id:sid,user:SESSION}); alert('削除:'+r.deleted); refreshAll(true); }catch(e){ alert(e.message||e); }
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
<tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
<tr><th>注番</th><td>${o.po_id||s.po_id}</td><th>数量</th><td>${s.qty||0}</td></tr>
<tr><th>出荷ステータス</th><td>${s.status||''}</td><th>備考</th><td></td></tr></table>`;
  showDoc('dlgShip',body);
}
async function openShipByPO(po_id){ try{ const d=await apiGet({action:'shipByPo',po_id}); showShipDoc(d.shipment,d.order);}catch(e){ alert(e.message||e);} }
async function openShipByID(id){ try{ const d=await apiGet({action:'shipById',ship_id:id}); showShipDoc(d.shipment,d.order);}catch(e){ alert(e.message||e);} }
function showDoc(id,html){
  const dlg=document.getElementById(id);
  if(!dlg) return;
  const body=dlg.querySelector('.body');
  if(body) body.innerHTML=html;
  dlg.showModal();
}

/* ===== Export helpers ===== */
async function exportOrdersCSV(){ const rows=await apiGet({action:'listOrders'}); downloadCSV('orders.csv',rows); }
async function exportShipCSV(){ const rows=await apiGet({action:'todayShip'}); downloadCSV('ship_today.csv',rows); }
function downloadCSV(name,rows){
  if(!rows||!rows.length) return downloadFile(name,'');
  const headers=Object.keys(rows[0]);
  const csv=[headers.join(',')].concat(
    rows.map(r=> headers.map(h=> String(r[h]??'').replaceAll('"','""')).map(v=>`"${v}"`).join(','))
  ).join('\n');
  downloadFile(name,csv);
}
function downloadFile(name,content){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type:'text/csv'}));
  a.download=name; a.click();
}

/* ===== Station QR ===== */
function openStationQR(){
  const wrap = $('#qrWrap'); if(!wrap){ alert('QRコンテナが見つかりません'); return; }
  wrap.innerHTML = '';
  const stations = ['レーザ加工','曲げ工程','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立工程','検査工程','出荷工程'];
  stations.forEach((st)=>{
    const div = document.createElement('div');
    div.className = 'tile';
    div.innerHTML = `<div class="row-between"><b>${st}</b><a class="btn ghost s" target="_blank">PNG</a></div>
      <div class="qr-holder" style="background:#fff;border:1px solid #e3e6ef;border-radius:8px;display:inline-block"></div>
      <div class="s muted">内容: ST:${st}</div>`;
    wrap.appendChild(div);
    const holder=div.querySelector('.qr-holder'); const link=div.querySelector('a');
    // eslint-disable-next-line no-undef
    new QRCode(holder,{ text:'ST:'+st, width:200, height:200, correctLevel:QRCode.CorrectLevel.M });
    setTimeout(()=>{
      const cvs=holder.querySelector('canvas'); const img=holder.querySelector('img'); let url='';
      if(cvs&&cvs.toDataURL) url=cvs.toDataURL('image/png');
      else if(img&&img.src) url=img.src;
      if(url){ link.href=url; link.download=`ST-${st}.png`; } else link.remove();
    },50);
  });
  const dlg=document.getElementById('dlgStationQR');
  if(dlg) dlg.showModal();
}

/* ===== Scan flow ===== */
function startScanFor(po_id){
  CURRENT_PO=po_id;
  const po=$('#scanPO'); const res=$('#scanResult');
  if(po) po.textContent=po_id;
  if(res) res.textContent='開始を押してQRを読み取ってください';
  const dlg=document.getElementById('dlgScan'); if(dlg) dlg.showModal();
}
async function scanStart(){
  try{
    if(scanStream) return;
    const v=$('#scanVideo'), c=$('#scanCanvas'); if(!v||!c) return;
    const ctx=c.getContext('2d');
    const st=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    scanStream=st; v.srcObject=st; await v.play();
    scanTimer=setInterval(async ()=>{
      c.width=v.videoWidth; c.height=v.videoHeight; ctx.drawImage(v,0,0,c.width,c.height);
      // eslint-disable-next-line no-undef
      const code=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
      if(code && code.data){
        const text=code.data.trim();
        const res=$('#scanResult'); if(res) res.textContent='読み取り: '+text;
        if(/^ST:/.test(text) && CURRENT_PO){
          const station=text.slice(3); const rule=STATION_RULES[station];
          if(!rule){ if(res) res.textContent='未知のステーション: '+station; return; }
          try{
            const cur=await apiGet({action:'ticket',po_id:CURRENT_PO});
            const updates=rule(cur);
            await apiPost('updateOrder',{po_id:CURRENT_PO,updates,user:SESSION});
            if(res) res.textContent=`更新完了: ${CURRENT_PO} → ${updates.status||'(状態変更なし)'} / ${updates.current_process||cur.current_process}`;
            refreshAll(true);
          }catch(e){
            if(res) res.textContent='更新失敗: '+(e.message||e);
          }
        }
      }
    }, 500);
  }catch(e){ alert('カメラ起動失敗: '+(e.message||e)); }
}
function scanClose(){
  clearInterval(scanTimer); scanTimer=null;
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
  const dlg=document.getElementById('dlgScan'); if(dlg) dlg.close();
}

/* ===== History ===== */
async function openHistory(po_id){
  try{
    const logs=await apiGet({action:'history',po_id});
    const html = logs.length
      ? `<table><thead><tr><th>時刻</th><th>旧状態</th><th>新状態</th><th>旧工程</th><th>新工程</th><th>更新者</th><th>備考</th></tr></thead>
<tbody>${logs.map(l=>`<tr><td>${fmtDT(l.timestamp)}</td><td>${l.prev_status||''}</td><td>${l.new_status||''}</td><td>${l.prev_process||''}</td><td>${l.new_process||''}</td><td>${l.updated_by||''}</td><td>${l.note||''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="muted">履歴なし</div>';
    const hb=$('#histBody'); if(hb) hb.innerHTML=html;
    const dlg=document.getElementById('dlgHistory'); if(dlg) dlg.showModal();
  }catch(e){ alert(e.message||e); }
}

/* ===== Add user (from Setting) ===== */
function openAddUserModal(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'))) return alert('権限不足');
  const html=`<h3>ユーザー追加</h3>
    <div class="grid">
      <input id="au_username" placeholder="ユーザー名">
      <input id="au_password" type="password" placeholder="パスワード">
      <input id="au_fullname" placeholder="氏名">
      <select id="au_dept"><option>営業</option><option>生産技術</option><option>生産管理部</option><option>製造部</option><option>検査部</option></select>
      <select id="au_role"><option>member</option><option>manager</option><option>admin</option></select>
    </div>
    <div class="row-end" style="margin-top:.6rem"><button class="btn primary" id="au_save">保存</button></div>`;
  const dlg=document.getElementById('dlgTicket'); if(!dlg) return;
  const body=dlg.querySelector('.body'); if(body) body.innerHTML=html; dlg.showModal();
  const saveBtn=document.getElementById('au_save');
  if(saveBtn) saveBtn.onclick=async ()=>{
    const payload={
      username:$('#au_username')?$('#au_username').value.trim():'',
      password:$('#au_password')?$('#au_password').value.trim():'',
      full_name:$('#au_fullname')?$('#au_fullname').value.trim():'',
      department:$('#au_dept')?$('#au_dept').value:'',
      role:$('#au_role')?$('#au_role').value:'member'
    };
    if(!payload.username||!payload.password||!payload.full_name) return alert('必須項目');
    try{ await apiPost('createUser',{user:SESSION,payload}); alert('作成しました'); dlg.close(); }catch(e){ alert(e.message||e); }
  };
}

/* ===== Invoice UI ===== */
function recalcInvoiceTotals(){
  let sub=0;
  const rows=[...document.querySelectorAll('#invLines tr')];
  rows.forEach(tr=>{
    const qty=Number(tr.querySelector('.q')?tr.querySelector('.q').value:0);
    const up =Number(tr.querySelector('.p')?tr.querySelector('.p').value:0);
    const amt=qty*up;
    const a=tr.querySelector('.a'); if(a) a.textContent=amt.toLocaleString();
    sub+=amt;
  });
  const tax=Math.round(sub*0.1), total=sub+tax;
  const invSub=$('#invSub'); const invTax=$('#invTax'); const invTotal=$('#invTotal');
  if(invSub)  invSub.textContent=sub.toLocaleString();
  if(invTax)  invTax.textContent=tax.toLocaleString();
  if(invTotal)invTotal.textContent=total.toLocaleString();
  INV_PREVIEW.info = INV_PREVIEW.info || {};
  INV_PREVIEW.info['小計']=sub; INV_PREVIEW.info['税額']=tax; INV_PREVIEW.info['合計']=total;
  INV_PREVIEW.lines = rows.map(tr=>({
    行No:Number(tr.dataset.no),
    品名:tr.dataset.hinmei, 品番:tr.dataset.hinban, 図番:tr.dataset.zuban,
    数量:Number(tr.querySelector('.q')?tr.querySelector('.q').value:0),
    単価:Number(tr.querySelector('.p')?tr.querySelector('.p').value:0),
    出荷IDs:tr.dataset.shipids, POs:tr.dataset.pos
  }));
}
async function previewInvoiceUI(){
  const cust=$('#inv_customer')?$('#inv_customer').value.trim():'';
  const from=$('#inv_from')?$('#inv_from').value:''; const to=$('#inv_to')?$('#inv_to').value:'';
  if(!from||!to) return alert('期間を指定してください');
  try{
    const d=await apiGet({action:'previewInvoice',customer:cust,from:from,to:to});
    INV_PREVIEW={info:d.info, lines:d.lines};
    const tbody=$('#invLines'); if(!tbody) return;
    tbody.innerHTML = d.lines.map(l=>`
      <tr data-no="${l.行No}" data-hinmei="${l.品名}" data-hinban="${l.品番}" data-zuban="${l.図番}" data-shipids="${l.出荷IDs||''}" data-pos="${l.POs||''}">
        <td>${l.行No}</td><td>${l.品名}</td><td>${l.品番}</td><td>${l.図番}</td>
        <td><input class="q" type="number" value="${l.数量||0}" style="width:90px"></td>
        <td><input class="p" type="number" value="${l.単価||0}" style="width:90px"></td>
        <td class="a">0</td><td class="s">${l.POs||''}</td><td class="s">${l.出荷IDs||''}</td>
      </tr>`).join('');
    const custEl=$('#inv_customer'); if(custEl) custEl.value = d.info['得意先']||cust;
    const curEl=$('#inv_currency'); if(curEl) curEl.value = d.info['通貨']||'JPY';
    const invDate=$('#inv_date'); if(invDate && !invDate.value) invDate.value = new Date().toISOString().slice(0,10);
    document.querySelectorAll('#invLines input').forEach(el=> el.oninput=recalcInvoiceTotals);
    recalcInvoiceTotals();
    alert('集計しました。単価を入力し、請求書発行を押してください。');
  }catch(e){ alert(e.message||e); }
}
async function createInvoiceUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  if(!INV_PREVIEW.lines.length) return alert('明細がありません。集計してください。');
  INV_PREVIEW.info = {
    ...(INV_PREVIEW.info||{}),
    '得意先': ($('#inv_customer')?$('#inv_customer').value.trim():''), 
    '期間自': ($('#inv_from')?$('#inv_from').value:''), 
    '期間至': ($('#inv_to')?$('#inv_to').value:''), 
    '請求日': ($('#inv_date')?$('#inv_date').value:''), 
    '通貨':   ($('#inv_currency')?$('#inv_currency').value.trim():'JPY'),
    'メモ':    ($('#inv_memo')?$('#inv_memo').value.trim():'')
  };
  try{
    const r=await apiPost('createInvoice',{payload:INV_PREVIEW,user:SESSION});
    alert('請求書発行: '+r.inv_id);
    INV_PREVIEW.inv_id=r.inv_id;
    openInvoiceDoc(r.inv_id);
  }catch(e){ alert(e.message||e); }
}
function exportInvoiceCSV(){
  const rows=[...document.querySelectorAll('#invLines tr')].map(tr=>({
    行No:tr.dataset.no, 品名:tr.dataset.hinmei, 品番:tr.dataset.hinban, 図番:tr.dataset.zuban,
    数量:(tr.querySelector('.q')?tr.querySelector('.q').value:''), 単価:(tr.querySelector('.p')?tr.querySelector('.p').value:''), POs:tr.dataset.pos, 出荷IDs:tr.dataset.shipids
  }));
  downloadCSV('invoice_preview.csv', rows);
}

/* ====== CHARTS PAGE ====== */
let CHARTS = {monthly:null, customer:null, stock:null, wipProc:null, sales:null, plan:null};
function fillChartYearSelector(){
  const sel=$('#chartYear'); if(!sel) return;
  const y0=(new Date()).getFullYear();
  sel.innerHTML=[y0-1,y0,y0+1].map(y=>`<option value="${y}" ${y===y0?'selected':''}>${y}</option>`).join('');
}
let chartsLoaded=false;
function ensureChartsLoaded(){ if(!chartsLoaded){ chartsLoaded=true; renderCharts(); } }

async function renderCharts(){
  const sel=$('#chartYear'); const year=sel?Number(sel.value): (new Date()).getFullYear();
  let d=null;
  try{
    d=await apiGet({action:'charts', year});
  }catch(e){
    d={
      year,
      perMonth:Array(12).fill(0).map((_,i)=> (i%3+1)*10),
      perCust:{TSH:30,ABC:20,XYZ:10},
      stockBuckets:{'検査済':5,'出荷準備':2,'出荷済':8},
      wipByProcess:{'レーザ加工':2,'曲げ加工':1,'外枠組立':3},
      salesPerMonth:Array(12).fill(0).map((_,i)=>i*5),
      planPerMonth:Array(12).fill(0).map((_,i)=> (i%4)*3)
    };
  }
  const months=['1','2','3','4','5','6','7','8','9','10','11','12'];
  Object.keys(CHARTS).forEach(k=>{ if(CHARTS[k] && CHARTS[k].destroy) CHARTS[k].destroy(); });
  const opts = { responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:true}}, scales:{x:{ticks:{autoSkip:false}}} };
  // eslint-disable-next-line no-undef
  CHARTS.monthly = new Chart($('#chMonthly'),{ type:'bar', data:{labels:months, datasets:[{label:`月別出荷数量（${d.year}）`, data:d.perMonth}]}, options:opts });
  // eslint-disable-next-line no-undef
  CHARTS.customer = new Chart($('#chCustomer'),{ type:'bar', data:{labels:Object.keys(d.perCust||{}), datasets:[{label:'得意先別出荷', data:Object.values(d.perCust||{})}]}, options:opts });
  // eslint-disable-next-line no-undef
  CHARTS.stock = new Chart($('#chStock'),{ type:'pie', data:{labels:Object.keys(d.stockBuckets||{}), datasets:[{label:'在庫区分', data:Object.values(d.stockBuckets||{})}]}, options:{responsive:true, maintainAspectRatio:false} });
  // eslint-disable-next-line no-undef
  CHARTS.wipProc = new Chart($('#chWipProc'),{ type:'bar', data:{labels:Object.keys(d.wipByProcess||{}), datasets:[{label:'工程内WIP', data:Object.values(d.wipByProcess||{})}]}, options:opts });
  // eslint-disable-next-line no-undef
  CHARTS.sales = new Chart($('#chSales'),{ type:'line', data:{labels:months, datasets:[{label:`営業 受注数（${d.year}）`, data:d.salesPerMonth||[], tension:.3}]}, options:opts });
  // eslint-disable-next-line no-undef
  CHARTS.plan = new Chart($('#chPlan'),{ type:'line', data:{labels:months, datasets:[{label:`生産計画 作成数（${d.year}）`, data:d.planPerMonth||[], tension:.3}]}, options:opts });
}

/* ======== IMPORT (CSV/Excel) – NEW ======== */
let IMP_CTX = { target:null, rows:[], headers:[] };

function bindImportDialog(){
  const dlg = $('#dlgImport');
  const file = $('#impFile');
  const btnUp = $('#impUpload');
  const btnCancel = $('#impCancel');
  const btnExample = $('#impExample');

  if(btnCancel) btnCancel.onclick = ()=> dlg.close();
  if(btnUp)     btnUp.onclick     = uploadImportData;
  if(btnExample)btnExample.onclick= downloadExampleCSV;

  if(file) file.onchange = async (ev)=>{
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    // Validasi dasar
    if(f.size > 2*1024*1024) { // 2MB
      alert('ファイルが大きすぎます（2MB上限）');
      file.value = ''; return;
    }
    const name = (f.name||'').toLowerCase();
    if(!(name.endsWith('.csv') || name.endsWith('.xlsx'))){
      alert('CSV または .xlsx を選択してください');
      file.value=''; return;
    }
    try{
      let rows=[], headers=[];
      if(name.endsWith('.csv')){
        const text = await f.text();
        ({rows, headers} = parseCsvLocal(text));
      }else{
        // Excel
        const data = await f.arrayBuffer();
        // eslint-disable-next-line no-undef
        const wb = XLSX.read(data, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, {defval:'', raw:true, blankrows:false});
        rows = json;
        headers = rows.length ? Object.keys(rows[0]) : [];
      }
      if(rows.length > 5000){ alert('行数が多すぎます（最大 5,000 行）'); file.value=''; return; }

      IMP_CTX.rows = rows;
      IMP_CTX.headers = headers;
      renderImportPreview();
    }catch(e){
      alert('読み込み失敗: '+(e.message||e));
      file.value='';
    }
  };
}

function openImportDialog(target){
  if(!SESSION) return alert('ログインしてください');
  if(!(['orders','sales','ship'].includes(target))) return alert('対象が不正です');
  IMP_CTX = { target, rows:[], headers:[] };
  const dlg=$('#dlgImport');
  const lab=$('#impTargetLabel');
  const head=$('#impHead'), body=$('#impBody'), file=$('#impFile'), note=$('#impNote');
  if(lab) lab.textContent = target==='orders' ? '生産計画（ProductionOrders）'
                   : target==='sales' ? '受注（SalesOrders）'
                   : '出荷予定（Shipments）';
  if(head) head.innerHTML=''; if(body) body.innerHTML=''; if(note) note.textContent='';
  if(file) file.value='';
  dlg.showModal();
}

function renderImportPreview(){
  const head=$('#impHead'), body=$('#impBody'), note=$('#impNote');
  if(!head||!body) return;
  const H = IMP_CTX.headers;
  head.innerHTML = H.map(h=>`<th>${escapeHtml(h)}</th>`).join('');
  body.innerHTML = (IMP_CTX.rows||[]).slice(0,100).map(r=>`<tr>${
    H.map(h=> `<td class="s">${escapeHtml(String(r[h]??''))}</td>`).join('')
  }</tr>`).join('');
  if(note){
    const more = IMP_CTX.rows.length>100 ? `（先頭100行を表示中 / 全${IMP_CTX.rows.length}行）` : `（全${IMP_CTX.rows.length}行）`;
    note.textContent = `ヘッダー: ${H.join(', ')} ${more}`;
  }
}

function parseCsvLocal(text){
  // Sederhana: split baris, koma, dukung kutip ganda via CSV parse dasar
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l=> l.trim()!=='');
  if(!lines.length) return {rows:[], headers:[]};
  const headers = splitCsvLine(lines[0]);
  for(let i=1;i<lines.length;i++){
    const vals = splitCsvLine(lines[i]);
    const o={}; headers.forEach((h,idx)=> o[h]=vals[idx]??'');
    if(Object.values(o).some(v=> String(v).trim()!=='')) rows.push(o);
  }
  return {rows, headers};
}
function splitCsvLine(line){
  const out=[], re=/("([^"]|"")*"|[^,]*)(,|$)/g; let m;
  while((m=re.exec(line))!==null){
    let v=m[1]||''; 
    v = v.trim();
    if(v.startsWith('"') && v.endsWith('"')) v=v.slice(1,-1).replace(/""/g,'"');
    out.push(v);
    if(m[3]!==',') break;
  }
  return out;
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

function downloadExampleCSV(){
  // contoh minimal header sesuai mapping di backend
  let csv='';
  if(IMP_CTX.target==='orders'){
    csv = '得意先,得意先品番,製番号,品名,品番,図番,通知書番号,管理No,status,current_process\n' +
          'サンプルA,,A-001,アイテムA,PA-01,DR-01,,KAN-01,生産開始,レーザ加工\n';
  }else if(IMP_CTX.target==='sales'){
    csv = '受注日,得意先,品名,品番,図番,製番号,数量,希望納期,備考\n' +
          '2025-04-01,サンプルA,アイテムA,PA-01,DR-01,A-001,10,2025-05-01,メモ\n';
  }else{
    csv = 'po_id,scheduled_date,qty,status\n' +
          'PO-123,2025-04-10,5,出荷準備\n';
  }
  downloadFile(`example_${IMP_CTX.target}.csv`, csv);
}

async function uploadImportData(){
  const dlg = $('#dlgImport');
  if(!SESSION) return alert('ログインしてください');
  if(!IMP_CTX.rows.length) return alert('ファイルを選択してください');

  // Validasi header minimal
  const H = IMP_CTX.headers.map(h=>h.toLowerCase());
  const hasAny = (arr)=> arr.some(x=> H.includes(x.toLowerCase()));
  if(IMP_CTX.target==='orders'){
    if(!hasAny(['得意先','customer','cust'])) return alert('ヘッダー「得意先/Customer」が必要です');
    if(!hasAny(['品名','item'])) return alert('ヘッダー「品名/Item」が必要です');
  }else if(IMP_CTX.target==='sales'){
    if(!hasAny(['受注日','order_date','date'])) return alert('ヘッダー「受注日/Date」が必要です');
    if(!hasAny(['得意先','customer','cust'])) return alert('ヘッダー「得意先/Customer」が必要です');
  }else{
    if(!hasAny(['po_id','po','注番'])) return alert('ヘッダー「po_id/注番」が必要です');
    if(!hasAny(['scheduled_date','date','出荷日'])) return alert('ヘッダー「scheduled_date/出荷日」が必要です');
  }

  try{
    // Kirim dalam bentuk CSV text (seragam) supaya backend mappingnya konsisten
    const csvText = jsonToCsv(IMP_CTX.rows);
    const res = await apiPost('bulkImport', { target: IMP_CTX.target, csvText, user: SESSION });
    alert(`インポート完了: ${res.imported} 件（スキップ: ${res.skipped}）`);
    dlg.close();
    // refresh data sesuai target
    if(IMP_CTX.target==='orders')      refreshAll();
    else if(IMP_CTX.target==='sales')  renderSales();
    else                               refreshAll(true);
  }catch(e){
    alert('インポート失敗: '+(e.message||e));
  }
}
function jsonToCsv(rows){
  if(!rows.length) return '';
  const headers = Array.from(new Set(rows.flatMap(r=> Object.keys(r))));
  const lines = [headers.join(',')];
  rows.forEach(r=>{
    const line = headers.map(h=>{
      const v = String(r[h]??'').replaceAll('"','""');
      return `"${v}"`;
    }).join(',');
    lines.push(line);
  });
  return lines.join('\n');
}

/* ===== Helpers ===== */
function showDoc(id,html){
  const dlg=document.getElementById(id);
  if(!dlg) return;
  const body=dlg.querySelector('.body');
  if(body) body.innerHTML=html;
  dlg.showModal();
}

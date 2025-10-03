/* =========================================================
 * app.js — Tokyo Seimitsu ERP (Frontend - REVISED)
 * - Fitur: Halaman Stok & Barang Jadi, Import CSV.
 * - UI: Loading indicator, navigasi terpusat.
 * - Konsistensi: Fungsi render tabel terpusat.
 * - Kompatibel dengan backend Code.gs yang telah dioptimasi.
 * ========================================================= */

/* ===== Config ===== */
// GANTI dengan URL Web App Anda setelah deploy ulang
const API_BASE = "https://script.google.com/macros/s/AKfycbwnU2BvQ6poO4EmMut3g5Zuu_cuojNbTmM8oRSCyNJDwm_38VgS7BhsFLKU0eoUt-BAKw/exec";
const API_KEY = ""; // opsional
const PROCESSES = [ 'レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング', '外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程' ];

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
const fmtDT= (s)=> s? new Date(s).toLocaleString('ja-JP'): '';
const fmtD = (s)=> s? new Date(s).toLocaleDateString('ja-JP'): '';
let SESSION=null, CURRENT_PO=null, scanStream=null, scanTimer=null;
let INV_PREVIEW={info:null, lines:[]};

/* ===== Visual mapping ===== */
const STATUS_CLASS = { '生産開始':'st-begin', '検査工程':'st-inspect', '検査済':'st-inspect', '検査保留':'st-hold', '出荷準備':'st-ready', '出荷済':'st-shipped', '不良品（要リペア）':'st-ng' };
const PROC_CLASS = { 'レーザ加工':'prc-laser', '曲げ加工':'prc-bend', '外枠組立':'prc-frame', 'シャッター組立':'prc-shassy', 'シャッター溶接':'prc-shweld', 'コーキング':'prc-caulk', '外枠塗装':'prc-tosou', '組立（組立中）':'prc-asm-in', '組立（組立済）':'prc-asm-ok', '外注':'prc-out', '検査工程':'prc-inspect' };

/* ===== API helpers (dengan loader & error bar) ===== */
const showLoader = (show) => document.getElementById('loader')?.classList.toggle('hidden', !show);

async function apiPost(action, body){
  showLoader(true);
  const payload={action,...body};
  if(API_KEY) payload.apiKey=API_KEY;
  try{
    const res=await fetch(API_BASE,{ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
    const j=await res.json();
    if(!j.ok) throw new Error(j.error||'API error');
    return j.data;
  } catch(err) {
    showApiError(action, err); throw err;
  } finally {
    showLoader(false);
  }
}

async function apiGet(params){
  showLoader(true);
  const url=API_BASE+'?'+new URLSearchParams(params).toString();
  try{
    const res=await fetch(url,{cache:'no-store'});
    const j=await res.json();
    if(!j.ok) throw new Error(j.error||'API error');
    return j.data;
  } catch(err) {
    showApiError(params.action, err); throw err;
  } finally {
    showLoader(false);
  }
}

function showApiError(action, err){
  console.error('API FAIL:', action, err);
  alert(`APIエラー (${action}): ${err.message}`);
}

/* ===== Boot & Event Listeners ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  // Navigasi
  const navMap = {
    btnToDash: 'pageDash',
    btnToInventory: 'pageInventory',
    btnToFinished: 'pageFinished',
    btnToSales: 'pageSales',
    btnToPlan: 'pagePlan',
    btnToShip: 'pageShip',
    btnToInvoice: 'pageInvoice',
    btnToCharts: 'pageCharts',
  };
  Object.keys(navMap).forEach(btnId => {
    const btn = $(`#${btnId}`);
    if (btn) btn.onclick = () => show(navMap[btnId]);
  });
  // Khusus untuk charts
  if ($('#btnToCharts')) $('#btnToCharts').onclick = () => { show('pageCharts'); ensureChartsLoaded(); };

  // Menu Settings
  $('#miStationQR')?.addEventListener('click', openStationQR);
  $('#miAddUser')?.addEventListener('click', openAddUserModal);
  $('#miChangePass')?.addEventListener('click', changePasswordUI);
  $('#btnLogout')?.addEventListener('click', ()=>{
    SESSION=null; localStorage.removeItem('erp_session'); location.reload();
  });

  // Auth
  $('#btnLogin')?.addEventListener('click', onLogin);
  $('#inPass')?.addEventListener('keypress', (e) => e.key === 'Enter' && onLogin());

  // Halaman Utama
  $('#btnRefresh')?.addEventListener('click', () => refreshDashboard(false));
  $('#searchQ')?.addEventListener('input', () => renderOrderTable('listOrders', '#tbOrders', '#searchQ'));
  $('#btnExportOrders')?.addEventListener('click', () => exportCSV('listOrders', 'orders.csv'));

  // Halaman Baru
  $('#searchInventory')?.addEventListener('input', () => renderOrderTable('listInventory', '#tbInventory', '#searchInventory'));
  $('#searchFinished')?.addEventListener('input', () => renderOrderTable('listFinished', '#tbFinished', '#searchFinished'));

  // Sales
  $('#btnSalesSave')?.addEventListener('click', saveSalesUI);
  $('#btnSalesDelete')?.addEventListener('click', deleteSalesUI);
  $('#btnPromote')?.addEventListener('click', promoteSalesUI);
  $('#salesQ')?.addEventListener('input', renderSales);
  $('#btnSalesExport')?.addEventListener('click', () => exportCSV('listSales', 'sales_orders.csv'));
  $('#importSales')?.addEventListener('change', (e) => handleImport('SalesOrders', e.target));

  // Plan
  $('#btnCreateOrder')?.addEventListener('click', createOrderUI);
  $('#btnPlanEdit')?.addEventListener('click', loadOrderForEdit);
  $('#btnPlanDelete')?.addEventListener('click', deleteOrderUI);
  $('#importPlan')?.addEventListener('change', (e) => handleImport('ProductionOrders', e.target));
  
  // Ship
  $('#btnSchedule')?.addEventListener('click', scheduleUI);
  $('#btnShipEdit')?.addEventListener('click', loadShipForEdit);
  $('#btnShipDelete')?.addEventListener('click', deleteShipUI);
  $('#btnShipByPO')?.addEventListener('click', () => { const po=$('#s_po').value.trim(); if(po) openShipByPO(po); });
  $('#btnShipByID')?.addEventListener('click', () => { const id=prompt('Ship ID:'); if(id) openShipByID(id.trim()); });
  $('#importShip')?.addEventListener('change', (e) => handleImport('Shipments', e.target));

  // Scan
  $('#btnScanStart')?.addEventListener('click', scanStart);
  $('#btnScanClose')?.addEventListener('click', scanClose);

  // Invoice
  $('#btnInvPreview')?.addEventListener('click', previewInvoiceUI);
  $('#btnInvCreate')?.addEventListener('click', createInvoiceUI);
  $('#btnInvPrint')?.addEventListener('click', () => openInvoiceDoc(INV_PREVIEW.inv_id||''));
  $('#btnInvCSV')?.addEventListener('click', exportInvoiceCSV);

  // Charts
  $('#btnChartsRefresh')?.addEventListener('click', renderCharts);
  fillChartYearSelector();

  // Restore session
  const saved=localStorage.getItem('erp_session');
  if(saved){
    SESSION=JSON.parse(saved);
    enter();
  } else {
    show('authView');
  }
});

/* ===== UI & Flow ===== */
function show(id){
  document.querySelectorAll('main').forEach(el => el.classList.add('hidden'));
  const target=document.getElementById(id);
  if(target) target.classList.remove('hidden');
  
  // Auto-load data saat halaman ditampilkan
  if(id === 'pageInventory') renderOrderTable('listInventory', '#tbInventory', '#searchInventory');
  if(id === 'pageFinished') renderOrderTable('listFinished', '#tbFinished', '#searchFinished');
  if(id === 'pageSales') renderSales();
}

function enter(){
  if(SESSION) $('#userInfo').textContent = `${SESSION.full_name}・${SESSION.department}`;
  
  ['btnToDash','btnToInventory','btnToFinished','btnToSales','btnToPlan','btnToShip','btnToInvoice','btnToCharts', 'ddSetting'].forEach(id => {
    $(`#${id}`)?.classList.remove('hidden');
  });

  // Cek hak akses untuk menu tertentu
  const isManager = SESSION.role==='admin' || SESSION.department==='生産技術';
  $('#miAddUser')?.classList.toggle('hidden', !isManager);

  show('pageDash');
  loadMasters();
  refreshDashboard(true);
}

/* ===== Auth ===== */
async function onLogin(){
  const u=$('#inUser').value.trim(), p=$('#inPass').value.trim();
  try{
    const r=await apiPost('login',{username:u,password:p});
    SESSION=r;
    localStorage.setItem('erp_session',JSON.stringify(r));
    enter();
  } catch(e) { /* error sudah ditangani apiPost */ }
}
async function changePasswordUI(){
  if(!SESSION) return;
  const oldPass=prompt('旧パスワード:'); if(oldPass===null) return;
  const newPass=prompt('新パスワード:'); if(newPass===null) return;
  try{
    await apiPost('changePassword',{user:SESSION,oldPass,newPass});
    alert('変更しました。再ログインしてください。');
    SESSION=null; localStorage.removeItem('erp_session'); location.reload();
  }catch(e){}
}
function openAddUserModal(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'))) return alert('権限不足');
  const html=`<h3>ユーザー追加</h3>
    <div class="grid-2">
      <input id="au_username" placeholder="ユーザー名">
      <input id="au_password" type="password" placeholder="パスワード">
      <input id="au_fullname" placeholder="氏名">
      <select id="au_dept"><option>営業</option><option>生産技術</option><option>生産管理部</option><option>製造部</option><option>検査部</option></select>
      <select id="au_role"><option>member</option><option>manager</option><option>admin</option></select>
    </div>
    <footer class="row-end"><button class="btn primary" id="au_save">保存</button></footer>`;
  showDialog('dlgTicket', html, false);

  $('#au_save').onclick=async ()=>{
    const payload={
      username:$('#au_username').value.trim(), password:$('#au_password').value.trim(),
      full_name:$('#au_fullname').value.trim(), department:$('#au_dept').value, role:$('#au_role').value
    };
    if(!payload.username||!payload.password||!payload.full_name) return alert('必須項目');
    try{
      await apiPost('createUser',{user:SESSION,payload});
      alert('作成しました');
      $('#dlgTicket').close();
    }catch(e){}
  };
}

/* ===== Dashboard & Masters ===== */
async function loadMasters(){
  try{
    const m=await apiGet({action:'masters',types:'得意先,品名,品番,図番'});
    const fill=(id,arr)=>{
      const el=$(id);
      if(el) el.innerHTML=(arr||[]).map(v=>`<option value="${v}"></option>`).join('');
    };
    fill('#dl_tokui',m['得意先']);
    fill('#dl_hinmei',m['品名']);
    fill('#dl_hinban',m['品番']);
    fill('#dl_zuban',m['図番']);
  }catch(e){ console.warn(e); }
}

async function refreshDashboard(isInitialLoad=false){
  try {
    const s = await apiGet({action:'stock'});
    $('#statFinished').textContent=s.finishedStock;
    $('#statReady').textContent=s.ready;
    $('#statShipped').textContent=s.shipped;

    const today=await apiGet({action:'todayShip'});
    $('#listToday').innerHTML = today.length ? today.map(r=>`<div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join('') : '<div class="muted">本日予定なし</div>';

    const loc=await apiGet({action:'locSnapshot'});
    $('#gridProc').innerHTML = PROCESSES.map(p=> `<div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>`).join('');

    if(!isInitialLoad) {
      $('#searchQ').value='';
    }
    renderOrderTable('listOrders', '#tbOrders', '#searchQ');
  } catch(e) { console.error(e); }
}

/* ===== REUSABLE ORDER TABLE RENDERER ===== */
function buildOrderTableRow(r) {
  const statusName = r.status || '', procName = r.current_process || '';
  const stClass = STATUS_CLASS[statusName] || 'st-begin';
  const prClass = PROC_CLASS[procName] || '';

  const leftCell = `<div class="row-main">
    <a href="javascript:void(0)" onclick="openTicket('${r.po_id}')" class="link"><b>${r.po_id}</b></a>
    <div class="row-sub">
      <div class="kv"><span class="muted">得意先:</span> <b>${r['得意先']||'-'}</b></div>
      ${r['製番号']?`<div class="kv"><span class="muted">製番号:</span> <b>${r['製番号']}</b></div>`:''}
      ${(r['品番']||r['図番'])?`<div class="kv"><span class="muted">品番/図番:</span> <b>${r['品番']||''}/${r['図番']||''}</b></div>`:''}
    </div>
  </div>`;

  const statusBadge = `<span class="badge ${stClass}"><span class="dot"></span><span>${statusName||'-'}</span></span>`;
  const procBadge = prClass ? `<span class="badge ${prClass}">${procName||'-'}</span>` : (procName || '-');

  const actions = `<div class="actions-2col">
    <button class="btn ghost s" onclick="openTicket('${r.po_id}')" title="票"><i class="fa-regular fa-file-lines"></i></button>
    <button class="btn ghost s" onclick="startScanFor('${r.po_id}')" title="更新"><i class="fa-solid fa-qrcode"></i></button>
    <button class="btn ghost s" onclick="openShipByPO('${r.po_id}')" title="出荷票"><i class="fa-solid fa-truck"></i></button>
    <button class="btn ghost s" onclick="openHistory('${r.po_id}')" title="履歴"><i class="fa-solid fa-clock-rotate-left"></i></button>
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
    <td>${actions}</td>
  </tr>`;
}

async function renderOrderTable(action, tableBodySelector, searchInputSelector) {
  const tbody = $(tableBodySelector);
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9">読み込み中...</td></tr>';
  try {
    const q = $(searchInputSelector)?.value.trim() || '';
    const rows = await apiGet({ action, q });
    tbody.innerHTML = rows.length > 0 ? rows.map(buildOrderTableRow).join('') : '<tr><td colspan="9">データがありません</td></tr>';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:red">エラー: ${e.message}</td></tr>`;
  }
}

/* ===== Sales (営業) ===== */
async function renderSales(){
  const tbody=$('#tbSales'); if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10">読み込み中...</td></tr>';
  try {
    const q=$('#salesQ').value.trim();
    const rows=await apiGet({action:'listSales',q});
    tbody.innerHTML = rows.map(r=> `<tr>
      <td>${r.so_id||''}</td> <td class="s muted">${fmtD(r['受注日'])}</td>
      <td>${r['得意先']||''}</td> <td>${r['品名']||''}</td>
      <td>${(r['品番']||'')}/${(r['図番']||'')}</td> <td>${r['数量']||0}</td>
      <td class="s muted">${fmtD(r['希望納期'])}</td> <td><span class="badge st-begin">${r.status||''}</span></td>
      <td>${r['linked_po_id']||''}</td> <td class="s muted">${fmtDT(r['updated_at'])}</td>
    </tr>`).join('');
  } catch(e) { tbody.innerHTML = `<tr><td colspan="10" style="color:red">エラー: ${e.message}</td></tr>`; }
}
async function saveSalesUI(){
  const p={ '受注日':$('#so_date').value, '得意先':$('#so_cust').value, '品名':$('#so_item').value, '品番':$('#so_part').value, '図番':$('#so_drw').value, '製番号':$('#so_sei').value, '数量':$('#so_qty').value, '希望納期':$('#so_req').value, '備考':$('#so_note').value };
  const so=$('#so_id').value.trim();
  try{
    if(so){
      await apiPost('updateSalesOrder',{so_id:so,updates:p,user:SESSION}); alert('受注を更新しました');
    } else {
      const r=await apiPost('createSalesOrder',{payload:p,user:SESSION}); alert('受注登録: '+r.so_id); $('#so_id').value=r.so_id;
    }
    renderSales();
  }catch(e){}
}
async function deleteSalesUI(){
  const so=$('#so_id').value.trim(); if(!so) return; if(!confirm('削除しますか？')) return;
  try{ await apiPost('deleteSalesOrder',{so_id:so,user:SESSION}); alert('削除しました'); renderSales(); } catch(e){}
}
async function promoteSalesUI(){
  const so=$('#so_id').value.trim(); if(!so) return;
  try{
    const r=await apiPost('promoteSalesToPlan',{so_id:so,user:SESSION});
    alert('生産計画を作成しました: '+r.po_id);
    refreshDashboard(true);
  }catch(e){}
}
/* ===== Plan CRUD ===== */
async function createOrderUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const p={ '通知書番号':$('#c_tsuchi').value, '得意先':$('#c_tokui').value, '得意先品番':$('#c_tokui_hin').value, '製番号':$('#c_sei').value, '品名':$('#c_hinmei').value, '品番':$('#c_hinban').value, '図番':$('#c_zuban').value, '管理No':$('#c_kanri').value };
  const editingPo=$('#c_po').value.trim();
  try{
    if(editingPo){
      await apiPost('updateOrder',{po_id:editingPo,updates:p,user:SESSION}); alert('編集保存しました');
    } else {
      const r=await apiPost('createOrder',{payload:p,user:SESSION}); alert('作成: '+r.po_id); $('#c_po').value=r.po_id;
    }
    refreshDashboard(true);
  }catch(e){}
}
async function loadOrderForEdit(){
  const po=$('#c_po').value.trim(); if(!po) return;
  try{
    const o=await apiGet({action:'ticket',po_id:po});
    const set=(id,v)=> $(id).value=v||'';
    set('#c_tsuchi',o['通知書番号']); set('#c_tokui',o['得意先']); set('#c_tokui_hin',o['得意先品番']);
    set('#c_sei',o['製番号']); set('#c_hinmei',o['品名']); set('#c_hinban',o['品番']);
    set('#c_zuban',o['図番']); set('#c_kanri',o['管理No']);
    alert('読み込み完了。');
  }catch(e){}
}
async function deleteOrderUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const po=$('#c_po').value.trim(); if(!po) return; if(!confirm('削除しますか？')) return;
  try{ await apiPost('deleteOrder',{po_id:po,user:SESSION}); alert('削除しました'); refreshDashboard(true); }catch(e){}
}
/* ===== Ship CRUD ===== */
async function scheduleUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const po=$('#s_po').value.trim(), dateIso=$('#s_date').value, qty=$('#s_qty').value;
  if(!po||!dateIso) return alert('注番と日付は必須です');
  try{
    const shipId=$('#s_shipid').value.trim();
    if(shipId){
      await apiPost('updateShipment',{ship_id:shipId,updates:{po_id:po,scheduled_date:dateIso,qty:qty},user:SESSION}); alert('出荷予定を編集しました');
    }else{
      const r=await apiPost('scheduleShipment',{po_id:po,dateIso,qty,user:SESSION}); alert('登録: '+r.ship_id);
    }
    refreshDashboard(true);
  }catch(e){}
}
async function loadShipForEdit(){
  const sid=$('#s_shipid').value.trim(); if(!sid) return;
  try{
    const d=await apiGet({action:'shipById',ship_id:sid});
    $('#s_po').value = d.shipment.po_id||'';
    $('#s_date').value = d.shipment.scheduled_date ? new Date(d.shipment.scheduled_date).toISOString().slice(0,10) : '';
    $('#s_qty').value = d.shipment.qty||0;
    alert('読み込み完了。');
  }catch(e){}
}
async function deleteShipUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  const sid=$('#s_shipid').value.trim(); if(!sid) return; if(!confirm('削除しますか？')) return;
  try{ await apiPost('deleteShipment',{ship_id:sid,user:SESSION}); alert('削除しました'); refreshDashboard(true); }catch(e){}
}

/* ===== Docs & Modals ===== */
function showDialog(id, htmlContent, showFooter=true) {
  const dlg = document.getElementById(id);
  if (!dlg) return;
  const body = dlg.querySelector('.body');
  const footer = dlg.querySelector('footer');
  if (body) body.innerHTML = htmlContent;
  if (footer) footer.style.display = showFooter ? '' : 'none';
  dlg.showModal();
}
async function openTicket(po_id){
  try{
    const o=await apiGet({action:'ticket',po_id});
    const body=`<h3>生産現品票</h3><table>
      <tr><th>管理No</th><td>${o['管理No']||'-'}</td><th>通知書番号</th><td>${o['通知書番号']||'-'}</td></tr>
      <tr><th>得意先</th><td>${o['得意先']||''}</td><th>得意先品番</th><td>${o['得意先品番']||''}</td></tr>
      <tr><th>製番号</th><td>${o['製番号']||''}</td><th>投入日</th><td>${fmtD(o['created_at'])}</td></tr>
      <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
      <tr><th>工程</th><td colspan="3">${o.current_process||''}</td></tr>
      <tr><th>状態</th><td>${o.status||''}</td><th>更新</th><td>${fmtDT(o.updated_at)} / ${o.updated_by||''}</td></tr></table>`;
    showDialog('dlgTicket',body);
  }catch(e){}
}
function showShipDoc(s,o){
  const body=`<h3>出荷確認書</h3><table>
    <tr><th>得意先</th><td>${o['得意先']||''}</td><th>出荷日</th><td>${fmtD(s.scheduled_date)}</td></tr>
    <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
    <tr><th>注番</th><td>${o.po_id||s.po_id}</td><th>数量</th><td>${s.qty||0}</td></tr>
    <tr><th>出荷ステータス</th><td>${s.status||''}</td><th>備考</th><td></td></tr></table>`;
  showDialog('dlgShip',body);
}
async function openShipByPO(po_id){ try{ const d=await apiGet({action:'shipByPo',po_id}); showShipDoc(d.shipment,d.order);}catch(e){} }
async function openShipByID(id){ try{ const d=await apiGet({action:'shipById',ship_id:id}); showShipDoc(d.shipment,d.order);}catch(e){} }

/* ===== Export & Import Helpers ===== */
async function exportCSV(action, filename){
  try {
    const rows = await apiGet({action});
    if(!rows||!rows.length) return;
    const headers=Object.keys(rows[0]);
    const csv=[headers.join(',')].concat( rows.map(r=> headers.map(h=> `"${String(r[h]??'').replaceAll('"','""')}"`).join(',')) ).join('\n');
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=filename; a.click();
    URL.revokeObjectURL(url);
  } catch(e) { console.error('Export failed', e); }
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((header, i) => obj[header] = values[i] ? values[i].trim() : '');
    return obj;
  });
}
async function handleImport(sheetName, fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  if (!confirm(`${file.name} をインポートしますか？\nCSVのヘッダー名がシートのヘッダー名と一致していることを確認してください。`)) {
    fileInput.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = parseCSV(event.target.result);
      if (data.length === 0) throw new Error('CSVファイルが空か、フォーマットが正しくありません。');
      const result = await apiPost('bulkImport', { sheet: sheetName, data, user: SESSION });
      alert(`${result.imported}件のデータをインポートしました。`);
      // Refresh relevant views
      if (sheetName === 'SalesOrders') renderSales();
      else refreshDashboard(true);
    } catch (e) {
      alert(`インポート失敗: ${e.message}`);
    } finally {
      fileInput.value = '';
    }
  };
  reader.readAsText(file);
}

/* ===== Station QR & Scan ===== */
function openStationQR(){
  const wrap = $('#qrWrap'); if(!wrap) return;
  wrap.innerHTML = '';
  const stations = ['レーザ加工','曲げ工程','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立工程','検査工程','出荷工程'];
  stations.forEach((st)=>{
    const div = document.createElement('div');
    div.className = 'tile';
    div.innerHTML = `<div class="row-between"><b>${st}</b></div> <div class="qr-holder"></div>`;
    wrap.appendChild(div);
    const holder=div.querySelector('.qr-holder');
    new QRCode(holder, { text:'ST:'+st, width:180, height:180, correctLevel:QRCode.CorrectLevel.M });
  });
  $('#dlgStationQR').showModal();
}
function startScanFor(po_id){
  CURRENT_PO=po_id;
  $('#scanPO').textContent=po_id;
  $('#scanResult').textContent='開始を押してQRを読み取ってください';
  $('#dlgScan').showModal();
}
async function scanStart(){
  try{
    if(scanStream) return;
    const v=$('#scanVideo'), c=$('#scanCanvas'); if(!v||!c) return;
    const ctx=c.getContext('2d', { willReadFrequently: true });
    scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    v.srcObject=scanStream;
    await v.play();
    scanTimer=setInterval(async ()=>{
      c.width=v.videoWidth; c.height=v.videoHeight;
      ctx.drawImage(v,0,0,c.width,c.height);
      const code=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
      if(code && code.data){
        const text=code.data.trim();
        $('#scanResult').textContent='読取: '+text;
        if(/^ST:/.test(text) && CURRENT_PO){
          scanClose(); // Stop scanning on successful read
          const station=text.slice(3);
          const rule=STATION_RULES[station];
          if(!rule) return $('#scanResult').textContent='未知のステーション: '+station;
          try{
            const cur=await apiGet({action:'ticket',po_id:CURRENT_PO});
            const updates=rule(cur);
            await apiPost('updateOrder',{po_id:CURRENT_PO,updates,user:SESSION});
            $('#scanResult').textContent=`更新完了: ${CURRENT_PO} → ${updates.current_process||cur.current_process}`;
            refreshDashboard(true);
            setTimeout(() => $('#dlgScan').close(), 1000);
          }catch(e){ $('#scanResult').textContent='更新失敗: '+(e.message||e); }
        }
      }
    }, 500);
  }catch(e){ alert('カメラ起動失敗: '+(e.message||e)); }
}
function scanClose(){
  clearInterval(scanTimer); scanTimer=null;
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
}

/* ===== History ===== */
async function openHistory(po_id){
  try{
    const logs=await apiGet({action:'history',po_id});
    const html = logs.length ? `<table><thead><tr><th>時刻</th><th>旧状態</th><th>新状態</th><th>旧工程</th><th>新工程</th><th>更新者</th><th>備考</th></tr></thead>
      <tbody>${logs.map(l=>`<tr><td>${fmtDT(l.timestamp)}</td><td>${l.prev_status||''}</td><td>${l.new_status||''}</td><td>${l.prev_process||''}</td><td>${l.new_process||''}</td><td>${l.updated_by||''}</td><td>${l.note||''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="muted">履歴なし</div>';
    showDialog('dlgHistory', `<h3>更新履歴: ${po_id}</h3>${html}`);
  }catch(e){}
}

/* ===== Invoice UI ===== */
function recalcInvoiceTotals(){
  let sub=0;
  const rows=[...document.querySelectorAll('#invLines tr')];
  rows.forEach(tr=>{
    const qty=Number(tr.querySelector('.q').value||0), up=Number(tr.querySelector('.p').value||0);
    const amt=qty*up;
    tr.querySelector('.a').textContent=amt.toLocaleString();
    sub+=amt;
  });
  const tax=Math.round(sub*0.1), total=sub+tax;
  $('#invSub').textContent=sub.toLocaleString();
  $('#invTax').textContent=tax.toLocaleString();
  $('#invTotal').textContent=total.toLocaleString();
  INV_PREVIEW.info = INV_PREVIEW.info || {};
  Object.assign(INV_PREVIEW.info, { '小計':sub, '税額':tax, '合計':total });
  INV_PREVIEW.lines = rows.map(tr=>({
    行No:Number(tr.dataset.no), 品名:tr.dataset.hinmei, 品番:tr.dataset.hinban, 図番:tr.dataset.zuban,
    数量:Number(tr.querySelector('.q').value||0), 単価:Number(tr.querySelector('.p').value||0),
    出荷IDs:tr.dataset.shipids, POs:tr.dataset.pos
  }));
}
async function previewInvoiceUI(){
  const cust=$('#inv_customer').value.trim(), from=$('#inv_from').value, to=$('#inv_to').value;
  if(!from||!to) return alert('期間を指定してください');
  try{
    const d=await apiGet({action:'previewInvoice',customer:cust,from:from,to:to});
    INV_PREVIEW={info:d.info, lines:d.lines};
    const tbody=$('#invLines');
    tbody.innerHTML = d.lines.map(l=> `<tr data-no="${l.行No}" data-hinmei="${l.品名}" data-hinban="${l.品番}" data-zuban="${l.図番}" data-shipids="${l.出荷IDs||''}" data-pos="${l.POs||''}">
      <td>${l.行No}</td><td>${l.品名}</td><td>${l.品番}</td><td>${l.図番}</td>
      <td><input class="q" type="number" value="${l.数量||0}" style="width:90px"></td>
      <td><input class="p" type="number" value="${l.単価||0}" style="width:90px"></td>
      <td class="a">0</td><td class="s">${l.POs||''}</td><td class="s">${l.出荷IDs||''}</td></tr>`).join('');
    
    $('#inv_customer').value = d.info['得意先']||cust;
    $('#inv_currency').value = d.info['通貨']||'JPY';
    if(!$('#inv_date').value) $('#inv_date').value = new Date().toISOString().slice(0,10);
    
    document.querySelectorAll('#invLines input').forEach(el=> el.oninput=recalcInvoiceTotals);
    recalcInvoiceTotals();
    alert('集計しました。単価を入力し、請求書発行を押してください。');
  }catch(e){}
}
async function createInvoiceUI(){
  if(!(SESSION && (SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部'))) return alert('権限不足');
  if(!INV_PREVIEW.lines.length) return alert('明細がありません。集計してください。');
  Object.assign(INV_PREVIEW.info, {
    '得意先':$('#inv_customer').value, '期間自':$('#inv_from').value, '期間至':$('#inv_to').value,
    '請求日':$('#inv_date').value, '通貨':$('#inv_currency').value, 'メモ':$('#inv_memo').value
  });
  try{
    const r=await apiPost('createInvoice',{payload:INV_PREVIEW,user:SESSION});
    alert('請求書発行: '+r.inv_id);
    INV_PREVIEW.inv_id=r.inv_id;
    openInvoiceDoc(r.inv_id);
  }catch(e){}
}
async function openInvoiceDoc(inv_id){
  if(!inv_id) return alert('先に請求書を発行してください');
  try{
    const d=await apiGet({action:'invoiceDoc',inv_id});
    const {inv, lines} = d;
    const body=`<h3>請求書</h3>
      <table>
        <tr><th>請求番号</th><td>${inv.inv_id}</td><th>請求日</th><td>${fmtD(inv['請求日'])}</td></tr>
        <tr><th>得意先</th><td>${inv['得意先']}</td><th>対象期間</th><td>${fmtD(inv['期間自'])} 〜 ${fmtD(inv['期間至'])}</td></tr>
      </table><br>
      <table><thead><tr><th>#</th><th>品名</th><th>品番</th><th>数量</th><th>単価</th><th>金額</th></tr></thead>
      <tbody>${lines.map(l=>`<tr><td>${l['行No']}</td><td>${l['品名']}</td><td>${l['品番']}</td><td>${l['数量']}</td><td>${l['単価']}</td><td>${l['金額']}</td></tr>`).join('')}</tbody>
      <tfoot>
        <tr><td colspan="4"></td><td>小計</td><td>${inv['小計']}</td></tr>
        <tr><td colspan="4"></td><td>税額</td><td>${inv['税額']}</td></tr>
        <tr><td colspan="4"></td><td><b>合計</b></td><td><b>${inv['合計']}</b></td></tr>
      </tfoot></table>`;
    showDialog('dlgTicket', body);
  }catch(e){}
}
function exportInvoiceCSV(){
  const rows=[...document.querySelectorAll('#invLines tr')].map(tr=>({
    行No:tr.dataset.no, 品名:tr.dataset.hinmei, 品番:tr.dataset.hinban, 図番:tr.dataset.zuban,
    数量:tr.querySelector('.q').value, 単価:tr.querySelector('.p').value, POs:tr.dataset.pos, 出荷IDs:tr.dataset.shipids
  }));
  exportCSV(rows, 'invoice_preview.csv');
}

/* ====== CHARTS PAGE (統計) ====== */
let CHARTS = {};
function fillChartYearSelector(){
  const sel=$('#chartYear'); if(!sel) return;
  const y0=(new Date()).getFullYear();
  sel.innerHTML=[y0-1,y0,y0+1].map(y=>`<option value="${y}" ${y===y0?'selected':''}>${y}</option>`).join('');
}
let chartsLoaded=false;
function ensureChartsLoaded(){ if(!chartsLoaded){ chartsLoaded=true; renderCharts(); } }
async function renderCharts(){
  const year=$('#chartYear').value;
  try{
    const d=await apiGet({action:'charts', year});
    const months=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    Object.values(CHARTS).forEach(c=> c && c.destroy());

    const createChart = (id, type, data, options = {}) => {
      const ctx = $(id)?.getContext('2d');
      if (!ctx) return null;
      return new Chart(ctx, { type, data, options: { responsive: true, maintainAspectRatio: false, ...options } });
    };
    
    CHARTS.monthly = createChart('#chMonthly', 'bar', {labels:months, datasets:[{label:`月別出荷数量 (${d.year})`, data:d.perMonth}]});
    CHARTS.customer = createChart('#chCustomer', 'bar', {labels:Object.keys(d.perCust||{}), datasets:[{label:'得意先別出荷', data:Object.values(d.perCust||{})}]});
    CHARTS.stock = createChart('#chStock', 'pie', {labels:Object.keys(d.stockBuckets||{}), datasets:[{label:'在庫区分', data:Object.values(d.stockBuckets||{})}]});
    CHARTS.wipProc = createChart('#chWipProc', 'bar', {labels:Object.keys(d.wipByProcess||{}), datasets:[{label:'工程内WIP', data:Object.values(d.wipByProcess||{})}]});
    CHARTS.sales = createChart('#chSales', 'line', {labels:months, datasets:[{label:`営業 受注数 (${d.year})`, data:d.salesPerMonth||[], tension:.3}]});
    CHARTS.plan = createChart('#chPlan', 'line', {labels:months, datasets:[{label:`生産計画 作成数 (${d.year})`, data:d.planPerMonth||[], tension:.3}]});

  }catch(e){}
}

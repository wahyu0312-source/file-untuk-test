/* =========================================================
 *  app.js — Tokyo Seimitsu ERP (Frontend)
 *  + Prioritized rendering (skeleton -> metrics -> tabel)
 *  + Ikon berwarna, footer branding
 *  + Optional server limit untuk list (default 200)
 * ========================================================= */

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

/* ===== API helpers (dengan error bar) ===== */
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
    bar.className='errbar';
    document.body.appendChild(bar);
  }
  bar.innerHTML=`<b>APIエラー</b> <code>${action||'-'}</code> — ${err.message||err}`;
}

/* Polyfill requestIdleCallback */
window.requestIdleCallback = window.requestIdleCallback || function (cb){ return setTimeout(()=>cb({didTimeout:false,timeRemaining:()=>0}),1); };

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  /* ---------- Nav ---------- */
  ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvoice','btnToCharts'].forEach(id=>{
    const map={
      btnToDash:'pageDash', btnToSales:'pageSales', btnToPlan:'pagePlan',
      btnToShip:'pageShip', btnToInvoice:'pageInvoice', btnToCharts:'pageCharts'
    };
    const el=$('#'+id); if(el) el.onclick=()=>{ show(map[id]); if(map[id]==='pageCharts') ensureChartsLoaded(); };
  });

  /* ---------- Settings menu ---------- */
  if($('#miStationQR'))  $('#miStationQR').onclick  = openStationQR;
  if($('#miAddUser'))    $('#miAddUser').onclick    = openAddUserModal;
  if($('#miChangePass')) $('#miChangePass').onclick = changePasswordUI;
  if($('#btnLogout'))    $('#btnLogout').onclick    = ()=>{ SESSION=null; localStorage.removeItem('erp_session'); location.reload(); };

  /* ---------- Auth ---------- */
  if($('#btnLogin'))   $('#btnLogin').onclick   = onLogin;
  if($('#btnNewUser')) $('#btnNewUser').onclick = addUserFromLoginUI;

  /* ---------- Dashboard ---------- */
  if($('#btnRefresh'))       $('#btnRefresh').onclick       = refreshAll;
  if($('#searchQ'))          $('#searchQ').addEventListener('input', debounce(renderOrders,200));
  if($('#btnExportOrders'))  $('#btnExportOrders').onclick  = exportOrdersCSV;
  if($('#btnExportShip'))    $('#btnExportShip').onclick    = exportShipCSV;

  /* ---------- Sales ---------- */
  if($('#btnSalesSave'))   $('#btnSalesSave').onclick   = saveSalesUI;
  if($('#btnSalesDelete')) $('#btnSalesDelete').onclick = deleteSalesUI;
  if($('#btnSalesExport')) $('#btnSalesExport').onclick = exportSalesCSV;
  if($('#btnPromote'))     $('#btnPromote').onclick     = promoteSalesUI;
  if($('#salesQ'))         $('#salesQ').addEventListener('input', debounce(renderSales,200));

  /* ---------- Plan ---------- */
  if($('#btnCreateOrder')) $('#btnCreateOrder').onclick = createOrderUI;
  if($('#btnPlanExport'))  $('#btnPlanExport').onclick  = exportOrdersCSV;
  if($('#btnPlanEdit'))    $('#btnPlanEdit').onclick    = loadOrderForEdit;
  if($('#btnPlanDelete'))  $('#btnPlanDelete').onclick  = deleteOrderUI;

  /* ---------- Ship ---------- */
  if($('#btnSchedule'))   $('#btnSchedule').onclick   = scheduleUI;
  if($('#btnShipExport')) $('#btnShipExport').onclick = exportShipCSV;
  if($('#btnShipEdit'))   $('#btnShipEdit').onclick   = loadShipForEdit;
  if($('#btnShipDelete')) $('#btnShipDelete').onclick = deleteShipUI;
  if($('#btnShipByPO'))   $('#btnShipByPO').onclick   = ()=>{ const po=$('#s_po').value.trim(); if(!po) return alert('注番入力'); openShipByPO(po); };
  if($('#btnShipByID'))   $('#btnShipByID').onclick   = ()=>{ const id=prompt('Ship ID:'); if(!id) return; openShipByID(id.trim()); };

  /* ---------- Scan ---------- */
  if($('#btnScanStart')) $('#btnScanStart').onclick = scanStart;
  if($('#btnScanClose')) $('#btnScanClose').onclick = scanClose;

  /* ---------- Invoice ---------- */
  if($('#btnInvPreview')) $('#btnInvPreview').onclick = previewInvoiceUI;
  if($('#btnInvCreate'))  $('#btnInvCreate').onclick  = createInvoiceUI;
  if($('#btnInvPrint'))   $('#btnInvPrint').onclick   = ()=> openInvoiceDoc(INV_PREVIEW.inv_id||'');
  if($('#btnInvCSV'))     $('#btnInvCSV').onclick     = exportInvoiceCSV;

  /* ---------- Charts page ---------- */
  if($('#btnChartsRefresh')) $('#btnChartsRefresh').onclick = renderCharts;
  fillChartYearSelector();

  /* ---------- Restore session ---------- */
  const saved=localStorage.getItem('erp_session');
  if(saved){ SESSION=JSON.parse(saved); enter(); } else { show('authView'); }
});

/* ===== UI helpers ===== */
function show(id){
  const ids=['authView','pageDash','pageSales','pagePlan','pageShip','pageInvoice','pageCharts'];
  ids.forEach(x=>{ const el=document.getElementById(x); if(el) el.classList.add('hidden'); });
  const target=document.getElementById(id);
  if(target) target.classList.remove('hidden');
}
function enter(){
  const ui=$('#userInfo');
  if(ui && SESSION) ui.textContent = `${SESSION.full_name}・${SESSION.department}`;

  // tampilkan menu
  ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvoice','btnToCharts','ddSetting'].forEach(id=>{
    const el=$('#'+id); if(el) el.classList.remove('hidden');
  });

  // hide AddUser jika bukan admin/生産技術
  if(!(SESSION.role==='admin' || SESSION.department==='生産技術')){
    const miAddUser=$('#miAddUser'); if(miAddUser) miAddUser.classList.add('hidden');
  }

  show('pageDash');
  loadMasters();

  // Prioritize render: tampilkan skeleton, fetch summary dulu, lalu tabel
  paintOrdersSkeleton(12);
  refreshSummary();
  requestIdleCallback(()=> refreshAll(true));
}

/* ===== Debounce ===== */
function debounce(fn, wait){
  let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args),wait); };
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

/* ===== Summary (metrics cepat) ===== */
async function refreshSummary(){
  try{
    const s=await apiGet({action:'stock'});
    if($('#statFinished')) $('#statFinished').textContent=s.finishedStock;
    if($('#statReady'))    $('#statReady').textContent=s.ready;
    if($('#statShipped'))  $('#statShipped').textContent=s.shipped;

    const today=await apiGet({action:'todayShip'});
    if($('#listToday')){
      $('#listToday').innerHTML = today.length
        ? today.map(r=>`<div class="row-between s"><span>${r.po_id}</span><span class="muted">${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join('')
        : '<div class="muted">本日予定なし</div>';
    }

    const loc=await apiGet({action:'locSnapshot'});
    if($('#gridProc')) $('#gridProc').innerHTML = PROCESSES.map(p=> `<div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>`).join('');
  }catch(e){ console.error(e); }
}

/* ===== Dashboard list ===== */
async function listOrders(){
  const qEl=$('#searchQ');
  const q = qEl ? qEl.value.trim() : '';
  // limit agar cepat
  return apiGet({action:'listOrders',q,limit:200});
}

function paintOrdersSkeleton(n=10){
  const tbody=$('#tbOrders'); if(!tbody) return;
  tbody.innerHTML = Array.from({length:n}).map(()=>`
    <tr class="skeleton-row">
      <td><div class="sk sk-line w-60"></div><div class="row sk-gap"><div class="sk sk-chip"></div><div class="sk sk-chip"></div></div></td>
      <td><div class="sk sk-line w-50"></div></td>
      <td><div class="sk sk-line w-40"></div></td>
      <td><div class="sk sk-line w-40"></div></td>
      <td><div class="sk sk-badge"></div></td>
      <td><div class="sk sk-badge"></div></td>
      <td><div class="sk sk-line w-40"></div></td>
      <td><div class="sk sk-line w-30"></div></td>
      <td><div class="sk sk-actions"></div></td>
    </tr>`).join('');
}

async function renderOrders(){
  const tbody=$('#tbOrders'); if(!tbody) return;
  if(!tbody.children.length) paintOrdersSkeleton(12);

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

    const statusBadge = `<span class="badge ${stClass}"><i class="fa-solid fa-circle-dot"></i><span>${statusName||'-'}</span></span>`;
    const procBadge   = `<span class="badge ${prClass}"><i class="fa-solid fa-screwdriver-wrench"></i><span>${procName||'-'}</span></span>`;

    const actions = `
      <div class="actions-2col">
        <button class="btn ghost s accent-doc" onclick="openTicket('${r.po_id}')"><i class="fa-regular fa-file-lines"></i> 票</button>
        <button class="btn ghost s accent-scan" onclick="startScanFor('${r.po_id}')"><i class="fa-solid fa-qrcode"></i> 更新</button>
        <button class="btn ghost s accent-ship" onclick="openShipByPO('${r.po_id}')"><i class="fa-solid fa-truck"></i> 出荷票</button>
        <button class="btn ghost s accent-hist" onclick="openHistory('${r.po_id}')"><i class="fa-solid fa-clock-rotate-left"></i> 履歴</button>
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

/* ===== Render semua (dipanggil setelah summary) ===== */
async function refreshAll(keep=false){
  try{
    if(!keep){ const q=$('#searchQ'); if(q) q.value=''; }
    await renderOrders();
    await renderSales();
  }catch(e){ console.error(e); }
}

/* ===== Sales (営業) ===== */
async function renderSales(){
  const tbody=$('#tbSales'); if(!tbody) return;
  const qEl=$('#salesQ'); const q=(qEl&&qEl.value)? qEl.value.trim():'';
  const rows=await apiGet({action:'listSales',q,limit:200});
  tbody.innerHTML = rows.map(r=>`
    <tr>
      <td>${r.so_id||''}</td>
      <td class="s muted">${fmtD(r['受注日'])}</td>
      <td>${r['得意先']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${(r['品番']||'')}/${(r['図番']||'')}</td>
      <td>${r['数量']||0}</td>
      <td class="s muted">${fmtD(r['希望納期'])}</td>
      <td><span class="badge"><i class="fa-regular fa-flag"></i> ${r.status||''}</span></td>
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
  try{ const r=await apiPost('promoteSalesToPlan',{so_id:so,user:SESSION}); alert('生産計画を作成: '+r.po_id); refreshAll(); }catch(e){ alert(e.message||e); }
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
<tr><th>得意先</th><td>${o['得意先']

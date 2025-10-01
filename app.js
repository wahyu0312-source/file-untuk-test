/* ===== Config ===== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwN3oi1TLBKcydOFdSLhydqxYIyLFMyYKQr3Z7Ikors5JnRL6IsWLfeEEajcZSftKdZLw/exec"; //
const API_KEY = ""; // optional
const PROCESSES = ['レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程'];
const MANUAL_STATUSES = ['','生産開始','検査保留','検査済','出荷準備','出荷済','不良品（修理）'];
const STATION_RULES = {
  'レーザ加工': (o)=> ({ current_process:'レーザ加工' }),
  '曲げ工程': (o)=> ({ current_process:'曲げ加工' }),
  '外枠組立': (o)=> ({ current_process:'外枠組立' }),
  'シャッター組立': (o)=> ({ current_process:'シャッター組立' }),
  'シャッター溶接': (o)=> ({ current_process:'シャッター溶接' }),
  'コーキング': (o)=> ({ current_process:'コーキング' }),
  '外枠塗装': (o)=> ({ current_process:'外枠塗装' }),
  // 二段階：組立工程 → 組立（組立中）→（二回目）組立（組立済）
  '組立工程': (o)=> (o.current_process==='組立（組立中）' ? { current_process:'組立（組立済）' } : { current_process:'組立（組立中）' }),
  '検査工程': (o)=> (o.current_process==='検査工程' && !['検査保留','不良品（要リペア）','検査済'].includes(o.status) ? { current_process:'検査工程', status:'検査済' } : { current_process:'検査工程' }),
  '出荷工程': (o)=> (o.status==='出荷準備' ? { current_process:o.current_process||'検査工程', status:'出荷済' } : { current_process:'検査工程', status:'出荷準備' }),
  '外注' : (o)=> ({ current_process:'外注' })
};
const $ = s=>document.querySelector(s);
const $$ = s=>document.querySelectorAll(s);
const fmtDT = s=> s? new Date(s).toLocaleString(): '';
const fmtD = s=> s? new Date(s).toLocaleDateString(): '';
let SESSION=null, CURRENT_PO=null, scanStream=null, scanTimer=null;
let INV_PREVIEW={info:null, lines:[], inv_id:''};
let ORDERS_CACHE=[];

/* ===== Helpers: Status & Process classes ===== */
function statusClass(s) {
  switch (s) {
    case '生産開始': return 'ok';
    case '検査保留': return 'hold';
    case '検査済':   return 'info';
    case '出荷準備': return 'warn';
    case '出荷済':   return 'ship';
    case '不良品（修理）': return 'ng';
    default: return 'muted';
  }
}
function procClass(p){
  if(p==='レーザ加工') return 'laser';
  if(p==='曲げ加工' || p==='曲げ工程') return 'bend';
  if(p==='外枠組立') return 'frame';
  if(p==='シャッター組立') return 'sh-assy';
  if(p==='シャッター溶接') return 'sh-weld';
  if(p==='コーキング') return 'caulk';
  if(p==='外枠塗装') return 'paint';
  if(p==='組立（組立中）') return 'asm-in';
  if(p==='組立（組立済）') return 'asm-ok';
  if(p==='外注') return 'out';
  if(p==='検査工程') return 'inspect';
  return '';
}

/* ===== API helpers with spinner ===== */
async function apiPost(action, body){
  showLoading(true);
  try{
    const payload={action,...body};
    if(API_KEY) payload.apiKey=API_KEY;
    const res=await fetch(API_BASE,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const j=await res.json();
    if(!j.ok) throw new Error(j.error);
    return j.data;
  }finally{ showLoading(false); }
}
async function apiGet(params){
  showLoading(true);
  try{
    const url=API_BASE+'?'+new URLSearchParams(params).toString();
    const res=await fetch(url);
    const j=await res.json();
    if(!j.ok) throw new Error(j.error);
    return j.data;
  }finally{ showLoading(false); }
}
function showLoading(v){ $('#loading').classList.toggle('hidden',!v); }

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  // Nav
  $('#btnToDash').onclick = ()=>show('pageDash');
  $('#btnToSales').onclick= ()=>show('pageSales');
  $('#btnToPlan').onclick = ()=>show('pagePlan');
  $('#btnToShip').onclick = ()=>show('pageShip');
  $('#btnToInvoice').onclick = ()=>show('pageInvoice');
  $('#btnToCharts').onclick = ()=>{ show('pageCharts'); renderChartsPage(); };
  $('#btnShowStationQR').onclick = openStationQR;

  // Auth
  $('#btnLogin').onclick = onLogin;
  $('#btnNewUser').onclick = addUserFromLoginUI;
  $('#btnLogout').onclick = ()=>{ SESSION=null; localStorage.removeItem('erp_session'); location.reload(); };
  $('#btnChangePass').onclick = changePasswordUI;

  // Dashboard
  $('#btnRefresh').onclick = refreshAll;
  $('#searchQ').addEventListener('input', renderOrders);
  $('#btnExportOrders').onclick = exportOrdersCSV;
  $('#btnExportShip').onclick = exportShipCSV;

  // Sales
  $('#btnSalesSave').onclick = saveSalesUI;
  $('#btnSalesDelete').onclick = deleteSalesUI;
  $('#btnSalesExport').onclick = exportSalesCSV;
  $('#btnPromote').onclick = promoteSalesUI;
  $('#salesQ').addEventListener('input', renderSales);

  // Plan
  $('#btnCreateOrder').onclick = createOrderUI;
  $('#btnPlanExport').onclick = exportOrdersCSV;
  $('#btnPlanEdit').onclick = loadOrderForEdit;
  $('#btnPlanDelete').onclick = deleteOrderUI;

  // Ship
  $('#btnSchedule').onclick = scheduleUI;
  $('#btnShipExport').onclick = exportShipCSV;
  $('#btnShipEdit').onclick = loadShipForEdit;
  $('#btnShipDelete').onclick = deleteShipUI;
  $('#btnShipByPO').onclick = ()=>{ const po=$('#s_po').value.trim(); if(!po) return alert('注番入力'); openShipByPO(po); };
  $('#btnShipByID').onclick = ()=>{ const id=prompt('出荷ID:'); if(!id) return; openShipByID(id.trim()); };

  // Scan
  $('#btnScanStart').onclick = scanStart;
  $('#btnScanClose').onclick = scanClose;
  $('#btnManualApply').onclick = manualApply;
  fillManualSelectors();

  // Invoice
  $('#btnInvPreview').onclick = previewInvoiceUI;
  $('#btnInvCreate').onclick = createInvoiceUI;
  $('#btnInvPrint').onclick = ()=>window.print();
  $('#btnInvCSV').onclick = exportInvoiceCSV;

  // Charts page
  $('#btnChartsReload').onclick = renderChartsPage;

  // Restore session
  const saved=localStorage.getItem('erp_session');
  if(saved){ SESSION=JSON.parse(saved); enter(); } else show('authView');

  if(window.lucide){ lucide.createIcons(); }
});

function show(id){
  ['authView','pageDash','pageSales','pagePlan','pageShip','pageInvoice','pageCharts'].forEach(x=>document.getElementById(x)?.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
  if(window.lucide){ lucide.createIcons(); }
}
function enter(){
  $('#userInfo').textContent = `${SESSION.full_name}・${SESSION.department}`; // fixed template string
  ['btnLogout','btnChangePass','btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvoice','btnShowStationQR','btnToCharts'].forEach(id=>$('#'+id).classList.remove('hidden'));
  if (SESSION.role==='admin' || SESSION.department==='生産技術') $('#btnAddUserWeb').classList.remove('hidden'); else $('#btnAddUserWeb').classList.add('hidden');
  $('#btnAddUserWeb').onclick = openAddUserModal;
  show('pageDash');
  loadMasters();
  refreshAll();
}

/* ===== Auth ===== */
async function onLogin(){
  const u=$('#inUser').value.trim(), p=$('#inPass').value.trim();
  try{ const r=await apiPost('login',{username:u,password:p}); SESSION=r; localStorage.setItem('erp_session',JSON.stringify(r)); enter(); }
  catch(e){ alert(e.message||e); }
}
async function addUserFromLoginUI(){
  if(!SESSION) return alert('ログインしてください');
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術')) return alert('権限不足（生産技術）');
  const payload={ username:$('#nuUser').value.trim(), password:$('#nuPass').value.trim(), full_name:$('#nuName').value.trim(), department:$('#nuDept').value, role:$('#nuRole').value };
  if(!payload.username||!payload.password||!payload.full_name) return alert('必須項目');
  try{ await apiPost('createUser',{user:SESSION,payload}); alert('作成しました'); }catch(e){ alert(e.message||e); }
}
async function changePasswordUI(){
  if(!SESSION) return alert('ログインしてください');
  const oldPass=prompt('旧パスワード:'); if(oldPass===null) return;
  const newPass=prompt('新パスワード:'); if(newPass===null) return;
  try{ await apiPost('changePassword',{user:SESSION,oldPass,newPass}); alert('変更しました。再ログインしてください。'); SESSION=null; localStorage.removeItem('erp_session'); location.reload(); }
  catch(e){ alert(e.message||e); }
}

/* ===== Masters ===== */
async function loadMasters(){
  try{
    const m=await apiGet({action:'masters',types:'得意先,品名,品番,図番'});
    const fill=(id,arr)=> $(id).innerHTML=(arr||[]).map(v=>`<option value="${v}"></option>`).join('');
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
    $('#statFinished').textContent=s.finishedStock;
    $('#statReady').textContent=s.ready;
    $('#statShipped').textContent=s.shipped;

    const today=await apiGet({action:'todayShip'});
    $('#listToday').innerHTML = today.length? today.map(r=>`<div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join(''):'<div class="muted">本日予定なし</div>';

    const loc=await apiGet({action:'locSnapshot'});
    $('#gridProc').innerHTML = PROCESSES.map(p=> `
      <div class="grid-chip proc ${procClass(p)}">
        <div class="muted s">${p}</div>
        <div class="h">${loc[p]||0}</div>
      </div>`
    ).join('');

    if(!keep) $('#searchQ').value='';
    await renderOrders();
    await renderSales();
  }catch(e){ console.error(e); }
}

async function listOrders(){
  const q=$('#searchQ').value.trim();
  const rows=await apiGet({action:'listOrders',q});
  ORDERS_CACHE=rows;
  return rows;
}

async function renderOrders(){
  const rows=await listOrders();
  $('#tbOrders').innerHTML = rows.map(r=> `
    <tr>
      <td><b>${r.po_id}</b></td>
      <td>${r['得意先']||''}</td>
      <td>${r['製番号']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td><span class="badge ${statusClass(r.status)}">${r.status}</span></td>
      <td>
        <select class="s selProc" data-po="${r.po_id}">
          ${PROCESSES.map(p=>`<option ${p===r.current_process?'selected':''}>${p}</option>`).join('')}
        </select>
      </td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
      <td class="s">
        <button class="btn ghost s" onclick="openTicket('${r.po_id}')"><i data-lucide="file-badge-2"></i>票</button>
        <button class="btn ghost s" onclick="startScanFor('${r.po_id}')"><i data-lucide="scan-line"></i>更新</button>
        <button class="btn ghost s" onclick="openShipByPO('${r.po_id}')"><i data-lucide="file-check-2"></i>出荷票</button>
        <button class="btn ghost s" onclick="openHistory('${r.po_id}')"><i data-lucide="history"></i>履歴</button>
      </td>
    </tr>`).join('');

  $$('.selProc').forEach(sel=>{
    sel.onchange = async (e)=>{
      const po=e.target.dataset.po, val=e.target.value;
      const row=ORDERS_CACHE.find(x=>x.po_id===po);
      const prev=row.current_process;
      row.current_process=val;
      e.target.disabled=true;
      try{ await apiPost('updateOrder',{po_id:po,updates:{current_process:val},user:SESSION}); }
      catch(err){ alert(err.message||err); row.current_process=prev; e.target.value=prev; }
      finally{ e.target.disabled=false; }
    };
  });
  if(window.lucide){ lucide.createIcons(); }
}

/* ===== Sales ===== */
async function renderSales(){
  const q=$('#salesQ').value?.trim()||'';
  const rows=await apiGet({action:'listSales',q});
  $('#tbSales').innerHTML = rows.map(r=> `
    <tr>
      <td>${r.so_id}</td>
      <td class="s muted">${fmtD(r['受注日'])}</td>
      <td>${r['得意先']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${(r['品番']||'')}/${(r['図番']||'')}</td>
      <td>${r['数量']||0}</td>
      <td class="s muted">${fmtD(r['希望納期'])}</td>
      <td><span class="badge ${statusClass(r.status||'')}">${r.status||''}</span></td>
      <td>${r['linked_po_id']||''}</td>
      <td class="s muted">${fmtDT(r['更新']||r['updated_at'])}</td>
    </tr>`).join('');
}
async function saveSalesUI(){
  const p={'受注日':$('#so_date').value,'得意先':$('#so_cust').value,'品名':$('#so_item').value,'品番':$('#so_part').value,'図番':$('#so_drw').value,'製番号':$('#so_sei').value,'数量':$('#so_qty').value,'希望納期':$('#so_req').value,'備考':$('#so_note').value};
  const so=$('#so_id').value.trim();
  try{
    if(so){ await apiPost('updateSalesOrder',{so_id:so,updates:p,user:SESSION}); alert('受注を更新しました'); }
    else { const r=await apiPost('createSalesOrder',{payload:p,user:SESSION}); alert('受注登録: '+r.so_id); $('#so_id').value=r.so_id; }
    renderSales();
  }catch(e){ alert(e.message||e); }
}
async function deleteSalesUI(){
  const so=$('#so_id').value.trim(); if(!so) return alert('SO入力'); if(!confirm('削除しますか？')) return;
  try{ const r=await apiPost('deleteSalesOrder',{so_id:so,user:SESSION}); alert('削除: '+r.deleted); renderSales(); }
  catch(e){ alert(e.message||e); }
}
async function promoteSalesUI(){
  const so=$('#so_id').value.trim(); if(!so) return alert('SO入力');
  try{ const r=await apiPost('promoteSalesToPlan',{so_id:so,user:SESSION}); alert('生産計画を作成: '+r.po_id); refreshAll(); }catch(e){ alert(e.message||e); }
}
async function exportSalesCSV(){ const rows=await apiGet({action:'listSales'}); downloadCSV('sales_orders.csv', rows); }

/* ===== Plan ===== */
async function createOrderUI(){
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部')) return alert('権限不足');
  const p={'通知書番号':$('#c_tsuchi').value.trim(),'得意先':$('#c_tokui').value.trim(),'得意先品番':$('#c_tokui_hin').value.trim(),'製番号':$('#c_sei').value.trim(),'品名':$('#c_hinmei').value.trim(),'品番':$('#c_hinban').value.trim(),'図番':$('#c_zuban').value.trim(),'管理No':$('#c_kanri').value.trim()};
  const editingPo=$('#c_po').value.trim();
  try{
    if(editingPo){ await apiPost('updateOrder',{po_id:editingPo,updates:p,user:SESSION}); alert('編集保存しました'); }
    else{ const r=await apiPost('createOrder',{payload:p,user:SESSION}); alert('作成: '+r.po_id); $('#c_po').value=r.po_id; }
    refreshAll();
  }catch(e){ alert(e.message||e); }
}
async function loadOrderForEdit(){
  const po=$('#c_po').value.trim(); if(!po) return alert('注番入力');
  try{
    const o=await apiGet({action:'ticket',po_id:po});
    $('#c_tsuchi').value=o['通知書番号']||''; $('#c_tokui').value=o['得意先']||''; $('#c_tokui_hin').value=o['得意先品番']||''; $('#c_sei').value=o['製番号']||''; $('#c_hinmei').value=o['品名']||''; $('#c_hinban').value=o['品番']||''; $('#c_zuban').value=o['図番']||''; $('#c_kanri').value=o['管理No']||''; alert('読み込み完了。');
  }catch(e){ alert(e.message||e); }
}
async function deleteOrderUI(){
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部')) return alert('権限不足');
  const po=$('#c_po').value.trim(); if(!po) return alert('注番入力'); if(!confirm('削除しますか？')) return;
  try{ const r=await apiPost('deleteOrder',{po_id:po,user:SESSION}); alert('削除:'+r.deleted); refreshAll(); }
  catch(e){ alert(e.message||e); }
}

/* ===== Ship ===== */
async function scheduleUI(){
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部')) return alert('権限不足');
  const po=$('#s_po').value.trim(), dateIso=$('#s_date').value, qty=$('#s_qty').value; if(!po||!dateIso) return alert('注番と日付');
  try{
    const shipId=$('#s_shipid').value.trim();
    if (shipId){ await apiPost('updateShipment',{ship_id:shipId,updates:{po_id:po,scheduled_date:dateIso,qty:qty},user:SESSION}); alert('出荷予定を編集しました'); }
    else{ const r=await apiPost('scheduleShipment',{po_id:po,dateIso,qty,user:SESSION}); alert('登録: '+r.ship_id); }
    refreshAll(true);
  }catch(e){ alert(e.message||e); }
}
async function loadShipForEdit(){
  const sid=$('#s_shipid').value.trim(); if(!sid) return alert('出荷ID入力');
  try{ const d=await apiGet({action:'shipById',ship_id:sid}); $('#s_po').value=d.shipment.po_id||''; $('#s_date').value = d.shipment.scheduled_date? new Date(d.shipment.scheduled_date).toISOString().slice(0,10):''; $('#s_qty').value=d.shipment.qty||0; alert('読み込み完了。'); }
  catch(e){ alert(e.message||e); }
}
async function deleteShipUI(){
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部')) return alert('権限不足');
  const sid=$('#s_shipid').value.trim(); if(!sid) return alert('出荷ID入力'); if(!confirm('削除しますか？')) return;
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
      <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')} / ${(o['図番']||'')}</td></tr>
      <tr><th>工程</th><td colspan="3">${o.current_process} <span class="badge ${statusClass('info')} ${'proc '+procClass(o.current_process)}" style="margin-left:.4rem">工程</span></td></tr>
      <tr><th>状態</th><td colspan="3"><span class="badge ${statusClass(o.status)}">${o.status}</span> <span class="muted s" style="margin-left:.4rem">更新: ${fmtDT(o.updated_at)} / ${o.updated_by||''}</span></td></tr>
    </table>`;
    showDoc('dlgTicket',body);
  }catch(e){ alert(e.message||e); }
}
function showShipDoc(s,o){
  const dt=s.scheduled_date? new Date(s.scheduled_date):null;
  const body=`<h3>出荷確認書</h3><table>
    <tr><th>得意先</th><td>${o['得意先']||''}</td><th>出荷日</th><td>${dt?dt.toLocaleDateString():'-'}</td></tr>
    <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')} / ${(o['図番']||'')}</td></tr>
    <tr><th>注番</th><td>${o.po_id||s.po_id}</td><th>数量</th><td>${s.qty||0}</td></tr>
    <tr><th>出荷ステータス</th><td colspan="3"><span class="badge ${statusClass(s.status)}">${s.status}</span></td></tr>
  </table>`;
  showDoc('dlgShip',body);
}
async function openShipByPO(po_id){ try{ const d=await apiGet({action:'shipByPo',po_id}); showShipDoc(d.shipment,d.order);}catch(e){ alert(e.message||e);} }
async function openShipByID(id){ try{ const d=await apiGet({action:'shipById',ship_id:id}); showShipDoc(d.shipment,d.order);}catch(e){ alert(e.message||e);} }
function showDoc(id,html){ const dlg=document.getElementById(id); dlg.querySelector('.body').innerHTML=html; dlg.showModal(); }

/* ===== Export ===== */
async function exportOrdersCSV(){ const rows=await apiGet({action:'listOrders'}); downloadCSV('orders.csv',rows); }
async function exportShipCSV(){ const rows=await apiGet({action:'todayShip'}); downloadCSV('ship_today.csv',rows); }
function downloadCSV(name,rows){ if(!rows||!rows.length) return downloadFile(name,''); const headers=Object.keys(rows[0]); const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replaceAll('"','""')).map(v=>`"${v}"`).join(','))).join('\n'); downloadFile(name,csv); }
function downloadFile(name,content){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:'text/csv'})); a.download=name; a.click(); }

/* ===== Station QR (include 外注) ===== */
function openStationQR(){
  const wrap = $('#qrWrap'); wrap.innerHTML = '';
  const stations = ['レーザ加工','曲げ工程','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立工程','検査工程','出荷工程','外注'];
  stations.forEach((st)=>{
    const div = document.createElement('div');
    div.className = 'tile';
    div.innerHTML = `
      <div class="row-between"><b>${st}</b><a class="btn ghost s" target="_blank"><i data-lucide="download"></i>PNG</a></div>
      <div class="qr-holder" style="background:#fff;border:1px solid #e3e6ef;border-radius:8px;display:inline-block"></div>
      <div class="s muted">内容: ST:${st}</div>`;
    wrap.appendChild(div);
    const holder=div.querySelector('.qr-holder');
    const link=div.querySelector('a');
    new QRCode(holder,{ text:'ST:'+st, width:200, height:200, correctLevel:QRCode.CorrectLevel.M });
    setTimeout(()=>{
      const cvs=holder.querySelector('canvas');
      const img=holder.querySelector('img');
      let url='';
      if(cvs&&cvs.toDataURL) url=cvs.toDataURL('image/png');
      else if(img&&img.src) url=img.src;
      if(url){ link.href=url; link.download=`ST-${st}.png`; } else link.remove();
      if(window.lucide){ lucide.createIcons(); }
    },50);
  });
  document.getElementById('dlgStationQR').showModal();
}

/* ===== Scan: kamera + opsi file + keyboard ===== */
let KB_BUFFER = '', KB_TIMER = null;
function attachKeyboardScanner(enable = true) {
  const handler = (e) => {
    if ($('#kbMode')?.checked !== true) return;
    if (KB_TIMER) clearTimeout(KB_TIMER);
    if (e.key === 'Enter') {
      const txt = KB_BUFFER.trim();
      KB_BUFFER = '';
      if (txt) handleScannedText(txt);
      return;
    }
    if (e.key.length === 1) KB_BUFFER += e.key;
    KB_TIMER = setTimeout(() => { KB_BUFFER = ''; }, 600);
  };
  if (enable) { window.addEventListener('keydown', handler); attachKeyboardScanner._handler = handler; }
  else if (attachKeyboardScanner._handler) { window.removeEventListener('keydown', attachKeyboardScanner._handler); attachKeyboardScanner._handler = null; }
}

async function tryBarcodeDetectorOnce(videoEl, canvasEl) {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const ctx = canvasEl.getContext('2d');
    canvasEl.width = videoEl.videoWidth; canvasEl.height = videoEl.videoHeight;
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    const bmp = await createImageBitmap(canvasEl);
    const codes = await detector.detect(bmp);
    return (codes && codes[0]?.rawValue) ? codes[0].rawValue : null;
  } catch { return null; }
}

async function scanFromFile(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const code = jsQR(id.data, c.width, c.height);
  URL.revokeObjectURL(url);
  return code ? code.data.trim() : '';
}

async function handleScannedText(text) {
  if (!text) return;
  $('#scanResult').textContent = '読み取り: ' + text;
  if (/^ST:/.test(text) && CURRENT_PO) {
    const station = text.slice(3);
    const rule = STATION_RULES[station];
    if (!rule) { $('#scanResult').textContent = '未知のステーション: ' + station; return; }
    try{
      const cur = ORDERS_CACHE.find(x=>x.po_id===CURRENT_PO) || await apiGet({action:'ticket',po_id:CURRENT_PO});
      const updates = rule(cur);
      $('#scanResult').textContent = '更新中...';
      await apiPost('updateOrder',{po_id:CURRENT_PO,updates,user:SESSION});
      $('#scanResult').textContent = `更新完了: ${CURRENT_PO} → ${updates.status||'(状態変更なし)'} / ${updates.current_process||cur.current_process}`;
      refreshAll(true);
    }catch(e){ $('#scanResult').textContent='更新失敗: '+(e.message||e); }
  }
}

function startScanFor(po_id){
  CURRENT_PO=po_id;
  $('#scanPO').textContent=po_id;
  $('#scanResult').textContent='開始を押してQRを読み取ってください（iOSはSafari推奨）。';
  document.getElementById('dlgScan').showModal();
}

async function scanStart(){
  try{
    if(location.protocol!=='https:') { alert('カメラ利用にはHTTPSが必要です（GitHub Pages/自社ドメイン推奨）'); return; }
    if(scanStream) return; // already

    const v=$('#scanVideo'), c=$('#scanCanvas'), ctx=c.getContext('2d');
    const st=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    scanStream=st; v.srcObject=st; await v.play();

    // tombol unggah gambar
    $('#btnScanFromFile').onclick = () => $('#fileQR').click();
    $('#fileQR').onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const txt = await scanFromFile(f);
      if (txt) handleScannedText(txt); else $('#scanResult').textContent = 'Tidak terdeteksi dari gambar.';
    };

    // keyboard mode
    $('#kbMode').onchange = (e)=> attachKeyboardScanner(e.target.checked);
    attachKeyboardScanner($('#kbMode').checked === true);

    scanTimer=setInterval(async ()=>{
      if(v.readyState<2) return;
      const bd = await tryBarcodeDetectorOnce(v, c);
      if (bd) { handleScannedText(bd); return; }
      c.width=v.videoWidth; c.height=v.videoHeight;
      ctx.drawImage(v,0,0,c.width,c.height);
      const code=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
      if(code && code.data) handleScannedText(code.data.trim());
    }, 400);
  }catch(e){
    alert('カメラ起動失敗: '+(e.message||e)+'\nブラウザのロックアイコン→サイトの設定→カメラ→「許可」を選択してください。');
  }
}

function scanClose(){
  clearInterval(scanTimer); scanTimer=null;
  attachKeyboardScanner(false);
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
  document.getElementById('dlgScan').close();
}

function fillManualSelectors(){
  $('#manualProc').innerHTML = PROCESSES.map(p=>`<option value="${p}">${p}</option>`).join('');
  $('#manualStatus').innerHTML = MANUAL_STATUSES.map(s=>`<option value="${s}">${s||'（変更なし）'}</option>`).join('');
}
async function manualApply(){
  if(!CURRENT_PO) return alert('注番が未選択');
  const proc=$('#manualProc').value, st=$('#manualStatus').value; const updates={};
  if(proc) updates.current_process=proc; if(st) updates.status=st;
  try{ await apiPost('updateOrder',{po_id:CURRENT_PO,updates,user:SESSION}); alert('手動更新しました'); refreshAll(true); }
  catch(e){ alert(e.message||e); }
}

/* ===== History ===== */
async function openHistory(po_id){
  try{
    const logs=await apiGet({action:'history',po_id});
    const html = logs.length? `
      <table><thead><tr><th>時刻</th><th>旧状態</th><th>新状態</th><th>旧工程</th><th>新工程</th><th>更新者</th><th>備考</th></tr></thead>
      <tbody>${logs.map(l=>`<tr><td>${fmtDT(l.timestamp)}</td><td>${l.prev_status||''}</td><td><span class="badge ${statusClass(l.new_status)}">${l.new_status||''}</span></td><td>${l.prev_process||''}</td><td>${l.new_process||''}</td><td>${l.updated_by||''}</td><td>${l.note||''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="muted">履歴なし</div>';
    $('#histBody').innerHTML=html; document.getElementById('dlgHistory').showModal();
  }catch(e){ alert(e.message||e); }
}

/* ===== Add user ===== */
function openAddUserModal(){
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術')) return alert('権限不足');
  const html=`<h3>ユーザー追加</h3>
    <div class="grid m1">
      <input id="au_username" placeholder="ユーザー名">
      <input id="au_password" type="password" placeholder="パスワード">
      <input id="au_fullname" placeholder="氏名">
      <select id="au_dept"><option>営業</option><option>生産技術</option><option>生産管理部</option><option>製造部</option><option>検査部</option></select>
      <select id="au_role"><option>member</option><option>manager</option><option>admin</option></select>
    </div>
    <div class="row-end" style="margin-top:.6rem"><button class="btn primary" id="au_save"><i data-lucide="save"></i>保存</button></div>`;
  const dlg=document.getElementById('dlgTicket'); dlg.querySelector('.body').innerHTML=html; dlg.showModal();
  document.getElementById('au_save').onclick=async ()=>{
    const payload={ username:$('#au_username').value.trim(), password:$('#au_password').value.trim(), full_name:$('#au_fullname').value.trim(), department:$('#au_dept').value, role:$('#au_role').value };
    if(!payload.username||!payload.password||!payload.full_name) return alert('必須項目');
    try{ await apiPost('createUser',{user:SESSION,payload}); alert('作成しました'); dlg.close(); }catch(e){ alert(e.message||e); }
  };
  if(window.lucide){ lucide.createIcons(); }
}

/* ===== Invoice (per-shipment lines) ===== */
function recalcInvoiceTotals(){
  let sub=0;
  [...document.querySelectorAll('#invLines tr')].forEach(tr=>{
    const qty=Number(tr.querySelector('.q')?.value||0);
    const up =Number(tr.querySelector('.p')?.value||0);
    const amt=qty*up; tr.querySelector('.a').textContent=amt.toLocaleString(); sub+=amt;
  });
  const tax=Math.round(sub*0.1), total=sub+tax;
  $('#invSub').textContent=sub.toLocaleString();
  $('#invTax').textContent=tax.toLocaleString();
  $('#invTotal').textContent=total.toLocaleString();
  INV_PREVIEW.info = INV_PREVIEW.info || {};
  INV_PREVIEW.info['小計']=sub; INV_PREVIEW.info['税額']=tax; INV_PREVIEW.info['合計']=total;
  INV_PREVIEW.lines = [...document.querySelectorAll('#invLines tr')].map(tr=>({ 行No:Number(tr.dataset.no), 品名:tr.dataset.hinmei, 品番:tr.dataset.hinban, 図番:tr.dataset.zuban, 数量:Number(tr.querySelector('.q').value||0), 単価:Number(tr.querySelector('.p').value||0), 出荷ID:tr.dataset.shipid, PO:tr.dataset.po }));
}
async function previewInvoiceUI(){
  const cust=$('#inv_customer').value.trim(), from=$('#inv_from').value, to=$('#inv_to').value; if(!from||!to) return alert('期間を指定してください');
  try{
    const d=await apiGet({action:'previewInvoice',customer:cust,from:from,to:to});
    INV_PREVIEW={info:d.info, lines:d.lines, inv_id:''};
    $('#invLines').innerHTML = d.lines.map(l=> `
      <tr data-no="${l.行No}" data-hinmei="${l.品名}" data-hinban="${l.品番}" data-zuban="${l.図番}" data-shipid="${l.出荷ID}" data-po="${l.PO}">
        <td>${l.行No}</td>
        <td>${l.品名}</td>
        <td>${l.品番}</td>
        <td>${l.図番}</td>
        <td><input class="q" type="number" value="${l.数量||0}" style="width:90px"></td>
        <td><input class="p" type="number" value="${l.単価||0}" style="width:90px"></td>
        <td class="a">0</td>
        <td class="s">${l.PO}</td>
        <td class="s">${l.出荷ID}</td>
      </tr>`).join('');
    $('#inv_customer').value = d.info['得意先']||cust;
    $('#inv_currency').value = d.info['通貨']||'JPY';
    if(!$('#inv_date').value) $('#inv_date').value = new Date().toISOString().slice(0,10);
    document.querySelectorAll('#invLines input').forEach(el=> el.oninput=recalcInvoiceTotals);
    recalcInvoiceTotals();
  }catch(e){ alert(e.message||e); }
}
async function createInvoiceUI(){
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部')) return alert('権限不足');
  if(!INV_PREVIEW.lines.length) return alert('明細がありません。集計してください。');
  INV_PREVIEW.info = { ...(INV_PREVIEW.info||{}), '得意先': $('#inv_customer').value.trim(), '期間自': $('#inv_from').value, '期間至': $('#inv_to').value, '請求日': $('#inv_date').value, '通貨': $('#inv_currency').value.trim()||'JPY', 'メモ': $('#inv_memo').value.trim() };
  try{ const r=await apiPost('createInvoice',{payload:INV_PREVIEW,user:SESSION}); alert('請求書発行: '+r.inv_id); INV_PREVIEW.inv_id=r.inv_id; openInvoiceDoc(r.inv_id); }
  catch(e){ alert(e.message||e); }
}
async function openInvoiceDoc(inv_id){
  if(!inv_id){ alert('先に請求書を発行してください'); return; }
  try{
    const d=await apiGet({action:'invoiceDoc',inv_id});
    const inv=d.inv, lines=d.lines;
    const body=`<h3>請求書</h3>
      <table>
        <tr><th>請求番号</th><td>${inv.inv_id}</td><th>請求日</th><td>${fmtD(inv['請求日'])}</td></tr>
        <tr><th>得意先</th><td>${inv['得意先']}</td><th>対象期間</th><td>${fmtD(inv['期間自'])} 〜 ${fmtD(inv['期間至'])}</td></tr>
        <tr><th>通貨</th><td>${inv['通貨']||'JPY'}</td><th>備考</th><td>${inv['メモ']||''}</td></tr>
      </table><br>
      <table>
        <thead><tr><th>#</th><th>品名</th><th>品番</th><th>図番</th><th>数量</th><th>単価</th><th>金額</th><th>注番</th><th>出荷ID</th></tr></thead>
        <tbody>${lines.map(l=>`<tr><td>${l['行No']}</td><td>${l['品名']}</td><td>${l['品番']}</td><td>${l['図番']}</td><td>${l['数量']}</td><td>${l['単価']}</td><td>${l['金額']}</td><td>${l['PO']||''}</td><td>${l['出荷ID']||''}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr><td colspan="5"></td><td>小計</td><td>${inv['小計']}</td><td colspan="2"></td></tr>
          <tr><td colspan="5"></td><td>税額</td><td>${inv['税額']}</td><td colspan="2"></td></tr>
          <tr><td colspan="5"></td><td><b>合計</b></td><td><b>${inv['合計']}</b></td><td colspan="2"></td></tr>
        </tfoot>
      </table>`;
    showDoc('dlgTicket', body);
  }catch(e){ alert(e.message||e); }
}
function exportInvoiceCSV(){
  const rows=[...document.querySelectorAll('#invLines tr')].map(tr=>({ 行No:tr.dataset.no, 品名:tr.dataset.hinmei, 品番:tr.dataset.hinban, 図番:tr.dataset.zuban, 数量:tr.querySelector('.q').value, 単価:tr.querySelector('.p').value, 注番:tr.dataset.po, 出荷ID:tr.dataset.shipid }));
  downloadCSV('invoice_preview.csv', rows);
}

/* ===== Charts page (Pareto + others) ===== */
let CHARTS={};
async function renderChartsPage(){
  const d=await apiGet({action:'charts'});
  const labels=Object.keys(d.defectByProc||{});
  const vals=Object.values(d.defectByProc||{});
  const total=vals.reduce((a,b)=>a+b,0)||1; let cum=0; const cumPct=vals.map(v=> (cum+=v)/total*100 );
  CHARTS.pareto?.destroy();
  CHARTS.pareto=new Chart($('#chartPareto'),{ type:'bar', data:{labels,datasets:[{label:'不良件数(工程別)',data:vals,yAxisID:'y'}]}, options:{responsive:true,plugins:{legend:{display:true}},scales:{y:{beginAtZero:true}, y1:{type:'linear',position:'right',min:0,max:100,ticks:{callback:v=>v+'%'}}}} });
  CHARTS.cust?.destroy(); CHARTS.cust=new Chart($('#chartCustomer'),{type:'pie',data:{labels:Object.keys(d.perCust),datasets:[{data:Object.values(d.perCust)}]}});
  CHARTS.month?.destroy(); CHARTS.month=new Chart($('#chartMonthly'),{type:'bar',data:{labels:['1','2','3','4','5','6','7','8','9','10','11','12'],datasets:[{label:'月別出荷数量（'+d.year+'）',data:d.perMonth}]}});
  CHARTS.stock?.destroy(); CHARTS.stock=new Chart($('#chartStock'),{type:'pie',data:{labels:Object.keys(d.stockBuckets),datasets:[{data:Object.values(d.stockBuckets)}]}});
}

/* ===== Utils ===== */
function fillManualSelectorsIf(){ if(!$('#manualProc').children.length) fillManualSelectors(); }
```

/* ===== Config ===== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwN3oi1TLBKcydOFdSLhydqxYIyLFMyYKQr3Z7Ikors5JnRL6IsWLfeEEajcZSftKdZLw/exec"; // << GANTI
const API_KEY = ""; // optional
const PROCESSES = ['レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程'];

const $ = s=>document.querySelector(s);
const $$ = s=>document.querySelectorAll(s);
const fmtDT = s=> s? new Date(s).toLocaleString(): '';
const fmtD  = s=> s? new Date(s).toLocaleDateString(): '';

let SESSION=null, ORDERS_CACHE=[];

/* ===== Badge helpers ===== */
function statusClass(s){
  switch(String(s)){
    case '生産開始': return 'st-start';
    case '検査保留': return 'st-hold';
    case '検査済':   return 'st-done';
    case '出荷準備': return 'st-ready';
    case '出荷済':   return 'st-shipped';
    case '不良品（要リペア）': return 'st-ng';
    default: return 'st-start';
  }
}
const badge = (text, cls)=> `<span class="badge ${cls}">${text??''}</span>`;

/* ===== API helpers ===== */
async function apiPost(action, body){
  showLoading(true);
  try{
    const payload={action,...body}; if(API_KEY) payload.apiKey=API_KEY;
    const res=await fetch(API_BASE,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const j=await res.json(); if(!j.ok) throw new Error(j.error); return j.data;
  }finally{ showLoading(false); }
}
async function apiGet(params){
  showLoading(true);
  try{
    const url=API_BASE+'?'+new URLSearchParams(params).toString();
    const res=await fetch(url); const j=await res.json(); if(!j.ok) throw new Error(j.error); return j.data;
  }finally{ showLoading(false); }
}
function showLoading(v){ $('#loading').classList.toggle('hidden',!v); }

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  $('#btnToDash').onclick = ()=>show('pageDash');
  $('#btnToSales').onclick= ()=>alert('Sales page omitted');
  $('#btnToPlan').onclick = ()=>alert('Plan page omitted');
  $('#btnToShip').onclick = ()=>alert('Ship page omitted');
  $('#btnToInvoice').onclick = ()=>alert('Invoice page omitted');
  $('#btnToCharts').onclick = ()=>alert('Charts page omitted');

  $('#btnLogin').onclick = onLogin;
  $('#btnNewUser').onclick = addUserFromLoginUI;
  $('#btnLogout').onclick = ()=>{ SESSION=null; localStorage.removeItem('erp_session'); location.reload(); };
  $('#btnChangePass').onclick = changePasswordUI;

  $('#btnRefresh').onclick = refreshAll;
  $('#searchQ').addEventListener('input', renderOrders);
  $('#btnExportOrders').onclick = exportOrdersCSV;
  $('#btnExportShip').onclick = exportShipCSV;

  const saved=localStorage.getItem('erp_session');
  if(saved){ SESSION=JSON.parse(saved); enter(); } else show('authView');

  if(window.lucide){ lucide.createIcons(); }
});

function show(id){
  ['authView','pageDash'].forEach(x=>document.getElementById(x)?.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
  if(window.lucide){ lucide.createIcons(); }
}
function enter(){
  $('#userInfo').textContent = `${SESSION.full_name}・${SESSION.department}`;
  ['btnLogout','btnChangePass','btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvoice','btnShowStationQR','btnToCharts'].forEach(id=>$('#'+id).classList.remove('hidden'));
  show('pageDash'); refreshAll();
}

/* ===== Auth ===== */
async function onLogin(){
  const u=$('#inUser').value.trim(), p=$('#inPass').value.trim();
  try{
    const r=await apiPost('login',{username:u,password:p}); SESSION=r; localStorage.setItem('erp_session',JSON.stringify(r)); enter();
  }catch(e){ alert(e.message||e); }
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
  try{
    await apiPost('changePassword',{user:SESSION,oldPass,newPass});
    alert('変更しました。再ログインしてください。'); SESSION=null; localStorage.removeItem('erp_session'); location.reload();
  }catch(e){ alert(e.message||e); }
}

/* ===== Dashboard ===== */
async function refreshAll(){
  try{
    const s=await apiGet({action:'stock'});
    $('#statFinished').textContent=s.finishedStock;
    $('#statReady').textContent=s.ready; $('#statShipped').textContent=s.shipped;

    const today=await apiGet({action:'todayShip'});
    $('#listToday').innerHTML = today.length? today.map(r=>`
      <div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>
    `).join(''):'<div class="muted">本日予定なし</div>';

    const loc=await apiGet({action:'locSnapshot'});
    $('#gridProc').innerHTML = PROCESSES.map(p=>`
      <div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>
    `).join('');

    await renderOrders();
    await loadFinishedStock(); // NEW: table rendering
  }catch(e){ console.error(e); }
}

/* 生産一覧 */
async function listOrders(){ const q=$('#searchQ').value.trim(); const rows=await apiGet({action:'listOrders',q}); ORDERS_CACHE=rows; return rows; }
async function renderOrders(){
  const rows=await listOrders();
  $('#tbOrders').innerHTML = rows.map(r=>{
    const pIdx = Math.max(0, PROCESSES.indexOf(r.current_process||''));
    const pClass = `p${pIdx}`;
    return `
    <tr>
      <td><b>${r.po_id}</b></td>
      <td>${r['得意先']||''}</td>
      <td>${r['製番号']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td>${badge(r.status, 'st '+statusClass(r.status))}</td>
      <td>${badge(r.current_process||'', 'proc')}</td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
      <td class="s">
        <div class="ops-grid ops-box ${pClass}">
          <button class="btn ghost s" onclick="openTicket('${r.po_id}')"><i data-lucide="file-badge-2"></i>票</button>
          <button class="btn ghost s" onclick="openHistory('${r.po_id}')"><i data-lucide="history"></i>履歴</button>
          <button class="btn ghost s" onclick="openShipByPO('${r.po_id}')"><i data-lucide="file-check-2"></i>出荷票</button>
          <button class="btn ghost s" onclick="alert('更新はスキャン/権限から')"><i data-lucide="refresh-ccw"></i>更新</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  if(window.lucide){ lucide.createIcons(); }
}

/* ===== 完成品在庫（明細）: tampil seperti 生産一覧 ===== */
async function loadFinishedStock(){
  try{
    const rows = await apiGet({action:'finishedStockList'});
    const tb = $('#tbFinished');
    if(!rows.length){
      tb.innerHTML = `<tr><td colspan="10" class="muted">（現在なし）</td></tr>`;
    }else{
      tb.innerHTML = rows.map(r=>{
        const pIdx = Math.max(0, PROCESSES.indexOf(r['現工程']||''));
        const pClass = `p${pIdx}`;
        return `
          <tr>
            <td><b>${r.po_id}</b></td>
            <td>${r['得意先']||''}</td>
            <td>${r['品名']||''}</td>
            <td>${r['品番']||''}</td>
            <td>${r['図番']||''}</td>
            <td>${r['数量']||0}</td>
            <td>${badge(r['状態']||'', 'st '+statusClass(r['状態']))}</td>
            <td>${badge(r['現工程']||'', 'proc')}</td>
            <td class="s muted">${fmtDT(r['更新日時'])}</td>
            <td class="s muted">${r['更新者']||''}</td>
          </tr>
          <tr class="hidden"></tr>
        `;
      }).join('');
    }
    // export CSV
    $('#btnExportFinished').onclick = ()=> downloadCSV('finished_stock_detail.csv', rows);
    if(window.lucide){ lucide.createIcons(); }
  }catch(e){
    console.warn('finishedStockList error:', e);
    $('#tbFinished').innerHTML = `<tr><td colspan="10" class="muted">読込エラー</td></tr>`;
  }
}

/* ===== Docs (minimal) ===== */
async function openTicket(po_id){
  try{
    const o=await apiGet({action:'ticket',po_id});
    const body = `
      <h3>生産現品票</h3>
      <table>
        <tr><th>管理No</th><td>${o['管理No']||'-'}</td><th>通知書番号</th><td>${o['通知書番号']||'-'}</td></tr>
        <tr><th>得意先</th><td>${o['得意先']||''}</td><th>投入日</th><td>${o['created_at']?new Date(o['created_at']).toLocaleDateString():'-'}</td></tr>
        <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
        <tr><th>工程</th><td colspan="3">${o.current_process}</td></tr>
        <tr><th>状態</th><td>${o.status}</td><th>更新</th><td>${fmtDT(o.updated_at)} / ${o.updated_by||''}</td></tr>
      </table>`;
    showDoc('dlgTicket', body);
  }catch(e){ alert(e.message||e); }
}
function showDoc(id,html){ const dlg=document.getElementById(id); dlg.querySelector('.body').innerHTML=html; dlg.showModal(); }
async function openShipByPO(po_id){
  try{
    const d=await apiGet({action:'shipByPo',po_id});
    const s=d.shipment, o=d.order; const dt=s.scheduled_date? new Date(s.scheduled_date):null;
    const body=`
      <h3>出荷確認書</h3>
      <table>
        <tr><th>得意先</th><td>${o['得意先']||''}</td><th>出荷日</th><td>${dt?dt.toLocaleDateString():'-'}</td></tr>
        <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
        <tr><th>注番</th><td>${o.po_id||s.po_id}</td><th>数量</th><td>${s.qty||0}</td></tr>
        <tr><th>出荷ステータス</th><td>${s.status}</td><th>備考</th><td></td></tr>
      </table>`;
    showDoc('dlgShip', body);
  }catch(e){ alert(e.message||e); }
}

/* ===== History & Export ===== */
async function openHistory(po_id){
  try{
    const logs=await apiGet({action:'history',po_id});
    const html = logs.length? `
      <table><thead><tr><th>時刻</th><th>旧状態</th><th>新状態</th><th>旧工程</th><th>新工程</th><th>更新者</th><th>備考</th></tr></thead>
      <tbody>${logs.map(l=>`<tr><td>${fmtDT(l.timestamp)}</td><td>${l.prev_status||''}</td><td>${l.new_status||''}</td><td>${l.prev_process||''}</td><td>${l.new_process||''}</td><td>${l.updated_by||''}</td><td>${l.note||''}</td></tr>`).join('')}</tbody>
      </table>` : '<div class="muted">履歴なし</div>';
    $('#histBody').innerHTML=html; document.getElementById('dlgHistory').showModal();
  }catch(e){ alert(e.message||e); }
}
async function exportOrdersCSV(){ const rows=await apiGet({action:'listOrders'}); downloadCSV('orders.csv',rows); }
async function exportShipCSV(){ const rows=await apiGet({action:'todayShip'}); downloadCSV('ship_today.csv',rows); }
function downloadCSV(name,rows){
  if(!rows||!rows.length) return downloadFile(name,'');
  const headers=Object.keys(rows[0]);
  const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replaceAll('"','""')).map(v=>`"${v}"`).join(','))).join('\n');
  downloadFile(name,csv);
}
function downloadFile(name,content){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:'text/csv'})); a.download=name; a.click(); }

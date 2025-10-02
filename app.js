<!-- simpan sebagai app.js -->
<script>
/* =======================
 *  Mini ERP Frontend
 *  Sales → Plan → Ship → Invoice
 * ======================= */

/** ====== KONFIG ====== **/
const GAS_URL = localStorage.getItem('GAS_URL') || 'https://script.google.com/macros/s/AKfycbwN3oi1TLBKcydOFdSLhydqxYIyLFMyYKQr3Z7Ikors5JnRL6IsWLfeEEajcZSftKdZLw/exec'; // ganti setelah deploy
const API_KEY = ''; // kalau CONF.API_TOKEN dipakai di Code.gs, isi di sini

/** ====== STATE ====== **/
let CURRENT_USER = null;
let CACHE = {
  orders: [],
  sales: [],
  todayShip: [],
  locSnap: {},
  stock: {}
};

/** ====== UTIL ====== **/
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const show = (el, v=true)=> el.classList.toggle('hidden', !v);
const fmtDate = d => {
  if(!d) return '';
  const x = new Date(d);
  if(Number.isNaN(+x)) return '';
  const y=x.getFullYear(), m=('0'+(x.getMonth()+1)).slice(-2), dd=('0'+x.getDate()).slice(-2);
  return `${y}-${m}-${dd}`;
}
const toCSV = (rows) => {
  if(!rows || !rows.length) return '';
  const head = Object.keys(rows[0]);
  const escape = v => `"${String(v??'').replace(/"/g,'""')}"`;
  const lines = [ head.map(escape).join(',') ];
  rows.forEach(r=> lines.push(head.map(h=>escape(r[h])).join(',')) );
  return lines.join('\r\n');
}
const download = (filename, text) => {
  const blob = new Blob([text], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
const parseCSV = async (file) => {
  const txt = await file.text();
  const lines = txt.split(/\r?\n/).filter(l=>l.trim().length);
  if(!lines.length) return [];
  const head = lines[0].replace(/\ufeff/g,'').split(',').map(h=>h.replace(/^"|"$/g,'').trim());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = [];
    let cur='', inQ=false;
    for(let j=0;j<lines[i].length;j++){
      const ch = lines[i][j];
      if(ch === '"' ){
        if(inQ && lines[i][j+1] === '"'){ cur+='"'; j++; }
        else inQ = !inQ;
      } else if(ch === ',' && !inQ){
        cols.push(cur); cur='';
      } else cur+=ch;
    }
    cols.push(cur);
    const o={};
    head.forEach((h,idx)=>o[h]=cols[idx]??'');
    rows.push(o);
  }
  return rows;
}
const badge = (status)=>{
  const map = {
    '生産開始':'info',
    '検査保留':'hold',
    '検査済':'ok',
    '出荷準備':'warn',
    '出荷済':'ship',
    '不良品（要リペア）':'ng'
  };
  const cls = map[status] || 'muted';
  return `<span class="badge ${cls}">${status||'-'}</span>`;
}
const procLabelClass = (p)=>{
  const map = {
    'レーザ加工':'laser','曲げ加工':'bend','外枠組立':'frame','シャッター組立':'sh-assy','シャッター溶接':'sh-weld',
    'コーキング':'caulk','外枠塗装':'paint','組立（組立中）':'asm-in','組立（組立済）':'asm-ok','外注':'out','検査工程':'inspect'
  };
  return map[p]||'';
}

/** ====== API ====== **/
async function apiGet(params){
  const url = new URL(GAS_URL);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  $('#loading').classList.remove('hidden');
  try{
    const r = await fetch(url.toString(), {method:'GET'});
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'API error');
    return j.data;
  }finally{
    $('#loading').classList.add('hidden');
  }
}
async function apiPost(payload){
  $('#loading').classList.remove('hidden');
  try{
    const r = await fetch(GAS_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({...payload, apiKey:API_KEY})
    });
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'API error');
    return j.data;
  }finally{
    $('#loading').classList.add('hidden');
  }
}

/** ====== AUTH ====== **/
async function doLogin(){
  const u = $('#inUser').value.trim();
  const p = $('#inPass').value;
  if(!u||!p) return alert('ユーザー名とパスワードを入力');
  try{
    const me = await apiPost({action:'login', username:u, password:p});
    CURRENT_USER = me;
    afterLogin();
  }catch(e){ alert(e.message); }
}
function afterLogin(){
  $('#userInfo').textContent = `${CURRENT_USER.full_name}・${CURRENT_USER.department}${CURRENT_USER.role==='admin'?'（管理者）':''}`;
  // nav show
  show($('#btnToDash'), true);
  show($('#btnToSales'), true);
  show($('#btnToPlan'), true);
  show($('#btnToShip'), true);
  show($('#btnToInvoice'), true);
  show($('#btnToCharts'), true);
  show($('#btnShowStationQR'), true);
  show($('#btnAddUserWeb'), CURRENT_USER.role==='admin'||CURRENT_USER.department==='生産技術'||CURRENT_USER.department==='生産管理部');
  show($('#btnChangePass'), true);
  show($('#btnLogout'), true);

  show($('#authView'), false);
  navigate('pageDash');
  refreshDashboard();
  loadSalesList();
}

/** ====== NAV ====== **/
function navigate(id){
  ['pageDash','pageSales','pagePlan','pageShip','pageInvoice'].forEach(pid=> show($('#'+pid), pid===id));
}

/** ====== DASHBOARD ====== **/
async function refreshDashboard(){
  const [orders, today, loc, stock] = await Promise.all([
    apiGet({action:'listOrders'}),
    apiGet({action:'todayShip'}),
    apiGet({action:'locSnapshot'}),
    apiGet({action:'stock'})
  ]);
  CACHE.orders = orders;
  CACHE.todayShip = today;
  CACHE.locSnap = loc;
  CACHE.stock = stock;

  // table orders
  const q = $('#searchQ').value?.toLowerCase()||'';
  const rows = orders.filter(r => !q || Object.values(r).some(v=>String(v).toLowerCase().includes(q)));
  $('#tbOrders').innerHTML = rows.map(r=>{
    return `<tr>
      <td>${r.po_id||''}</td>
      <td>${r['得意先']||''}</td>
      <td>${r['製番号']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td>${badge(r.status)}</td>
      <td><span class="badge muted">${r.current_process||''}</span></td>
      <td>${fmtDate(r.updated_at)}</td>
      <td>${r.updated_by||''}</td>
      <td class="ops">
        <button class="btn s ghost" data-act="ticket" data-po="${r.po_id}"><i data-lucide="file-text"></i>票</button>
        <button class="btn s ghost" data-act="history" data-po="${r.po_id}"><i data-lucide="clock"></i>履歴</button>
        <button class="btn s ghost" data-act="scan" data-po="${r.po_id}"><i data-lucide="scan"></i>スキャン</button>
        <button class="btn s" data-act="del" data-po="${r.po_id}"><i data-lucide="trash-2"></i>削除</button>
      </td>
    </tr>`;
  }).join('');
  if(window.lucide) lucide.createIcons();

  // stats
  $('#statFinished').textContent = stock.finishedStock;
  $('#statReady').textContent = stock.ready;
  $('#statShipped').textContent = stock.shipped;

  // today ship
  $('#listToday').innerHTML = today.map(s=>(
    `<div><span>${fmtDate(s.scheduled_date)}・${s.po_id}</span><b>${s.qty}</b></div>`
  )).join('') || '<div class="muted s">なし</div>';

  // process grid
  const chips = Object.entries(loc).map(([p,n])=>{
    return `<div class="grid-chip proc ${procLabelClass(p)}">
      <div class="s">${p}</div>
      <div class="h">${n}</div>
    </div>`;
  }).join('');
  $('#gridProc').innerHTML = chips;
}

/** dash ops click **/
$('#tbOrders').addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const po = btn.dataset.po;
  const act = btn.dataset.act;

  if(act==='ticket'){
    const o = await apiGet({action:'ticket', po_id:po});
    const html = `
      <h3>生産現品票</h3>
      <table>
        <tr><th>注番</th><td>${o.po_id}</td><th>得意先</th><td>${o['得意先']||''}</td></tr>
        <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${o['品番']||''} / ${o['図番']||''}</td></tr>
        <tr><th>製番号</th><td>${o['製番号']||''}</td><th>管理No</th><td>${o['管理No']||''}</td></tr>
        <tr><th>状態</th><td>${o.status||''}</td><th>工程</th><td>${o.current_process||''}</td></tr>
      </table>
    `;
    $('#dlgTicket .body').innerHTML = html;
    $('#dlgTicket').showModal();
  }
  if(act==='history'){
    const logs = await apiGet({action:'history', po_id:po});
    $('#histBody').innerHTML = logs.map(l=>(
      `<div class="row gap s" style="border-bottom:1px dashed #ddd;padding:.3rem 0">
        <span>${fmtDate(l.timestamp)} ${String(new Date(l.timestamp)).slice(16,21)}</span>
        <span>${l.updated_by}</span>
        <span>${l.prev_process} → <b>${l.new_process}</b></span>
        <span>${l.prev_status} → <b>${l.new_status}</b></span>
        <span class="muted">${l.note||''}</span>
      </div>`
    )).join('') || '<div class="muted s">履歴なし</div>';
    $('#dlgHistory').showModal();
  }
  if(act==='scan'){
    openScan(po);
  }
  if(act==='del'){
    if(!confirm(`削除しますか？ ${po}`)) return;
    try{
      await apiPost({action:'deleteOrder', po_id:po, user:CURRENT_USER});
      await refreshDashboard();
    }catch(err){ alert(err.message); }
  }
});

/** export dashboard CSVs **/
$('#btnExportOrders').onclick = ()=>{
  const csv = toCSV(CACHE.orders);
  download(`orders-${fmtDate(new Date())}.csv`, csv);
}
$('#btnExportShip').onclick = async ()=>{
  const list = await apiGet({action:'finishedStockList'});
  const csv = toCSV(list);
  download(`today-ship-${fmtDate(new Date())}.csv`, csv);
}

/** ====== SALES ====== **/
function fillSalesForm(o){
  $('#so_id').value = o.so_id||'';
  $('#so_date').value = fmtDate(o['受注日']);
  $('#so_cust').value = o['得意先']||'';
  $('#so_item').value = o['品名']||'';
  $('#so_part').value = o['品番']||'';
  $('#so_drw').value = o['図番']||'';
  $('#so_sei').value = o['製番号']||'';
  $('#so_qty').value = o['数量']||'';
  $('#so_req').value = fmtDate(o['希望納期']);
  $('#so_note').value = o['備考']||'';
}
function readSalesForm(){
  return {
    '受注日': $('#so_date').value,
    '得意先': $('#so_cust').value.trim(),
    '品名': $('#so_item').value.trim(),
    '品番': $('#so_part').value.trim(),
    '図番': $('#so_drw').value.trim(),
    '製番号': $('#so_sei').value.trim(),
    '数量': Number($('#so_qty').value||0),
    '希望納期': $('#so_req').value||'',
    '備考': $('#so_note').value.trim()
  };
}
async function loadSalesList(){
  const q = $('#salesQ').value||'';
  const rows = await apiGet({action:'listSales', q});
  CACHE.sales = rows;
  $('#tbSales').innerHTML = rows.map(r=>{
    return `<tr data-id="${r.so_id}">
      <td>${r.so_id}</td>
      <td>${fmtDate(r['受注日'])}</td>
      <td>${r['得意先']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${(r['品番']||'')}/${(r['図番']||'')}</td>
      <td>${r['数量']||0}</td>
      <td>${fmtDate(r['希望納期'])}</td>
      <td>${r.status||''}</td>
      <td>${r.linked_po_id||''}</td>
      <td>${fmtDate(r.updated_at)}</td>
    </tr>`;
  }).join('');
}
$('#tbSales').addEventListener('click', (e)=>{
  const tr = e.target.closest('tr[data-id]');
  if(!tr) return;
  const so = CACHE.sales.find(x=>x.so_id===tr.dataset.id);
  if(so) fillSalesForm(so);
});
$('#btnSalesSave').onclick = async ()=>{
  try{
    const payload = readSalesForm();
    if(!$('#so_id').value){ // create
      const r = await apiPost({action:'createSalesOrder', payload, user:CURRENT_USER});
      $('#so_id').value = r.so_id;
    }else{ // update
      await apiPost({action:'updateSalesOrder', so_id:$('#so_id').value, updates:payload, user:CURRENT_USER});
    }
    await loadSalesList();
    alert('保存しました');
  }catch(e){ alert(e.message); }
};
$('#btnSalesDelete').onclick = async ()=>{
  const id = $('#so_id').value;
  if(!id) return alert('SOが空です');
  if(!confirm('削除しますか？')) return;
  try{
    await apiPost({action:'deleteSalesOrder', so_id:id, user:CURRENT_USER});
    fillSalesForm({});
    await loadSalesList();
  }catch(e){ alert(e.message); }
};
$('#btnPromote').onclick = async ()=>{
  const id = $('#so_id').value;
  if(!id) return alert('SOを選択してください');
  try{
    const r = await apiPost({action:'promoteSalesToPlan', so_id:id, user:CURRENT_USER});
    alert('計画へ変換しました: '+r.po_id);
    navigate('pagePlan');
    refreshDashboard();
  }catch(e){ alert(e.message); }
};
/* sales CSV */
$('#btnSalesExport').onclick = ()=>{
  const csv = toCSV(CACHE.sales);
  download(`sales-${fmtDate(new Date())}.csv`, csv);
};
$('#btnSalesImport').onclick = ()=> $('#fileSalesCSV').click();
$('#fileSalesCSV').addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  const rows = await parseCSV(f);
  if(!rows.length) return alert('CSV kosong');
  if(!confirm(`Import ${rows.length} baris ke Sales?`)) return;
  for(const r of rows){
    try{
      await apiPost({action:'createSalesOrder', payload:{
        '受注日': r['受注日']||r['so_date']||'',
        '得意先': r['得意先']||r['customer']||'',
        '品名': r['品名']||r['item']||'',
        '品番': r['品番']||r['part']||'',
        '図番': r['図番']||r['drw']||'',
        '製番号': r['製番号']||r['sei']||'',
        '数量': r['数量']||r['qty']||0,
        '希望納期': r['希望納期']||r['req']||'',
        '備考': r['備考']||r['note']||''
      }, user:CURRENT_USER});
    }catch(err){ console.warn(err.message); }
  }
  await loadSalesList();
  alert('Import selesai');
});

/** ====== PLAN (現品票) ====== **/
function planPayloadFromForm(){
  return {
    '得意先': $('#c_tokui').value.trim(),
    '得意先品番': $('#c_tokui_hin').value.trim(),
    '製番号': $('#c_sei').value.trim(),
    '品名': $('#c_hinmei').value.trim(),
    '品番': $('#c_hinban').value.trim(),
    '図番': $('#c_zuban').value.trim(),
    '通知書番号': $('#c_tsuchi').value.trim(),
    '管理No': $('#c_kanri').value.trim()
  };
}
$('#btnCreateOrder').onclick = async ()=>{
  try{
    const r = await apiPost({action:'createOrder', payload:planPayloadFromForm(), user:CURRENT_USER});
    $('#c_po').value = r.po_id;
    await refreshDashboard();
    alert('現品票を発行しました: '+r.po_id);
  }catch(e){ alert(e.message); }
};
$('#btnPlanDelete').onclick = async ()=>{
  const po = $('#c_po').value;
  if(!po) return alert('注番が空です');
  if(!confirm('削除しますか？')) return;
  try{
    await apiPost({action:'deleteOrder', po_id:po, user:CURRENT_USER});
    $('#c_po').value='';
    await refreshDashboard();
  }catch(e){ alert(e.message); }
};
/* plan CSV */
$('#btnPlanExport').onclick = ()=>{
  const csv = toCSV(CACHE.orders);
  download(`plan-orders-${fmtDate(new Date())}.csv`, csv);
};
$('#btnPlanImport').onclick = ()=> $('#filePlanCSV').click();
$('#filePlanCSV').addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const rows = await parseCSV(f);
  if(!rows.length) return alert('CSV kosong');
  if(!confirm(`Import ${rows.length} baris ke Orders?`)) return;
  for(const r of rows){
    try{
      await apiPost({action:'createOrder', payload:{
        '得意先': r['得意先']||'',
        '得意先品番': r['得意先品番']||'',
        '製番号': r['製番号']||'',
        '品名': r['品名']||'',
        '品番': r['品番']||'',
        '図番': r['図番']||'',
        '通知書番号': r['通知書番号']||'',
        '管理No': r['管理No']||''
      }, user:CURRENT_USER});
    }catch(err){ console.warn(err.message); }
  }
  await refreshDashboard();
  alert('Import selesai');
});

/** ====== SHIP ====== **/
function readShipForm(){
  return {
    po: $('#s_po').value.trim(),
    date: $('#s_date').value,
    qty: Number($('#s_qty').value||0),
    shipid: $('#s_shipid').value.trim()
  };
}
$('#btnSchedule').onclick = async ()=>{
  const p = readShipForm();
  if(!p.po || !p.date) return alert('注番と日付');
  try{
    const r = await apiPost({action:'scheduleShipment', po_id:p.po, dateIso:p.date, qty:p.qty, user:CURRENT_USER});
    $('#s_shipid').value = r.ship_id;
    await refreshDashboard();
    alert('出荷予定を登録しました');
  }catch(e){ alert(e.message); }
};
$('#btnShipEdit').onclick = async ()=>{
  const p = readShipForm();
  if(!p.shipid) return alert('出荷IDが空です');
  try{
    await apiPost({action:'updateShipment', ship_id:p.shipid, updates:{po_id:p.po, scheduled_date:p.date, qty:p.qty}, user:CURRENT_USER});
    await refreshDashboard();
    alert('更新しました');
  }catch(e){ alert(e.message); }
};
$('#btnShipDelete').onclick = async ()=>{
  const id = $('#s_shipid').value;
  if(!id) return alert('出荷IDが空です');
  if(!confirm('削除しますか？')) return;
  try{
    await apiPost({action:'deleteShipment', ship_id:id, user:CURRENT_USER});
    $('#s_shipid').value='';
    await refreshDashboard();
  }catch(e){ alert(e.message); }
};
/* ship docs */
$('#btnShipByPO').onclick = async ()=>{
  const p = $('#s_po').value.trim();
  if(!p) return alert('注番を入力');
  try{
    const d = await apiGet({action:'shipByPo', po_id:p});
    const html = buildShipDoc(d.order, d.shipment);
    $('#dlgShip .body').innerHTML = html;
    $('#dlgShip').showModal();
  }catch(e){ alert(e.message); }
}
$('#btnShipByID').onclick = async ()=>{
  const id = $('#s_shipid').value.trim();
  if(!id) return alert('出荷IDを入力');
  try{
    const d = await apiGet({action:'shipById', ship_id:id});
    const html = buildShipDoc(d.order, d.shipment);
    $('#dlgShip .body').innerHTML = html;
    $('#dlgShip').showModal();
  }catch(e){ alert(e.message); }
}
function buildShipDoc(o,s){
  return `
    <h3>出荷確認書</h3>
    <table>
      <tr><th>出荷ID</th><td>${s.ship_id}</td><th>日付</th><td>${fmtDate(s.scheduled_date)}</td></tr>
      <tr><th>注番</th><td>${o.po_id}</td><th>数量</th><td>${s.qty}</td></tr>
      <tr><th>得意先</th><td>${o['得意先']||''}</td><th>品名</th><td>${o['品名']||''}</td></tr>
      <tr><th>品番/図番</th><td>${o['品番']||''} / ${o['図番']||''}</td><th>製番号</th><td>${o['製番号']||''}</td></tr>
    </table>
  `;
}
/* ship CSV */
$('#btnShipExport').onclick = async ()=>{
  const ships = await apiGet({action:'todayShip'});
  download(`ship-${fmtDate(new Date())}.csv`, toCSV(ships));
};
$('#btnShipImport').onclick = ()=> $('#fileShipCSV').click();
$('#fileShipCSV').addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const rows = await parseCSV(f);
  if(!rows.length) return alert('CSV kosong');
  if(!confirm(`Import ${rows.length} baris ke Shipments?`)) return;
  for(const r of rows){
    try{
      await apiPost({action:'scheduleShipment',
        po_id: r['po_id']||r['注番']||'',
        dateIso: r['scheduled_date']||r['日付']||r['date']||'',
        qty: r['qty']||r['数量']||0,
        user: CURRENT_USER
      });
    }catch(err){ console.warn(err.message); }
  }
  await refreshDashboard();
  alert('Import selesai');
});

/** ====== INVOICE (client-side only = pengelompokan) ======
 *  NOTE: Server (Code.gs) sudah punya endpoints untuk data Ship jika ingin kembangkan.
 *  Di sini tombol2 UI disiapkan saja (preview/print/CSV).
 */
let INV_CACHE = [];
$('#btnInvPreview').onclick = async ()=>{
  const cust = $('#inv_customer').value.trim();
  const from = $('#inv_from').value;
  const to = $('#inv_to').value;
  if(!cust||!from||!to) return alert('得意先と期間を入力');
  // contoh sederhana: pakai todayShip + orders, filter by customer & range
  const orders = CACHE.orders.length?CACHE.orders:await apiGet({action:'listOrders'});
  const rows = await apiGet({action:'finishedStockList'});
  INV_CACHE = rows.filter(r=> (r['得意先']||'').includes(cust));
  renderInvoiceLines(INV_CACHE);
}
function renderInvoiceLines(rows){
  const tbody = $('#invLines');
  let n=0, sub=0;
  tbody.innerHTML = rows.map(r=>{
    const price = Number(r['単価']||0);
    const qty = Number(r['数量']||0);
    const amt = (price||0) * qty;
    sub += amt;
    return `<tr>
      <td>${++n}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td contenteditable="true" data-col="数量">${qty}</td>
      <td contenteditable="true" data-col="単価">${price}</td>
      <td>${amt}</td>
      <td>${r['po_id']||''}</td>
      <td>${r['ship_id']||''}</td>
    </tr>`;
  }).join('');
  const tax = Math.round(sub*0.10);
  $('#invSub').textContent = sub;
  $('#invTax').textContent = tax;
  $('#invTotal').textContent = sub+tax;
}
$('#btnInvCSV').onclick = ()=>{
  const rows = [];
  $('#tblInv tbody tr').forEach((tr,idx)=>{
    const tds = tr.querySelectorAll('td');
    rows.push({
      '#': idx+1,
      '品名': tds[1].textContent.trim(),
      '品番': tds[2].textContent.trim(),
      '図番': tds[3].textContent.trim(),
      '数量': tds[4].textContent.trim(),
      '単価': tds[5].textContent.trim(),
      '金額': tds[6].textContent.trim(),
      '注番': tds[7].textContent.trim(),
      '出荷ID': tds[8].textContent.trim()
    });
  });
  download(`invoice-${fmtDate(new Date())}.csv`, toCSV(rows));
}

/** ====== SCAN (Live & From Image) ====== **/
let _currentScanPO = null;
let _codeReader = null;

function openScan(po){
  _currentScanPO = po;
  $('#scanPO').textContent = po;
  $('#dlgScan').showModal();
}
$('#btnScanClose').onclick = ()=>{
  stopScan();
  $('#dlgScan').close();
};
$('#btnScanStart').onclick = ()=> startScan();
$('#btnScanFromFile').onclick = ()=> $('#fileQR').click();

$('#fileQR').addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  try{
    const txt = await decodeQRFromFile(f);
    handleScanText(txt);
  }catch(err){ alert('Gagal baca QR dari gambar: '+err.message); }
});

async function startScan(){
  stopScan();
  if(window.ZXing && ZXing.BrowserMultiFormatReader){
    _codeReader = new ZXing.BrowserMultiFormatReader();
    try{
      const video = $('#scanVideo');
      const res = await _codeReader.decodeFromVideoDevice(undefined, video, (result, err)=>{
        if(result){ handleScanText(result.getText()); }
      });
    }catch(e){ alert('Camera gagal: '+e.message); }
  }else{
    alert('ZXing library belum siap');
  }
}
function stopScan(){
  try{ _codeReader && _codeReader.reset(); }catch(e){}
  _codeReader = null;
}

/* decode QR from image file using jsQR */
async function decodeQRFromFile(file){
  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise((res,rej)=>{
    img.onload = ()=>res();
    img.onerror = e=>rej(new Error('Image load error'));
    img.src = url;
  });
  const cvs = $('#scanCanvas');
  const ctx = cvs.getContext('2d');
  cvs.width = img.naturalWidth;
  cvs.height = img.naturalHeight;
  ctx.drawImage(img,0,0);
  const imgData = ctx.getImageData(0,0,cvs.width,cvs.height);
  const qr = jsQR(imgData.data, imgData.width, imgData.height);
  URL.revokeObjectURL(url);
  if(!qr) throw new Error('QR tidak terbaca');
  return qr.data;
}

/* format supported:
 * - ST:工程名           → ganti current_process
 * - PO:xxxxx            → set _currentScanPO (optional)
 * - STATUS:検査済 など   → ganti status
 * - NOTE:xxxx           → catatan
 * (boleh dipisah baris)
 */
async function handleScanText(text){
  $('#scanResult').textContent = 'Read: '+text;
  const lines = String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const upd = {};
  let note='';
  let proc='', status='';
  lines.forEach(l=>{
    const [k,...rest] = l.split(':');
    const v = rest.join(':').trim();
    if(/^ST$/i.test(k)) proc=v;
    else if(/^STATUS$/i.test(k)) status=v;
    else if(/^NOTE$/i.test(k)) note=v;
    else if(/^PO$/i.test(k)) _currentScanPO=v;
  });
  if(!proc && !status && lines.length===1 && lines[0].startsWith('ST:')) proc = lines[0].slice(3).trim();

  if(proc) upd.current_process = proc;
  if(status) upd.status = status;
  if(note) upd.note = note;

  if(!_currentScanPO) return alert('PO tidak diketahui. QR harus mengandung PO:xxxx atau buka dari daftar.');
  try{
    await apiPost({action:'updateOrder', po_id:_currentScanPO, updates:upd, user:CURRENT_USER});
    await refreshDashboard();
  }catch(e){ alert('Update gagal: '+e.message); }
}

/** ====== STATION QR ====== **/
$('#btnShowStationQR').onclick = ()=>{
  const wrap = $('#qrWrap');
  wrap.innerHTML='';
  const procs = [
    'レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程',
    '生産開始','検査保留','検査済','出荷準備','出荷済','不良品（要リペア）' // status juga
  ];
  procs.forEach(p=>{
    const div = document.createElement('div');
    div.style.padding='8px';
    div.style.textAlign='center';
    div.style.border='1px solid #e5e7eb';
    div.style.borderRadius='10px';
    const qdiv = document.createElement('div');
    qdiv.style.margin='6px auto';
    new QRCode(qdiv, {text:`ST:${p}`, width:120, height:120});
    div.innerHTML = `<div class="s muted">${p}</div>`;
    div.prepend(qdiv);
    wrap.appendChild(div);
  });
  $('#dlgStationQR').showModal();
}

/** ====== NAV BUTTONS ====== **/
$('#btnToDash').onclick = ()=>{ navigate('pageDash'); refreshDashboard(); };
$('#btnToSales').onclick = ()=>{ navigate('pageSales'); loadSalesList(); };
$('#btnToPlan').onclick = ()=>{ navigate('pagePlan'); };
$('#btnToShip').onclick = ()=>{ navigate('pageShip'); };
$('#btnToInvoice').onclick = ()=>{ navigate('pageInvoice'); };
$('#btnToCharts').onclick = ()=>{ navigate('pageDash'); }; // placeholder

/** ====== USER / ADMIN ====== **/
$('#btnNewUser').onclick = async ()=>{
  const p = {
    username: $('#nuUser').value.trim(),
    password: $('#nuPass').value,
    full_name: $('#nuName').value.trim(),
    department: $('#nuDept').value,
    role: $('#nuRole').value
  };
  try{
    await apiPost({action:'createUser', user:CURRENT_USER, payload:p});
    alert('ユーザー追加しました');
  }catch(e){ alert(e.message); }
};
$('#btnChangePass').onclick = async ()=>{
  const oldp = prompt('旧パスワード'); if(oldp==null) return;
  const newp = prompt('新しいパスワード'); if(newp==null) return;
  try{
    await apiPost({action:'changePassword', user:CURRENT_USER, oldPass:oldp, newPass:newp});
    alert('変更しました');
  }catch(e){ alert(e.message); }
};
$('#btnLogout').onclick = ()=>{
  CURRENT_USER = null;
  show($('#authView'), true);
  ['pageDash','pageSales','pagePlan','pageShip','pageInvoice'].forEach(id=>show($('#'+id), false));
  $$('#pageSales input, #pagePlan input, #pageShip input').forEach(i=>i.value='');
};

/** ====== WIRING ====== **/
$('#btnLogin').onclick = doLogin;
$('#btnRefresh').onclick = refreshDashboard;
$('#searchQ').addEventListener('input', refreshDashboard);
$('#salesQ').addEventListener('input', loadSalesList);

/** ====== INIT ====== **/
document.addEventListener('DOMContentLoaded', ()=>{
  if(window.lucide){ lucide.createIcons(); }
  // jika ingin simpan URL GAS di browser:
  if(!localStorage.getItem('GAS_URL')){
    const u = prompt('Masukkan GAS WebApp URL (bisa ubah kapan saja di console: localStorage.setItem("GAS_URL","..."))', GAS_URL.includes('PASTE_WEBAPP_URL')?'':GAS_URL);
    if(u){ localStorage.setItem('GAS_URL', u); location.reload(); }
  }
});
</script>

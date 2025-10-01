/* ===== Config ===== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwN3oi1TLBKcydOFdSLhydqxYIyLFMyYKQr3Z7Ikors5JnRL6IsWLfeEEajcZSftKdZLw/exec"; // ganti milik Anda
const API_KEY = "";
const PROCESSES = ['レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程'];
const STATUSES  = ['生産開始','検査保留','検査済','出荷準備','出荷済','不良品（要リペア）'];

const $ = s=>document.querySelector(s);
const $$ = s=>document.querySelectorAll(s);
const fmtDT = s=> s? new Date(s).toLocaleString(): '';
const fmtD  = s=> s? new Date(s).toLocaleDateString(): '';

let SESSION=null, ORDERS_CACHE=[];
let loadingCounter = 0;

/* ===== Loading (grouped) ===== */
function showLoading(on){
  loadingCounter += on ? 1 : -1;
  if(loadingCounter < 0) loadingCounter = 0;
  $('#loading').classList.toggle('hidden', loadingCounter===0);
}

/* ===== Fetch helpers with timeout & retry ===== */
async function _fetchWithTimeout(input, init={}, timeoutMs=20000){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort('timeout'), timeoutMs);
  try{
    const res = await fetch(input, {...init, signal: ctrl.signal});
    return res;
  }finally{ clearTimeout(id); }
}
async function apiPost(action, body){
  showLoading(true);
  try{
    const payload={action,...body}; if(API_KEY) payload.apiKey=API_KEY;
    const res=await _fetchWithTimeout(API_BASE,{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(payload)
    },15000);
    const j=await res.json(); if(!j.ok) throw new Error(j.error); return j.data;
  }finally{ showLoading(false); }
}
async function apiGet(params){
  showLoading(true);
  try{
    const url=API_BASE+'?'+new URLSearchParams(params).toString();
    const res=await _fetchWithTimeout(url, {}, 15000);
    const j=await res.json(); if(!j.ok) throw new Error(j.error); return j.data;
  }finally{ showLoading(false); }
}

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  $('#btnToDash').onclick = ()=>show('pageDash');
  $('#btnToSales').onclick= ()=>alert('Sales page omitted in this minimal bundle');
  $('#btnToPlan').onclick = ()=>alert('Plan page omitted in this minimal bundle');
  $('#btnToShip').onclick = ()=>alert('Ship page omitted in this minimal bundle');
  $('#btnToInvoice').onclick = ()=>alert('Invoice page omitted in this minimal bundle');
  $('#btnToCharts').onclick = ()=>alert('Charts page omitted in this minimal bundle');

  $('#btnLogin').onclick = onLogin;
  $('#btnNewUser').onclick = addUserFromLoginUI;
  $('#btnLogout').onclick = ()=>{ SESSION=null; localStorage.removeItem('erp_session'); location.reload(); };
  $('#btnChangePass').onclick = changePasswordUI;

  $('#btnRefresh').onclick = refreshAll;
  $('#searchQ').addEventListener('input', debounce(renderOrders, 200));
  $('#btnExportOrders').onclick = exportOrdersCSV;
  $('#btnExportShip').onclick = exportShipCSV;

  // QR / スキャン
  $('#btnShowStationQR').onclick = openScanDialog;
  $('#scanClose').onclick = closeScanDialog;
  $('#scanApply').onclick = applyScanUpdate;
  $('#scanCamera').addEventListener('change', startScanner);
  $('#scanReset').onclick = ()=>{ $('#scanResult').textContent=''; $('#scanPo').value=''; };

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
  if (SESSION.role==='admin' || SESSION.department==='生産技術') $('#btnAddUserWeb').classList.remove('hidden'); else $('#btnAddUserWeb').classList.add('hidden');
  $('#btnAddUserWeb').onclick = ()=>alert('Add-user modal omitted');
  show('pageDash');
  refreshAll();
}

/* ===== Auth ===== */
async function onLogin(){
  const u=$('#inUser').value.trim(), p=$('#inPass').value.trim();
  try{
    const r=await apiPost('login',{username:u,password:p});
    SESSION=r; localStorage.setItem('erp_session',JSON.stringify(r)); enter();
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
  const oldPass=prompt('旧パスワード:'); if(oldPass===null) return; const newPass=prompt('新パスワード:'); if(newPass===null) return;
  try{
    await apiPost('changePassword',{user:SESSION,oldPass,newPass});
    alert('変更しました。再ログインしてください。');
    SESSION=null; localStorage.removeItem('erp_session'); location.reload();
  }catch(e){ alert(e.message||e); }
}

/* ===== Dashboard (batched refresh untuk anti-lemot) ===== */
async function refreshAll(){
  try{
    showLoading(true);
    const [s, today, loc, rows, finished] = await Promise.all([
      apiGet({action:'stock'}),
      apiGet({action:'todayShip'}),
      apiGet({action:'locSnapshot'}),
      apiGet({action:'listOrders', q: $('#searchQ').value.trim()}),
      apiGet({action:'finishedStockList'})
    ]);

    // Stat
    $('#statFinished').textContent=s.finishedStock; $('#statReady').textContent=s.ready; $('#statShipped').textContent=s.shipped;

    // Hari ini
    $('#listToday').innerHTML = today.length? today.map(r=>`
      <div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join(''):'<div class="muted">本日予定なし</div>';

    // Lokasi / 工程
    $('#gridProc').innerHTML = PROCESSES.map(p=>`
      <div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>`).join('');

    // Orders
    ORDERS_CACHE = rows; renderOrdersTable(rows);

    // Finished detail (tabel)
    renderFinishedTable(finished);

  }catch(e){
    console.error(e);
  }finally{ showLoading(false); }
}

/* ===== Helpers ===== */
function debounce(fn, wait=200){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }
function statusClass(s){ return 'badge badge-status--'+(s||'').replaceAll(' ',''); }
function procClass(p){ const base='badge badge-proc'; if(!p) return base; return base+' badge-proc--'+p; }

/* ===== 生産一覧 ===== */
async function listOrders(){ const q=$('#searchQ').value.trim(); const rows=await apiGet({action:'listOrders',q}); ORDERS_CACHE=rows; return rows; }
async function renderOrders(){ const rows = await listOrders(); renderOrdersTable(rows); }

function renderOrdersTable(rows){
  $('#tbOrders').innerHTML = rows.map(r=>`
    <tr>
      <td><b>${r.po_id}</b></td>
      <td>${r['得意先']||''}</td>
      <td>${r['製番号']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td><span class="${statusClass(r.status)}">${r.status}</span></td>
      <td><span class="${procClass(r.current_process)}">${r.current_process||''}</span></td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
      <td class="s">
        <div class="ops-grid">
          <button class="btn ghost s" onclick="openTicket('${r.po_id}')"><i data-lucide="file-badge-2"></i>票</button>
          <button class="btn ghost s" onclick="openHistory('${r.po_id}')"><i data-lucide="history"></i>履歴</button>
          <button class="btn ghost s" onclick="openShipByPO('${r.po_id}')"><i data-lucide="file-check-2"></i>出荷票</button>
          <button class="btn ghost s" onclick="prefillScanForm('${r.po_id}')"><i data-lucide="qr-code"></i>更新</button>
        </div>
      </td>
    </tr>`).join('');
  if(window.lucide){ lucide.createIcons(); }
}

/* ===== 完成品在庫（明細） — tampilkan seperti 生産一覧 ===== */
function renderFinishedTable(rows){
  const el = $('#listFinished');
  if(!rows || !rows.length){
    $('#btnExportFinished').onclick = ()=> downloadCSV('finished_stock_detail.csv', []);
    el.innerHTML = '<div class="muted">（現在なし）</div>';
    return;
  }
  // Header-like
  const table = `
    <table class="table s">
      <thead><tr>
        <th>注番</th><th>得意先</th><th>品名</th><th>図番</th><th>数量</th>
        <th>状態</th><th>工程</th><th>更新</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td><b>${r.po_id}</b></td>
            <td>${r['得意先']||''}</td>
            <td>${r['品名']||''}</td>
            <td>${r['図番']||''}</td>
            <td><b>${r['数量']||0}</b></td>
            <td><span class="${statusClass(r['状態'])}">${r['状態']||''}</span></td>
            <td><span class="${procClass(r['現工程'])}">${r['現工程']||''}</span></td>
            <td class="s muted">${fmtDT(r['更新日時'])}</td>
            <td class="s">
              <div class="ops-grid">
                <button class="btn ghost s" onclick="openTicket('${r.po_id}')"><i data-lucide="file-badge-2"></i>票</button>
                <button class="btn ghost s" onclick="openHistory('${r.po_id}')"><i data-lucide="history"></i>履歴</button>
                <button class="btn ghost s" onclick="openShipByPO('${r.po_id}')"><i data-lucide="file-check-2"></i>出荷票</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  el.innerHTML = table;
  $('#btnExportFinished').onclick = ()=> downloadCSV('finished_stock_detail.csv', rows);
  if(window.lucide){ lucide.createIcons(); }
}

/* ===== Docs minimal ===== */
async function openTicket(po_id){
  try{
    const o=await apiGet({action:'ticket',po_id});
    const body = `
      <h3>生産現品票</h3>
      <table>
        <tr><th>管理No</th><td>${o['管理No']||'-'}</td><th>通知書番号</th><td>${o['通知書番号']||'-'}</td></tr>
        <tr><th>得意先</th><td>${o['得意先']||''}</td><th>投入日</th><td>${o['created_at']?new Date(o['created_at']).toLocaleDateString():'-'}</td></tr>
        <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
        <tr><th>工程</th><td colspan="3">${o.current_process||''}</td></tr>
        <tr><th>状態</th><td>${o.status||''}</td><th>更新</th><td>${fmtDT(o.updated_at)} / ${o.updated_by||''}</td></tr>
      </table>`;
    showDoc('dlgTicket', body);
  }catch(e){ alert(e.message||e); }
}
function showDoc(id,html){ const dlg=document.getElementById(id); dlg.querySelector('.body').innerHTML=html; dlg.showModal(); }
async function openShipByPO(po_id){
  try{
    const d=await apiGet({action:'shipByPo',po_id});
    const s=d.shipment, o=d.order;
    const dt=s.scheduled_date? new Date(s.scheduled_date):null;
    const body=`
      <h3>出荷確認書</h3>
      <table>
        <tr><th>得意先</th><td>${o['得意先']||''}</td><th>出荷日</th><td>${dt?dt.toLocaleDateString():'-'}</td></tr>
        <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
        <tr><th>注番</th><td>${o.po_id||s.po_id}</td><th>数量</th><td>${s.qty||0}</td></tr>
        <tr><th>出荷ステータス</th><td>${s.status||''}</td><th>備考</th><td></td></tr>
      </table>`;
    showDoc('dlgShip', body);
  }catch(e){ alert(e.message||e); }
}
async function openHistory(po_id){
  try{
    const logs=await apiGet({action:'history',po_id});
    const html = logs.length? `
      <table><thead><tr><th>時刻</th><th>旧状態</th><th>新状態</th><th>旧工程</th><th>新工程</th><th>更新者</th><th>備考</th></tr></thead>
      <tbody>${logs.map(l=>`<tr><td>${fmtDT(l.timestamp)}</td><td>${l.prev_status||''}</td><td>${l.new_status||''}</td><td>${l.prev_process||''}</td><td>${l.new_process||''}</td><td>${l.updated_by||''}</td><td>${l.note||''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="muted">履歴なし</div>';
    $('#histBody').innerHTML=html; document.getElementById('dlgHistory').showModal();
  }catch(e){ alert(e.message||e); }
}

/* ===== Export ===== */
async function exportOrdersCSV(){ const rows=await apiGet({action:'listOrders'}); downloadCSV('orders.csv',rows); }
async function exportShipCSV(){ const rows=await apiGet({action:'todayShip'}); downloadCSV('ship_today.csv',rows); }
function downloadCSV(name,rows){
  if(!rows||!rows.length) return downloadFile(name,'');
  const headers=Object.keys(rows[0]);
  const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replaceAll('"','""')).map(v=>`"${v}"`).join(','))).join('\n');
  downloadFile(name,csv);
}
function downloadFile(name,content){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:'text/csv'})); a.download=name; a.click(); }

/* ======== スキャン（kōshin） ======== */
let scanStream=null, scanTimer=null;

function openScanDialog(){
  if(!SESSION){ alert('ログインしてください'); return; }
  $('#dlgScan').showModal();
  listCameras().then(startScanner);
  // default selects
  fillSelect($('#scanStatus'), STATUSES, '検査保留');
  fillSelect($('#scanProcess'), PROCESSES, '検査工程');
}
function closeScanDialog(){ stopScanner(); $('#dlgScan').close(); }

function fillSelect(sel, arr, def){
  sel.innerHTML = arr.map(x=> `<option value="${x}">${x}</option>`).join('');
  if(def && arr.includes(def)) sel.value = def;
}

async function listCameras(){
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d=> d.kind==='videoinput');
    const sel = $('#scanCamera');
    sel.innerHTML = cams.map((c,i)=> `<option value="${c.deviceId}">${c.label || 'Camera '+(i+1)}</option>`).join('');
    return cams;
  }catch(e){
    console.warn(e);
    return [];
  }
}
async function startScanner(){
  try{
    stopScanner();
    const deviceId = $('#scanCamera').value || undefined;
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
      audio: false
    };
    scanStream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = $('#scanVideo');
    video.srcObject = scanStream;
    await video.play();
    scanLoop();
  }catch(e){
    alert('カメラ起動エラー：' + (e.message||e));
  }
}
function stopScanner(){
  if(scanTimer){ cancelAnimationFrame(scanTimer); scanTimer=null; }
  const v=$('#scanVideo');
  if(v) v.pause();
  if(scanStream){
    scanStream.getTracks().forEach(t=> t.stop());
    scanStream=null;
  }
}
function scanLoop(){
  const video = $('#scanVideo');
  const canvas = $('#scanCanvas');
  const ctx = canvas.getContext('2d');

  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  canvas.width = w; canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0,0,w,h);
  const code = jsQR(img.data, w, h);
  if(code && code.data){
    onScanFound(code.data);
  }else{
    scanTimer = requestAnimationFrame(scanLoop);
  }
}
function onScanFound(text){
  $('#scanResult').textContent = text;
  // Heuristik: PO-xxxxx atau berisi "PO:"
  const po = parsePO(text);
  if(po){
    $('#scanPo').value = po;
    // default next process = berikutnya dari order jika ada di cache
    const hit = ORDERS_CACHE.find(r=> r.po_id===po);
    if(hit){
      const idx = PROCESSES.indexOf(hit.current_process||'');
      const next = PROCESSES[idx+1] || '検査工程';
      $('#scanProcess').value = next;
      // Jika menuju 検査工程, default status 検査保留, else 生産開始
      $('#scanStatus').value = (next==='検査工程') ? '検査保留' : '生産開始';
    }
  }
  // jeda 600ms lalu lanjut scan (agar tidak dobel)
  setTimeout(()=> scanLoop(), 600);
}
function parsePO(s){
  if(!s) return '';
  const m1 = s.match(/PO-\d{5,}/i);
  if(m1) return m1[0].toUpperCase();
  const m2 = s.match(/po_id[:=]\s*(PO-\d{5,})/i);
  if(m2) return m2[1].toUpperCase();
  return s.startsWith('PO-') ? s : '';
}
function prefillScanForm(po_id){
  openScanDialog();
  $('#scanPo').value = po_id;
  const hit = ORDERS_CACHE.find(r=> r.po_id===po_id);
  if(hit){
    const idx = PROCESSES.indexOf(hit.current_process||'');
    const next = PROCESSES[idx+1] || '検査工程';
    $('#scanProcess').value = next;
    $('#scanStatus').value = (next==='検査工程') ? '検査保留' : '生産開始';
  }
}

async function applyScanUpdate(){
  if(!SESSION) return alert('ログインしてください');
  const po_id = $('#scanPo').value.trim();
  const new_status = $('#scanStatus').value;
  const new_process = $('#scanProcess').value;
  const note = $('#scanNote').value.trim();

  if(!po_id) return alert('注番（PO）不明');

  try{
    await apiPost('scanUpdate',{ user:SESSION, payload:{ po_id, new_status, new_process, note } });
    alert('更新しました');
    closeScanDialog();
    refreshAll();
  }catch(e){
    alert(e.message||e);
  }
}

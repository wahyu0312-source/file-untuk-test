/* ===== Config ===== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwN3oi1TLBKcydOFdSLhydqxYIyLFMyYKQr3Z7Ikors5JnRL6IsWLfeEEajcZSftKdZLw/exec"; // << GANTI
const API_KEY = ""; // optional
const PROCESSES=['レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程'];

const $=s=>document.querySelector(s); const $$=s=>document.querySelectorAll(s);
const fmtDT=s=>s?new Date(s).toLocaleString():''; const fmtD=s=>s?new Date(s).toLocaleDateString():'';
let SESSION=null, ORDERS_CACHE=[], PAGE={index:1,size:50};

/* ===== UI helpers ===== */
function statusClass(s){switch(String(s)){
  case'生産開始':return'st-start'; case'検査保留':return'st-hold'; case'検査済':return'st-done'; case'出荷準備':return'st-ready'; case'出荷済':return'st-shipped'; case'不良品（要リペア）':return'st-ng'; default:return'st-start';}}
function procIndex(p){const i=PROCESSES.indexOf(p||'');return i<0?0:i;}
const badge=(t,cls)=>`<span class="badge ${cls}">${t??''}</span>`;
function showLoading(v){$('#loading').classList.toggle('hidden',!v);}

/* ===== API ===== */
async function apiPost(action,body){showLoading(true); try{
  const payload={action,...body}; if(API_KEY) payload.apiKey=API_KEY;
  const res=await fetch(API_BASE,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
  const j=await res.json(); if(!j.ok) throw new Error(j.error); return j.data;
}finally{showLoading(false);}}
async function apiGet(params){showLoading(true); try{
  const url=API_BASE+'?'+new URLSearchParams(params).toString();
  const res=await fetch(url); const j=await res.json(); if(!j.ok) throw new Error(j.error); return j.data;
}finally{showLoading(false);}}

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded',()=>{
  // Nav
  $('#btnToDash').onclick=()=>show('pageDash');
  $('#btnToSales').onclick=()=>{show('pageSales'); loadSales();};
  $('#btnToPlan').onclick =()=>{show('pagePlan'); loadPlan();};
  $('#btnToShip').onclick =()=>{show('pageShip'); loadShip();};
  $('#btnToInvoice').onclick=()=>{show('pageInvoice');};
  $('#btnToCharts').onclick =()=>{show('pageCharts'); loadCharts();};
  $('#btnShowStationQR').onclick=()=>{show('pageStations'); renderStationQR();};

  // Auth
  $('#btnLogin').onclick=onLogin;
  $('#btnNewUser').onclick=addUserFromLoginUI;
  $('#btnLogout').onclick=()=>{SESSION=null;localStorage.removeItem('erp_session');location.reload();};
  $('#btnChangePass').onclick=changePasswordUI;

  // Dashboard
  $('#btnRefresh').onclick=refreshAll;
  $('#btnExportOrders').onclick=exportOrdersCSV;
  $('#btnExportShip').onclick=exportShipCSV;

  // Search debounce
  let t=null;
  $('#searchQ').addEventListener('input',()=>{clearTimeout(t); t=setTimeout(()=>{PAGE.index=1; renderOrders();},250);});

  // Pagination
  $('#pgPrev').onclick=()=>{ if(PAGE.index>1){ PAGE.index--; renderOrdersPage(); } };
  $('#pgNext').onclick=()=>{ const max=Math.max(1,Math.ceil(ORDERS_CACHE.length/PAGE.size)); if(PAGE.index<max){ PAGE.index++; renderOrdersPage(); } };

  // Scan dialog controls
  $('#btnScanClose').onclick=stopScan;

  // Deep link: ?proc=xxx membuka scanner langsung untuk station tsb
  const url=new URL(location.href); const proc=url.searchParams.get('proc');
  const auto=url.searchParams.get('scan'); if(proc&&auto==='1'){ show('pageDash'); openScan(proc); }

  const saved=localStorage.getItem('erp_session');
  if(saved){SESSION=JSON.parse(saved); enter();} else show('authView');
});
function show(id){['authView','pageDash','pageSales','pagePlan','pageShip','pageInvoice','pageCharts','pageStations'].forEach(x=>document.getElementById(x)?.classList.add('hidden')); document.getElementById(id)?.classList.remove('hidden'); }
function enter(){ $('#userInfo').textContent=`${SESSION.full_name}・${SESSION.department}`;
  ['btnLogout','btnChangePass','btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvoice','btnShowStationQR','btnToCharts'].forEach(id=>$('#'+id).classList.remove('hidden'));
  show('pageDash'); refreshAll(); }

/* ===== Auth ===== */
async function onLogin(){ const u=$('#inUser').value.trim(), p=$('#inPass').value.trim();
  try{ const r=await apiPost('login',{username:u,password:p}); SESSION=r; localStorage.setItem('erp_session',JSON.stringify(r)); enter(); }catch(e){ alert(e.message||e); }}
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
  try{ await apiPost('changePassword',{user:SESSION,oldPass,newPass}); alert('変更しました。再ログインしてください。'); SESSION=null; localStorage.removeItem('erp_session'); location.reload(); }catch(e){ alert(e.message||e); }
}

/* ===== Dashboard ===== */
async function refreshAll(){
  try{
    const s=await apiGet({action:'stock'});
    $('#statFinished').textContent=s.finishedStock; $('#statReady').textContent=s.ready; $('#statShipped').textContent=s.shipped;

    const today=await apiGet({action:'todayShip'});
    $('#listToday').innerHTML=today.length?today.map(r=>`<div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join(''):'<div class="muted">本日予定なし</div>';

    const loc=await apiGet({action:'locSnapshot'});
    $('#gridProc').innerHTML=PROCESSES.map(p=>`<div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>`).join('');

    await renderOrders();
    await loadFinishedStock();
  }catch(e){ console.error(e); }
}
async function listOrders(){ const q=$('#searchQ').value.trim(); const rows=await apiGet({action:'listOrders',q}); ORDERS_CACHE=rows; return rows; }
async function renderOrders(){ await listOrders(); renderOrdersPage(); }
function renderOrdersPage(){
  const start=(PAGE.index-1)*PAGE.size, end=Math.min(start+PAGE.size,ORDERS_CACHE.length);
  $('#pgInfo').textContent=`${ORDERS_CACHE.length?start+1:0}-${end} / ${ORDERS_CACHE.length}`;
  const rows=ORDERS_CACHE.slice(start,end);
  $('#tbOrders').innerHTML=rows.map(r=>{
    const pIdx=procIndex(r.current_process); const urgent=String(r.urgent||'')==='true';
    const procBadge=`<span class="badge proc p${pIdx}">${r.current_process||''}</span>`;
    const urgentBadge=urgent?` <span class="badge urgent">至急</span>`:'';
    return `
    <tr class="${urgent?'urgent':''}">
      <td><b>${r.po_id}</b>${urgentBadge}</td>
      <td>${r['得意先']||''}</td>
      <td>${r['製番号']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td>${badge(r.status,'st '+statusClass(r.status))}</td>
      <td>${procBadge}</td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
      <td class="s">
        <div class="ops-grid ops-box p${pIdx}">
          <button class="btn ghost s" onclick="openTicket('${r.po_id}')"><i data-lucide="file-badge-2"></i>票</button>
          <button class="btn ghost s" onclick="openHistory('${r.po_id}')"><i data-lucide="history"></i>履歴</button>
          <button class="btn ghost s" onclick="openShipByPO('${r.po_id}')"><i data-lucide="file-check-2"></i>出荷票</button>
          <button class="btn ghost s" onclick="openScan('${r.current_process||''}')"><i data-lucide="scan-line"></i>スキャン</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  if(window.lucide){ lucide.createIcons(); }
}

/* ===== 完成品在庫 ===== */
async function loadFinishedStock(){
  try{
    const rows=await apiGet({action:'finishedStockList'});
    const tb=$('#tbFinished');
    if(!rows.length){ tb.innerHTML=`<tr><td colspan="10" class="muted">（現在なし）</td></tr>`; return; }
    tb.innerHTML=rows.map(r=>{
      const pIdx=procIndex(r['現工程']); const procBadge=`<span class="badge proc p${pIdx}">${r['現工程']||''}</span>`;
      const urgent=r['至急']?` <span class="badge urgent">至急</span>`:'';
      return `<tr class="${r['至急']?'urgent':''}">
        <td><b>${r.po_id}</b>${urgent}</td><td>${r['得意先']||''}</td><td>${r['品名']||''}</td>
        <td>${r['品番']||''}</td><td>${r['図番']||''}</td><td>${r['数量']||0}</td>
        <td>${badge(r['状態'],'st '+statusClass(r['状態']))}</td><td>${procBadge}</td>
        <td class="s muted">${fmtDT(r['更新日時'])}</td><td class="s muted">${r['更新者']||''}</td></tr>`;
    }).join('');
    $('#btnExportFinished').onclick=()=>downloadCSV('finished_stock_detail.csv',rows);
  }catch(e){ console.warn(e); $('#tbFinished').innerHTML=`<tr><td colspan="10" class="muted">読込エラー</td></tr>`; }
}

/* ===== Docs ===== */
async function openTicket(po_id){
  try{ const o=await apiGet({action:'ticket',po_id});
    const body=`<h3>生産現品票</h3><table>
      <tr><th>管理No</th><td>${o['管理No']||'-'}</td><th>通知書番号</th><td>${o['通知書番号']||'-'}</td></tr>
      <tr><th>得意先</th><td>${o['得意先']||''}</td><th>投入日</th><td>${o['created_at']?new Date(o['created_at']).toLocaleDateString():'-'}</td></tr>
      <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
      <tr><th>工程</th><td colspan="3">${o.current_process}</td></tr>
      <tr><th>状態</th><td>${o.status}</td><th>更新</th><td>${fmtDT(o.updated_at)} / ${o.updated_by||''}</td></tr>
    </table>`;
    showDoc('dlgTicket',body);
  }catch(e){ alert(e.message||e); }
}
function showDoc(id,html){const dlg=document.getElementById(id); dlg.querySelector('.body').innerHTML=html; dlg.showModal();}
async function openShipByPO(po_id){
  try{ const d=await apiGet({action:'shipByPo',po_id}), s=d.shipment,o=d.order, dt=s.scheduled_date?new Date(s.scheduled_date):null;
    const body=`<h3>出荷確認書</h3><table>
      <tr><th>得意先</th><td>${o['得意先']||''}</td><th>出荷日</th><td>${dt?dt.toLocaleDateString():'-'}</td></tr>
      <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
      <tr><th>注番</th><td>${o.po_id||s.po_id}</td><th>数量</th><td>${s.qty||0}</td></tr>
      <tr><th>出荷ステータス</th><td>${s.status}</td><th>備考</th><td></td></tr></table>`;
    showDoc('dlgShip',body);
  }catch(e){ alert(e.message||e); }
}

/* ===== History & Export ===== */
async function openHistory(po_id){
  try{ const logs=await apiGet({action:'history',po_id});
    const html=logs.length?`<table><thead><tr><th>時刻</th><th>旧状態</th><th>新状態</th><th>旧工程</th><th>新工程</th><th>更新者</th><th>備考</th></tr></thead>
      <tbody>${logs.map(l=>`<tr><td>${fmtDT(l.timestamp)}</td><td>${l.prev_status||''}</td><td>${l.new_status||''}</td><td>${l.prev_process||''}</td><td>${l.new_process||''}</td><td>${l.updated_by||''}</td><td>${l.note||''}</td></tr>`).join('')}</tbody></table>`:'<div class="muted">履歴なし</div>';
    $('#histBody').innerHTML=html; document.getElementById('dlgHistory').showModal();
  }catch(e){ alert(e.message||e); }
}
async function exportOrdersCSV(){ const rows=await apiGet({action:'listOrders'}); downloadCSV('orders.csv',rows); }
async function exportShipCSV(){ const rows=await apiGet({action:'todayShip'}); downloadCSV('ship_today.csv',rows); }
function downloadCSV(name,rows){ if(!rows||!rows.length) return downloadFile(name,''); const headers=Object.keys(rows[0]);
  const csv=[headers.join(',')].concat(rows.map(r=>headers.map(h=>String(r[h]??'').replaceAll('"','""')).map(v=>`"${v}"`).join(','))).join('\n'); downloadFile(name,csv);}
function downloadFile(name,content){const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:'text/csv'})); a.download=name; a.click();}

/* ===== Sales / Plan / Ship / Charts (content sederhana) ===== */
async function loadSales(){ const rows=await apiGet({action:'listSales'}); $('#tbSales').innerHTML=rows.map(r=>`<tr><td>${r.so_id}</td><td>${r['得意先']||''}</td><td>${r['品名']||''}</td><td>${r['数量']||0}</td><td>${r.status||''}</td></tr>`).join(''); }
async function loadPlan(){ await renderOrders(); }
async function loadShip(){ const rows=await apiGet({action:'todayShip'}); $('#tbShip').innerHTML=rows.map(r=>`<tr><td>${r.ship_id||''}</td><td>${r.po_id||''}</td><td>${fmtD(r.scheduled_date)}</td><td>${r.qty||0}</td><td>${r.status||''}</td></tr>`).join(''); }
function loadCharts(){ /* placeholder – data sudah tersedia via chartsData_ jika ingin dikembangkan */ }

/* ===== Station QR ===== */
function renderStationQR(){
  const box=$('#stationWrap');
  box.innerHTML=PROCESSES.map((p,idx)=>`
    <div class="tile">
      <div class="row-between"><b>${p}</b>
        <button class="btn ghost s" onclick="openScan('${p}')"><i data-lucide="scan-line"></i>スキャン</button>
      </div>
      <div id="qr${idx}"></div>
      <div class="s muted">スマホでこのQRを開くと、この工程用スキャナが立ち上がります。</div>
    </div>`).join('');
  // Generate QR deep-link
  PROCESSES.forEach((p,idx)=>{
    const link=location.origin+location.pathname+`?proc=${encodeURIComponent(p)}&scan=1`;
    const el=document.getElementById('qr'+idx);
    new QRCode(el,{text:link,width:160,height:160});
  });
}

/* ===== Scanner (jsQR) ===== */
let scanStream=null, scanTimer=null;
function openScan(procHint){
  $('#scanProc').textContent = procHint||'';
  $('#dlgScan').showModal();
  startScanLoop(procHint);
}
function stopScan(){
  if(scanTimer){ cancelAnimationFrame(scanTimer); scanTimer=null; }
  const v=$('#scanVideo'); if(v.srcObject){ v.srcObject.getTracks().forEach(t=>t.stop()); v.srcObject=null; }
  $('#dlgScan').close();
}
async function startScanLoop(procHint){
  const video=$('#scanVideo'), canvas=$('#scanCanvas'), ctx=canvas.getContext('2d');
  try{
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    video.srcObject=media; await video.play();
  }catch(e){ alert('カメラエラー: '+e.message); return; }

  const loop=async ()=>{
    if(video.readyState===video.HAVE_ENOUGH_DATA){
      canvas.width=video.videoWidth; canvas.height=video.videoHeight;
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const img=ctx.getImageData(0,0,canvas.width,canvas.height);
      const code=jsQR(img.data,canvas.width,canvas.height,{inversionAttempts:"dontInvert"});
      if(code && code.data){
        await handleScanResult(code.data, procHint);
        stopScan(); return;
      }
    }
    scanTimer=requestAnimationFrame(loop);
  };
  loop();
}
async function handleScanResult(text, procHint){
  // Format QR: bisa PO-xxxxx saja, atau JSON: {"po_id":"PO-...","status":"検査済","process":"検査工程"}
  let po=null, status=null, proc=procHint||null;
  try{
    const obj=JSON.parse(text);
    po=obj.po_id||obj.PO||po;
    status=obj.status||status;
    proc=obj.process||obj.proc||proc;
  }catch{ // plain text
    if(text.startsWith('PO-')) po=text.trim();
  }
  if(!po){ alert('QR不明（POなし）'); return; }

  const updates={}; if(proc) updates.current_process=proc;
  if(status) updates.status=status;
  if(!updates.status && proc==='検査工程') updates.status='検査済'; // contoh otomatis
  try{
    await apiPost('updateOrder',{po_id:po,updates,user:SESSION});
    alert(`更新OK\nPO=${po}\n工程=${updates.current_process||'-'} / 状態=${updates.status||'-'}`);
    await refreshAll();
  }catch(e){ alert(e.message||e); }
}

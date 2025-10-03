/* ===== Config ===== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwnU2BvQ6poO4EmMut3g5Zuu_cuojNbTmM8oRSCyNJDwm_38VgS7BhsFLKU0eoUt-BAKw/exec";  // GANTI
const API_KEY  = ""; // optional

const PROCESSES = ['レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程'];

/* Station toggle rules */
const STATION_RULES = {
  'レーザ加工': (o)=> ({ current_process:'レーザ加工' }),
  '曲げ工程':   (o)=> ({ current_process:'曲げ加工' }),
  '外枠組立':   (o)=> ({ current_process:'外枠組立' }),
  'シャッター組立': (o)=> ({ current_process:'シャッター組立' }),
  'シャッター溶接': (o)=> ({ current_process:'シャッター溶接' }),
  'コーキング':   (o)=> ({ current_process:'コーキング' }),
  '外枠塗装':   (o)=> ({ current_process:'外枠塗装' }),
  '組立工程':   (o)=> (o.current_process==='組立（組立中）' ? { current_process:'組立（組立済）' } : { current_process:'組立（組立中）' }),
  '検査工程':   (o)=> (o.current_process==='検査工程' && !['検査保留','不良品（要リペア）','検査済'].includes(o.status) ? { current_process:'検査工程', status:'検査済' } : { current_process:'検査工程' }),
  '出荷工程':   (o)=> (o.status==='出荷準備' ? { current_process:o.current_process||'検査工程', status:'出荷済' } : { current_process:'検査工程', status:'出荷準備' })
};

const $ = s=>document.querySelector(s);
const fmtDT = s=> s? new Date(s).toLocaleString(): '';
const fmtD  = s=> s? new Date(s).toLocaleDateString(): '';

let SESSION=null, CURRENT_PO=null, scanStream=null, scanTimer=null;
let INV_PREVIEW={info:null, lines:[]};

/* ===== API (dengan error bar) ===== */
async function apiPost(action, body){
  const payload={action,...body}; if(API_KEY) payload.apiKey=API_KEY;
  try{
    const res=await fetch(API_BASE,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const j=await res.json(); if(!j.ok) throw new Error(j.error||'API error'); return j.data;
  }catch(err){ showApiError(action, err); throw err; }
}
async function apiGet(params){
  const url=API_BASE+'?'+new URLSearchParams(params).toString();
  try{
    const res=await fetch(url,{cache:'no-store'}); const j=await res.json(); if(!j.ok) throw new Error(j.error||'API error'); return j.data;
  }catch(err){ showApiError(params.action, err); throw err; }
}
function showApiError(action, err){
  console.error('API FAIL:', action, err);
  let bar=document.getElementById('errbar');
  if(!bar){ bar=document.createElement('div'); bar.id='errbar'; bar.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;background:#fee;border:1px solid #f99;color:#900;padding:10px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08);z-index:9999'; document.body.appendChild(bar); }
  bar.innerHTML=`<b>APIエラー</b> <code>${action}</code> — ${err.message||err}`;
}

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  // Nav
  $('#btnToDash').onclick   = ()=>{ show('pageDash'); };
  $('#btnToSales').onclick  = ()=>show('pageSales');
  $('#btnToPlan').onclick   = ()=>show('pagePlan');
  $('#btnToShip').onclick   = ()=>show('pageShip');
  $('#btnToInvoice').onclick= ()=>show('pageInvoice');
  $('#btnToCharts').onclick = ()=>{ show('pageCharts'); ensureChartsLoaded(); };
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
  $('#btnSalesSave')?.addEventListener('click', saveSalesUI);
  $('#btnSalesDelete')?.addEventListener('click', deleteSalesUI);
  $('#btnSalesExport')?.addEventListener('click', exportSalesCSV);
  $('#btnPromote')?.addEventListener('click', promoteSalesUI);
  $('#salesQ')?.addEventListener('input', renderSales);

  // Plan
  $('#btnCreateOrder')?.addEventListener('click', createOrderUI);
  $('#btnPlanExport')?.addEventListener('click', exportOrdersCSV);
  $('#btnPlanEdit')?.addEventListener('click', loadOrderForEdit);
  $('#btnPlanDelete')?.addEventListener('click', deleteOrderUI);

  // Ship
  $('#btnSchedule')?.addEventListener('click', scheduleUI);
  $('#btnShipExport')?.addEventListener('click', exportShipCSV);
  $('#btnShipEdit')?.addEventListener('click', loadShipForEdit);
  $('#btnShipDelete')?.addEventListener('click', deleteShipUI);
  $('#btnShipByPO')?.addEventListener('click', ()=>{ const po=$('#s_po').value.trim(); if(!po) return alert('注番入力'); openShipByPO(po); });
  $('#btnShipByID')?.addEventListener('click', ()=>{ const id=prompt('Ship ID:'); if(!id) return; openShipByID(id.trim()); });

  // Scan
  $('#btnScanStart')?.addEventListener('click', scanStart);
  $('#btnScanClose')?.addEventListener('click', scanClose);

  // Invoice
  $('#btnInvPreview')?.addEventListener('click', previewInvoiceUI);
  $('#btnInvCreate')?.addEventListener('click', createInvoiceUI);
  $('#btnInvPrint')?.addEventListener('click', ()=> openInvoiceDoc(INV_PREVIEW.inv_id||''));
  $('#btnInvCSV')?.addEventListener('click', exportInvoiceCSV);

  // Charts page
  $('#btnChartsRefresh')?.addEventListener('click', renderCharts);
  fillChartYearSelector();

  // Restore
  const saved=localStorage.getItem('erp_session');
  if(saved){ SESSION=JSON.parse(saved); enter(); } else show('authView');
});

/* ===== UI ===== */
function show(id){
  ['authView','pageDash','pageSales','pagePlan','pageShip','pageInvoice','pageCharts']
    .forEach(x=>document.getElementById(x)?.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}
function enter(){
  $('#userInfo').textContent = `${SESSION.full_name}・${SESSION.department}`;
  ['btnLogout','btnChangePass','btnToDash','btnToSales','btnToPlan','btnToShip','btnToInvoice','btnToCharts','btnShowStationQR']
    .forEach(id=>$('#'+id).classList.remove('hidden'));
  if (SESSION.role==='admin' || SESSION.department==='生産技術') $('#btnAddUserWeb').classList.remove('hidden'); else $('#btnAddUserWeb').classList.add('hidden');
  $('#btnAddUserWeb').onclick = openAddUserModal;

  show('pageDash'); loadMasters(); refreshAll();
}

/* ===== Auth ===== */
async function onLogin(){ const u=$('#inUser').value.trim(), p=$('#inPass').value.trim(); try{ const r=await apiPost('login',{username:u,password:p}); SESSION=r; localStorage.setItem('erp_session',JSON.stringify(r)); enter(); }catch(e){ alert(e.message||e); } }
async function addUserFromLoginUI(){
  if(!SESSION) return alert('ログインしてください');
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術')) return alert('権限不足（生産技術）');
  const payload={ username:$('#nuUser').value.trim(), password:$('#nuPass').value.trim(), full_name:$('#nuName').value.trim(), department:$('#nuDept').value, role:$('#nuRole').value };
  if(!payload.username||!payload.password||!payload.full_name) return alert('必須項目');
  try{ await apiPost('createUser',{user:SESSION,payload}); alert('作成しました'); }catch(e){ alert(e.message||e); }
}
async function changePasswordUI(){ if(!SESSION) return alert('ログインしてください'); const oldPass=prompt('旧パスワード:'); if(oldPass===null) return; const newPass=prompt('新パスワード:'); if(newPass===null) return; try{ await apiPost('changePassword',{user:SESSION,oldPass,newPass}); alert('変更しました。再ログインしてください。'); SESSION=null; localStorage.removeItem('erp_session'); location.reload(); }catch(e){ alert(e.message||e); } }

/* ===== Masters ===== */
async function loadMasters(){ try{ const m=await apiGet({action:'masters',types:'得意先,品名,品番,図番'}); const fill=(id,arr)=> $(id)?.innerHTML=(arr||[]).map(v=>`<option value="${v}"></option>`).join(''); fill('#dl_tokui',m['得意先']); fill('#dl_hinmei',m['品名']); fill('#dl_hinban',m['品番']); fill('#dl_zuban',m['図番']); }catch(e){ console.warn(e); } }

/* ===== Dashboard (tanpa charts) ===== */
async function refreshAll(keep=false){
  try{
    const s=await apiGet({action:'stock'}); $('#statFinished').textContent=s.finishedStock; $('#statReady').textContent=s.ready; $('#statShipped').textContent=s.shipped;
    const today=await apiGet({action:'todayShip'}); $('#listToday').innerHTML = today.length? today.map(r=>`<div><span>${r.po_id}</span><span>${fmtD(r.scheduled_date)}・${r.qty}</span></div>`).join(''):'<div class="muted">本日予定なし</div>';
    const loc=await apiGet({action:'locSnapshot'}); $('#gridProc').innerHTML = PROCESSES.map(p=> `<div class="grid-chip"><div class="muted s">${p}</div><div class="h">${loc[p]||0}</div></div>`).join('');
    if(!keep) $('#searchQ').value=''; await renderOrders(); await renderSales();
  }catch(e){ console.error(e); }
}
async function listOrders(){ const q=$('#searchQ').value.trim(); return apiGet({action:'listOrders',q}); }
async function renderOrders(){
  const rows=await listOrders();
  $('#tbOrders').innerHTML = rows.map(r=>`
    <tr>
      <td><b>${r.po_id}</b></td>
      <td>${r['得意先']||''}</td>
      <td>${r['製番号']||''}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td><span class="badge">${r.status}</span></td>
      <td>${r.current_process}</td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
      <td class="s">
        <button class="btn ghost s" onclick="openTicket('${r.po_id}')">票</button>
        <button class="btn ghost s" onclick="startScanFor('${r.po_id}')">更新</button>
        <button class="btn ghost s" onclick="openShipByPO('${r.po_id}')">出荷票</button>
        <button class="btn ghost s" onclick="openHistory('${r.po_id}')">履歴</button>
      </td>
    </tr>`).join('');
}

/* ===== Sales ===== */
async function renderSales(){
  const q=$('#salesQ')?.value?.trim()||''; if(!$('#tbSales')) return;
  const rows=await apiGet({action:'listSales',q});
  $('#tbSales').innerHTML = rows.map(r=>`
    <tr>
      <td>${r.so_id}</td>
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
  const p={'受注日':$('#so_date').value,'得意先':$('#so_cust').value,'品名':$('#so_item').value,'品番':$('#so_part').value,'図番':$('#so_drw').value,'製番号':$('#so_sei').value,'数量':$('#so_qty').value,'希望納期':$('#so_req').value,'備考':$('#so_note').value};
  const so=$('#so_id').value.trim();
  try{
    if(so){ await apiPost('updateSalesOrder',{so_id:so,updates:p,user:SESSION}); alert('受注を更新しました'); }
    else  { const r=await apiPost('createSalesOrder',{payload:p,user:SESSION}); alert('受注登録: '+r.so_id); $('#so_id').value=r.so_id; }
    renderSales();
  }catch(e){ alert(e.message||e); }
}
async function deleteSalesUI(){ const so=$('#so_id').value.trim(); if(!so) return alert('SO入力'); if(!confirm('削除しますか？')) return; try{ const r=await apiPost('deleteSalesOrder',{so_id:so,user:SESSION}); alert('削除: '+r.deleted); renderSales(); }catch(e){ alert(e.message||e); } }
async function promoteSalesUI(){ const so=$('#so_id').value.trim(); if(!so) return alert('SO入力'); try{ const r=await apiPost('promoteSalesToPlan',{so_id:so,user:SESSION}); alert('生産計画を作成: '+r.po_id); refreshAll(); }catch(e){ alert(e.message||e); } }
async function exportSalesCSV(){ const rows=await apiGet({action:'listSales'}); downloadCSV('sales_orders.csv', rows); }

/* ===== Plan CRUD ===== */
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
async function loadOrderForEdit(){ const po=$('#c_po').value.trim(); if(!po) return alert('PO入力'); try{ const o=await apiGet({action:'ticket',po_id:po}); $('#c_tsuchi').value=o['通知書番号']||''; $('#c_tokui').value=o['得意先']||''; $('#c_tokui_hin').value=o['得意先品番']||''; $('#c_sei').value=o['製番号']||''; $('#c_hinmei').value=o['品名']||''; $('#c_hinban').value=o['品番']||''; $('#c_zuban').value=o['図番']||''; $('#c_kanri').value=o['管理No']||''; alert('読み込み完了。'); }catch(e){ alert(e.message||e); } }
async function deleteOrderUI(){ if(!(SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部')) return alert('権限不足'); const po=$('#c_po').value.trim(); if(!po) return alert('PO入力'); if(!confirm('削除しますか？')) return; try{ const r=await apiPost('deleteOrder',{po_id:po,user:SESSION}); alert('削除:'+r.deleted); refreshAll(); }catch(e){ alert(e.message||e); } }

/* ===== Ship CRUD ===== */
async function scheduleUI(){ if(!(SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部')) return alert('権限不足'); const po=$('#s_po').value.trim(), dateIso=$('#s_date').value, qty=$('#s_qty').value; if(!po||!dateIso) return alert('注番と日付'); try{ const shipId=$('#s_shipid').value.trim(); if (shipId){ await apiPost('updateShipment',{ship_id:shipId,updates:{po_id:po,scheduled_date:dateIso,qty:qty},user:SESSION}); alert('出荷予定を編集しました'); }else{ const r=await apiPost('scheduleShipment',{po_id:po,dateIso,qty,user:SESSION}); alert('登録: '+r.ship_id); } refreshAll(true); }catch(e){ alert(e.message||e); } }
async function loadShipForEdit(){ const sid=$('#s_shipid').value.trim(); if(!sid) return alert('Ship ID入力'); try{ const d=await apiGet({action:'shipById',ship_id:sid}); $('#s_po').value=d.shipment.po_id||''; $('#s_date').value = d.shipment.scheduled_date? new Date(d.shipment.scheduled_date).toISOString().slice(0,10):''; $('#s_qty').value=d.shipment.qty||0; alert('読み込み完了。'); }catch(e){ alert(e.message||e); } }
async function deleteShipUI(){ if(!(SESSION.role==='admin'||SESSION.department==='生産技術'||SESSION.department==='生産管理部')) return alert('権限不足'); const sid=$('#s_shipid').value.trim(); if(!sid) return alert('Ship ID入力'); if(!confirm('削除しますか？')) return; try{ const r=await apiPost('deleteShipment',{ship_id:sid,user:SESSION}); alert('削除:'+r.deleted); refreshAll(true); }catch(e){ alert(e.message||e); } }

/* ===== Docs ===== */
async function openTicket(po_id){ try{ const o=await apiGet({action:'ticket',po_id}); const body=`<h3>生産現品票</h3><table>
<tr><th>管理No</th><td>${o['管理No']||'-'}</td><th>通知書番号</th><td>${o['通知書番号']||'-'}</td></tr>
<tr><th>得意先</th><td>${o['得意先']||''}</td><th>得意先品番</th><td>${o['得意先品番']||''}</td></tr>
<tr><th>製番号</th><td>${o['製番号']||''}</td><th>投入日</th><td>${o['created_at']?new Date(o['created_at']).toLocaleDateString():'-'}</td></tr>
<tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
<tr><th>工程</th><td colspan="3">${o.current_process}</td></tr>
<tr><th>状態</th><td>${o.status}</td><th>更新</th><td>${fmtDT(o.updated_at)} / ${o.updated_by||''}</td></tr></table>`; showDoc('dlgTicket',body);}catch(e){ alert(e.message||e); } }
function showShipDoc(s,o){ const dt=s.scheduled_date? new Date(s.scheduled_date):null; const body=`<h3>出荷確認書</h3><table>
<tr><th>得意先</th><td>${o['得意先']||''}</td><th>出荷日</th><td>${dt?dt.toLocaleDateString():'-'}</td></tr>
<tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
<tr><th>注番</th><td>${o.po_id||s.po_id}</td><th>数量</th><td>${s.qty||0}</td></tr>
<tr><th>出荷ステータス</th><td>${s.status}</td><th>備考</th><td></td></tr></table>`; showDoc('dlgShip',body); }
async function openShipByPO(po_id){ try{ const d=await apiGet({action:'shipByPo',po_id}); showShipDoc(d.shipment,d.order);}catch(e){ alert(e.message||e);} }
async function openShipByID(id){ try{ const d=await apiGet({action:'shipById',ship_id:id}); showShipDoc(d.shipment,d.order);}catch(e){ alert(e.message||e);} }
function showDoc(id,html){ const dlg=document.getElementById(id); dlg.querySelector('.body').innerHTML=html; dlg.showModal(); }

/* ===== Export helpers ===== */
async function exportOrdersCSV(){ const rows=await apiGet({action:'listOrders'}); downloadCSV('orders.csv',rows); }
async function exportShipCSV(){ const rows=await apiGet({action:'todayShip'}); downloadCSV('ship_today.csv',rows); }
function downloadCSV(name,rows){ if(!rows||!rows.length) return downloadFile(name,''); const headers=Object.keys(rows[0]); const csv=[headers.join(',')].concat(rows.map(r=> headers.map(h=> String(r[h]??'').replaceAll('"','""')).map(v=>`"${v}"`).join(','))).join('\n'); downloadFile(name,csv); }
function downloadFile(name,content){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:'text/csv'})); a.download=name; a.click(); }

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
    new QRCode(holder,{ text:'ST:'+st, width:200, height:200, correctLevel:QRCode.CorrectLevel.M });
    setTimeout(()=>{ const cvs=holder.querySelector('canvas'); const img=holder.querySelector('img'); let url=''; if(cvs&&cvs.toDataURL) url=cvs.toDataURL('image/png'); else if(img&&img.src) url=img.src; if(url){ link.href=url; link.download=`ST-${st}.png`; } else link.remove(); },50);
  });
  document.getElementById('dlgStationQR').showModal();
}

/* ===== Scan flow ===== */
function startScanFor(po_id){ CURRENT_PO=po_id; $('#scanPO').textContent=po_id; $('#scanResult').textContent='開始を押してQRを読み取ってください'; document.getElementById('dlgScan').showModal(); }
async function scanStart(){
  try{
    if(scanStream) return;
    const v=$('#scanVideo'), c=$('#scanCanvas'), ctx=c.getContext('2d');
    const st=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    scanStream=st; v.srcObject=st; await v.play();
    scanTimer=setInterval(async ()=>{
      c.width=v.videoWidth; c.height=v.videoHeight; ctx.drawImage(v,0,0,c.width,c.height);
      const code=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
      if(code && code.data){
        const text=code.data.trim(); $('#scanResult').textContent='読み取り: '+text;
        if(/^ST:/.test(text) && CURRENT_PO){
          const station=text.slice(3); const rule=STATION_RULES[station]; if(!rule){ $('#scanResult').textContent='未知のステーション: '+station; return; }
          try{ const cur=await apiGet({action:'ticket',po_id:CURRENT_PO}); const updates=rule(cur); await apiPost('updateOrder',{po_id:CURRENT_PO,updates,user:SESSION}); $('#scanResult').textContent=`更新完了: ${CURRENT_PO} → ${updates.status||'(状態変更なし)'} / ${updates.current_process||cur.current_process}`; refreshAll(true);}catch(e){ $('#scanResult').textContent='更新失敗: '+(e.message||e); }
        }
      }
    }, 500);
  }catch(e){ alert('カメラ起動失敗: '+(e.message||e)); }
}
function scanClose(){ clearInterval(scanTimer); scanTimer=null; if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; } document.getElementById('dlgScan').close(); }

/* ===== History ===== */
async function openHistory(po_id){ try{ const logs=await apiGet({action:'history',po_id}); const html = logs.length? `<table><thead><tr><th>時刻</th><th>旧状態</th><th>新状態</th><th>旧工程</th><th>新工程</th><th>更新者</th><th>備考</th></tr></thead>
<tbody>${logs.map(l=>`<tr><td>${fmtDT(l.timestamp)}</td><td>${l.prev_status||''}</td><td>${l.new_status||''}</td><td>${l.prev_process||''}</td><td>${l.new_process||''}</td><td>${l.updated_by||''}</td><td>${l.note||''}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">履歴なし</div>'; $('#histBody').innerHTML=html; document.getElementById('dlgHistory').showModal(); }catch(e){ alert(e.message||e); } }

/* ===== Add user (navbar) ===== */
function openAddUserModal(){
  if(!(SESSION.role==='admin'||SESSION.department==='生産技術')) return alert('権限不足');
  const html=`<h3>ユーザー追加</h3>
    <div class="grid">
      <input id="au_username" placeholder="ユーザー名">
      <input id="au_password" type="password" placeholder="パスワード">
      <input id="au_fullname" placeholder="氏名">
      <select id="au_dept"><option>営業</option><option>生産技術</option><option>生産管理部</option><option>製造部</option><option>検査部</option></select>
      <select id="au_role"><option>member</option><option>manager</option><option>admin</option></select>
    </div>
    <div class="row-end" style="margin-top:.6rem"><button class="btn primary" id="au_save">保存</button></div>`;
  const dlg=document.getElementById('dlgTicket'); dlg.querySelector('.body').innerHTML=html; dlg.showModal();
  document.getElementById('au_save').onclick=async ()=>{
    const payload={ username:$('#au_username').value.trim(), password:$('#au_password').value.trim(), full_name:$('#au_fullname').value.trim(), department:$('#au_dept').value, role:$('#au_role').value };
    if(!payload.username||!payload.password||!payload.full_name) return alert('必須項目');
    try{ await apiPost('createUser',{user:SESSION,payload}); alert('作成しました'); dlg.close(); }catch(e){ alert(e.message||e); }
  };
}

/* ===== Invoice UI ===== */
/* (Tetap sama seperti sebelumnya) */
function recalcInvoiceTotals(){ /* … */ }
async function previewInvoiceUI(){ /* … */ }
async function createInvoiceUI(){ /* … */ }
async function openInvoiceDoc(inv_id){ /* … */ }
function exportInvoiceCSV(){ /* … */ }

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
  const year=Number($('#chartYear').value)|| (new Date()).getFullYear();
  let d=null;
  try{
    d=await apiGet({action:'charts', year});
  }catch(e){
    // fallback dummy supaya bisa uji cepat
    d={year, perMonth:Array(12).fill(0).map((_,i)=> (i%3+1)*10), perCust:{TSH:30,ABC:20,XYZ:10}, stockBuckets:{'検査済':5,'出荷準備':2,'出荷済':8}, wipByProcess:{'レーザ加工':2,'曲げ加工':1}, salesPerMonth:Array(12).fill(0).map((_,i)=>i*5), planPerMonth:Array(12).fill(0).map((_,i)=> (i%4)*3)};
  }

  const months=['1','2','3','4','5','6','7','8','9','10','11','12'];

  // Destroy old
  Object.keys(CHARTS).forEach(k=>{ CHARTS[k]?.destroy?.(); });

  const opts = {responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:true}}, scales:{x:{ticks:{autoSkip:false}}}};

  CHARTS.monthly = new Chart($('#chMonthly'),{
    type:'bar', data:{labels:months, datasets:[{label:`月別出荷数量（${d.year}）`, data:d.perMonth}]}, options:opts
  });
  CHARTS.customer = new Chart($('#chCustomer'),{
    type:'bar', data:{labels:Object.keys(d.perCust||{}), datasets:[{label:'得意先別出荷', data:Object.values(d.perCust||{})}]}, options:opts
  });
  CHARTS.stock = new Chart($('#chStock'),{
    type:'pie', data:{labels:Object.keys(d.stockBuckets||{}), datasets:[{label:'在庫区分', data:Object.values(d.stockBuckets||{})}]}, options:{responsive:true, maintainAspectRatio:false}
  });
  CHARTS.wipProc = new Chart($('#chWipProc'),{
    type:'bar', data:{labels:Object.keys(d.wipByProcess||{}), datasets:[{label:'工程内WIP', data:Object.values(d.wipByProcess||{})}]}, options:opts
  });
  CHARTS.sales = new Chart($('#chSales'),{
    type:'line', data:{labels:months, datasets:[{label:`営業 受注数（${d.year}）`, data:d.salesPerMonth||[], tension:.3}]}, options:opts
  });
  CHARTS.plan = new Chart($('#chPlan'),{
    type:'line', data:{labels:months, datasets:[{label:`生産計画 作成数（${d.year}）`, data:d.planPerMonth||[], tension:.3}]}, options:opts
  });
}

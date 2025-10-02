/* ===========================
   CONFIG & HELPERS
=========================== */
const API_URL = (typeof window !== 'undefined' && window.GAS_URL) ? window.GAS_URL : '';

const Endpoints = {
  ping: ()=> `${API_URL}?action=ping`,
  login: (u,p)=> `${API_URL}?action=login&username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`,
  listOrders: (q='')=> `${API_URL}?action=listOrders&q=${encodeURIComponent(q)}`,
  locSnapshot: ()=> `${API_URL}?action=locSnapshot`,
  masters: ()=> `${API_URL}?action=masters`,
  listSales: (q='')=> `${API_URL}?action=listSales&q=${encodeURIComponent(q)}`,
  createSales: (payload,user)=> `${API_URL}?action=createSalesOrder&payload=${encodeURIComponent(encodeURIComponent(JSON.stringify(payload)))}&user=${encodeURIComponent(encodeURIComponent(JSON.stringify(user)))}`,
  stock: ()=> `${API_URL}?action=stock`,
  charts: ()=> `${API_URL}?action=charts`,
  updateOrder: (po,updates,user)=> `${API_URL}?action=updateOrder&po_id=${encodeURIComponent(po)}&updates=${encodeURIComponent(encodeURIComponent(JSON.stringify(updates)))}&user=${encodeURIComponent(encodeURIComponent(JSON.stringify(user)))}`
};

const $ = (sel)=> document.querySelector(sel);
const show = (el, yes)=> el.classList[yes?'remove':'add']('hidden');
const loading = (on)=> show($('#loading'), on);
const fmtDateTime = (d)=> d ? new Date(d).toLocaleString() : '';

let CURRENT_USER = null;

/* ===========================
   PROC STYLE MAPPING
=========================== */
const PROC_STYLE = {
  'レーザ加工': 'laser',
  '曲げ加工': 'bend',
  '外枠組立': 'frame',
  'シャッター組立': 'sh-assy',
  'シャッター溶接': 'sh-weld',
  'コーキング': 'caulk',
  '外枠塗装': 'tosou',
  'シャッター塗装': 'sh-tosou',
  '塗装': 'tosou',
  '組立（組立中）': 'asm-in',
  '組立（組立済）': 'asm-ok',
  '外注': 'out',
  '検査工程': 'inspect'
};
function procClass(kouteiName=''){
  const key = String(kouteiName).trim();
  const cls = PROC_STYLE[key] || 'proc';
  return `proc ${cls}`;
}
function renderProcChip(container, koutei, count){
  const div = document.createElement('div');
  div.className = `grid-chip ${procClass(koutei)}`;
  div.innerHTML = `<div class="s">${koutei||'-'}</div><div class="h">${count||0}</div>`;
  container.appendChild(div);
}

/* ===========================
   LOGIN & NAV
=========================== */
async function doLogin(){
  if(!API_URL){ alert('GAS_URL belum terpasang di index.html'); return; }
  loading(true);
  try{
    // sanity check
    await fetch(Endpoints.ping()).then(r=>r.json());
    const u = $('#inUser').value.trim();
    const p = $('#inPass').value.trim();
    const r = await fetch(Endpoints.login(u,p)); const j=await r.json();
    if(!j.ok) throw new Error(j.error||'Login error');
    CURRENT_USER = j.data;
    $('#userInfo').textContent = `${CURRENT_USER.full_name||CURRENT_USER.username}`;
    show($('#authView'), false);
    ['btnToDash','btnToSales','btnToPlan','btnToCharts','btnLogout'].forEach(id=> show($('#'+id), true));
    show($('#pageDash'), true);
    await refreshAll();
  }catch(e){ alert(e.message); } finally{ loading(false); }
}
$('#btnLogin')?.addEventListener('click', doLogin);
$('#btnLogout')?.addEventListener('click', ()=> location.reload());
$('#btnToDash')?.addEventListener('click', ()=>{ show($('#pageDash'), true); show($('#pageSales'), false); show($('#pagePlan'), false); });
$('#btnToSales')?.addEventListener('click', ()=>{ show($('#pageDash'), false); show($('#pageSales'), true); show($('#pagePlan'), false); loadMasters(); loadSales(); });
$('#btnToPlan')?.addEventListener('click', ()=>{ show($('#pageDash'), false); show($('#pageSales'), false); show($('#pagePlan'), true); renderPlanProcGrid(); });

/* ===========================
   DASHBOARD
=========================== */
async function refreshAll(){
  await Promise.all([
    refreshOrders(),
    updateStatsAndCharts(),
    renderDashboardProcGrid()
  ]);
}
async function refreshOrders(){
  loading(true);
  try{
    const q = $('#searchQ').value||'';
    const res = await fetch(Endpoints.listOrders(q)); const j = await res.json();
    if(!j.ok) throw new Error(j.error||'listOrders error');
    const rows = j.data||[];
    const tb = $('#tbOrders'); tb.innerHTML='';
    rows.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td>${r.po_id||''}</td>
        <td>${r['得意先']||''}</td>
        <td>${r['製番号']||''}</td>
        <td>${r['品名']||''}</td>
        <td>${r.status||''}</td>
        <td>${r.current_process||''}</td>
        <td>${fmtDateTime(r.updated_at)}</td>
        <td>${r.updated_by||''}</td>
      `;
      tb.appendChild(tr);
    });
  }catch(e){ console.error(e); alert(e.message); } finally{ loading(false); }
}
$('#btnRefresh')?.addEventListener('click', refreshOrders);

/* 現在位置 grid (Dashboard) */
async function renderDashboardProcGrid(){
  const grid = $('#gridProc'); grid.innerHTML='';
  try{
    const r = await fetch(Endpoints.locSnapshot()); const j = await r.json();
    if(!j.ok) throw new Error(j.error||'locSnapshot error');
    const map = j.data||{};
    Object.keys(map).forEach(koutei=> renderProcChip(grid, koutei, map[koutei]||0) );
  }catch(e){
    console.warn(e.message);
    ['レーザ加工','外枠塗装','検査工程'].forEach((k,i)=> renderProcChip(grid,k,(i+1)*2));
  }
}

/* Stats + Charts */
let chMonthly=null, chCustomer=null;
async function updateStatsAndCharts(){
  try{
    const sres = await fetch(Endpoints.stock()); const sj = await sres.json();
    if(sj.ok){
      $('#statFinished').textContent = sj.data.finishedStock;
      $('#statReady').textContent    = sj.data.ready;
      $('#statShipped').textContent  = sj.data.shipped;
    }
    const cres = await fetch(Endpoints.charts()); const cj = await cres.json();
    if(cj.ok){
      renderBar('#chMonthly',  cj.data.monthly.labels,  cj.data.monthly.values,  v=>chMonthly=v, chMonthly);
      renderBar('#chCustomer', cj.data.customer.labels, cj.data.customer.values, v=>chCustomer=v, chCustomer);
    }
  }catch(e){ console.warn(e.message); }
}
function renderBar(sel, labels, values, setRef, prev){
  const ctx=$(sel).getContext('2d'); if(prev) prev.destroy();
  const inst = new Chart(ctx,{ type:'bar', data:{ labels, datasets:[{label:'数量',data:values}]}, options:{responsive:true,plugins:{legend:{display:false}}}});
  setRef(inst);
}

/* ===========================
   SALES (Masters + List + Create)
=========================== */
async function loadMasters(){
  try{
    const r = await fetch(Endpoints.masters()); const j = await r.json();
    if(!j.ok) throw new Error(j.error||'masters error');
    const cs=new Set(), ns=new Set(), ps=new Set(), zs=new Set();
    (j.data||[]).forEach(m=>{
      if(String(m.is_active).toLowerCase()!=='true') return;
      const type=String(m.type||'').trim(), name=String(m.name||'').trim(),
            code=String(m.code||'').trim(), z=String(m.zuban||'').trim();
      if(type==='得意先'&&(name||code)) cs.add(name||code);
      if(type==='品名' && name) ns.add(name);
      if(type==='品番'&&(name||code)) ps.add(name||code);
      if(type==='図番'&&(name||z))    zs.add(name||z);
    });
    fillDL('dl_tokui',[...cs]); fillDL('dl_hinmei',[...ns]); fillDL('dl_hinban',[...ps]); fillDL('dl_zuban',[...zs]);
  }catch(e){ console.warn(e.message); }
}
function fillDL(id, arr){
  const dl=$('#'+id); if(!dl) return; dl.innerHTML='';
  arr.sort().forEach(v=>{ const o=document.createElement('option'); o.value=v; dl.appendChild(o); });
}
async function loadSales(){
  try{
    const q=$('#salesQ').value||''; const r=await fetch(Endpoints.listSales(q)); const j=await r.json();
    if(!j.ok) throw new Error(j.error||'listSales error');
    const tb=$('#tbSales'); tb.innerHTML='';
    (j.data||[]).forEach(s=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td>${s.so_id||''}</td>
        <td>${fmtDateTime(s['受注日'])}</td>
        <td>${s['得意先']||''}</td>
        <td>${s['品名']||''}</td>
        <td>${(s['品番']||'')}/${(s['図番']||'')}</td>
        <td>${s['数量']||0}</td>
        <td>${fmtDateTime(s['希望納期'])}</td>
        <td>${s.status||''}</td>
        <td>${s.linked_po_id||''}</td>
        <td>${fmtDateTime(s.updated_at)}</td>`;
      tb.appendChild(tr);
    });
  }catch(e){ console.warn(e.message); }
}
$('#salesQ')?.addEventListener('keydown', e=>{ if(e.key==='Enter') loadSales(); });
$('#btnSalesSave')?.addEventListener('click', async ()=>{
  const payload={
    '受注日': $('#so_date').value || new Date().toISOString().slice(0,10),
    '得意先': $('#so_cust').value.trim(),
    '品名':   $('#so_item').value.trim(),
    '品番':   $('#so_part').value.trim(),
    '図番':   $('#so_drw').value.trim(),
    '製番号': $('#so_sei').value.trim(),
    '数量':   Number($('#so_qty').value||0),
    '希望納期': $('#so_req').value || '',
    '備考': $('#so_note').value.trim()
  };
  try{
    const r = await fetch(Endpoints.createSales(payload, CURRENT_USER)); const j = await r.json();
    if(!j.ok) throw new Error(j.error||'保存失敗');
    alert('保存OK: '+j.data.so_id);
    loadSales();
  }catch(e){ alert(e.message); }
});

/* ===========================
   PLAN (pakai procClass juga)
=========================== */
async function renderPlanProcGrid(){
  const wrap = $('#planProcGrid'); wrap.innerHTML='';
  try{
    const r = await fetch(Endpoints.locSnapshot()); const j = await r.json();
    if(!j.ok) throw new Error(j.error||'locSnapshot error');
    const map = j.data||{};
    Object.entries(map).forEach(([k,c])=> renderProcChip(wrap, k, c||0) );
  }catch(e){
    ['外枠塗装','シャッター塗装','組立（組立中）'].forEach((k,i)=> renderProcChip(wrap,k,(i+1)*3));
  }
}

/* ===========================
   SCANNER: BarcodeDetector + jsQR
=========================== */
const logScan = (msg)=> { const el=$('#scanResult'); if(el) el.textContent = msg||''; };
let _scanStream=null, _scanRAF=null;

async function onQRDecoded(text){
  logScan(`QR: ${text}`);
  // dukung format: PO:xxx, ST:工程, STATUS:xxx, NOTE:xxx
  const upd={}; let po=null;
  String(text).split(/\r?\n/).forEach(line=>{
    const [k,...rest]=line.split(':'); const v=rest.join(':').trim();
    if(/^ST$/i.test(k)) upd.current_process = v;
    if(/^STATUS$/i.test(k)) upd.status = v;
    if(/^NOTE$/i.test(k)) upd.note = v;
    if(/^PO$/i.test(k)) po = v;
  });
  try{
    if(po && (upd.current_process || upd.status || upd.note)){
      const r = await fetch(Endpoints.updateOrder(po, upd, CURRENT_USER));
      const j = await r.json(); if(!j.ok) throw new Error(j.error||'update gagal');
      await stopScan(); $('#dlgScan')?.close(); await refreshAll();
      alert('更新しました');
    }else{
      await stopScan(); $('#dlgScan')?.close();
      alert(`読み取り: ${text}`);
    }
  }catch(e){ alert(e.message); }
}
async function tryBarcodeDetector(video){
  if(!('BarcodeDetector' in window)) return false;
  let formats=['qr_code']; try{
    const sup = await BarcodeDetector.getSupportedFormats?.();
    if(sup && sup.includes('qr_code')) formats=['qr_code'];
  }catch{}
  const detector = new BarcodeDetector({formats});
  const loop = async ()=>{
    try{
      const res = await detector.detect(video);
      if(res && res.length){
        const v = res[0].rawValue || res[0].rawValue?.trim() || '';
        if(v){ await onQRDecoded(v); return; }
      }
    }catch(e){}
    _scanRAF = requestAnimationFrame(loop);
  };
  loop(); return true;
}
function tryJsQR(video, canvas){
  const ctx = canvas.getContext('2d');
  const loop=()=>{
    const w=video.videoWidth, h=video.videoHeight;
    if(w&&h){
      canvas.width=w; canvas.height=h;
      ctx.drawImage(video,0,0,w,h);
      const img=ctx.getImageData(0,0,w,h);
      const code=jsQR(img.data,w,h,{inversionAttempts:'attemptBoth'});
      if(code && code.data){ onQRDecoded(code.data); return; }
    }
    _scanRAF=requestAnimationFrame(loop);
  };
  loop();
}
async function startScan(){
  const video = $('#scanVideo'), canvas=$('#scanCanvas'), dlg=$('#dlgScan');
  if(!video||!canvas){ alert('UI scan tidak lengkap'); return; }
  const cons={audio:false, video:{facingMode:{ideal:'environment'}}};
  try{
    _scanStream = await navigator.mediaDevices.getUserMedia(cons);
    video.srcObject=_scanStream; await video.play();
    logScan('カメラを起動しました。QRに向けてください…');
    const okNative = await tryBarcodeDetector(video);
    if(!okNative) tryJsQR(video, canvas);
  }catch(e){ console.error(e); alert('カメラにアクセスできません'); }
  if(dlg && !dlg.open) dlg.showModal();
}
async function stopScan(){
  if(_scanRAF){ cancelAnimationFrame(_scanRAF); _scanRAF=null; }
  if(_scanStream){ _scanStream.getTracks().forEach(t=>t.stop()); _scanStream=null; }
  logScan('');
}
async function decodeFromFile(file){
  if(!file) return;
  const img=new Image();
  img.onload=()=>{
    const canvas=$('#scanCanvas'); const ctx=canvas.getContext('2d');
    canvas.width=img.width; canvas.height=img.height;
    ctx.drawImage(img,0,0);
    const d=ctx.getImageData(0,0,canvas.width,canvas.height);
    const code=jsQR(d.data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});
    if(code && code.data) onQRDecoded(code.data); else alert('画像からQRを読取できません');
  };
  img.src=URL.createObjectURL(file);
}
$('#btnOpenScanner')?.addEventListener('click', ()=> $('#dlgScan')?.showModal());
$('#btnScanStart')?.addEventListener('click', startScan);
$('#btnScanClose')?.addEventListener('click', ()=>{ stopScan(); $('#dlgScan')?.close(); });
$('#btnScanFromFile')?.addEventListener('click', ()=> $('#fileQR')?.click());
$('#fileQR')?.addEventListener('change', (e)=> decodeFromFile(e.target.files?.[0]) );

/* ===========================
   BOOT
=========================== */
document.addEventListener('DOMContentLoaded', ()=>{ window.lucide&&lucide.createIcons(); });

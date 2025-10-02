/* ====== CONFIG ====== */
const GAS_URL = (localStorage.getItem('GAS_URL')
  || 'https://script.google.com/macros/s/AKfycbxQ1vV7lfEAoIPPq09K6a7yCJtSzEtlt6ncjv6K3QG3ydQOeTBdK0u5Hlu1Nme0EKbGnw/exec')
  .trim();

/* ====== UTILS ====== */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const show = (el, on=true)=> el.classList[on?'remove':'add']('hidden');
const loading = on => show(document.getElementById('loading'), on);
const fmt = d => { if(!d) return ''; const t=new Date(d); return isNaN(+t)?'':t.toISOString().slice(0,19).replace('T',' '); };

async function apiGet(params){
  const url = GAS_URL + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url, { method:'GET' });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const j = await res.json(); if(!j.ok) throw new Error(j.error||'Server'); return j.data;
}
async function apiAction(action, params){ return apiGet({ action, ...params }); }

/* ====== AUTH ====== */
let CURRENT_USER=null;
document.getElementById('btnLogin').onclick = async ()=>{
  try{
    loading(true);
    const u=document.getElementById('inUser').value.trim();
    const p=document.getElementById('inPass').value.trim();
    CURRENT_USER = await apiAction('login', { username:u, password:p });
    show(document.getElementById('authView'), false);
    ['btnToDash','btnToSales','btnToCharts','btnLogout'].forEach(id=>show(document.getElementById(id), true));
    document.getElementById('userInfo').textContent = `${CURRENT_USER.full_name}（${CURRENT_USER.department}）`;
    bindNav();
    toPage('pageDash'); refreshDashboard(); loadMasters(); loadSalesList();
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
};

document.getElementById('btnLogout').onclick = ()=> location.reload();

function bindNav(){
  document.getElementById('btnToDash').onclick   = ()=>{ toPage('pageDash'); refreshDashboard(); };
  document.getElementById('btnToSales').onclick  = ()=>{ toPage('pageSales');  loadSalesList(); };
  document.getElementById('btnToCharts').onclick = ()=>{ toPage('pageCharts'); loadCharts(); };
}
function toPage(id){ ['pageDash','pageSales','pageCharts'].forEach(pid=>show(document.getElementById(pid), pid===id)); }

/* ====== DASHBOARD ====== */
async function refreshDashboard(){
  try{
    loading(true);
    const rows = await apiGet({action:'listOrders', q: document.getElementById('searchQ').value||''});
    const tb = document.getElementById('tbOrders'); tb.innerHTML='';
    for(const r of rows){
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td>${r.po_id||''}</td>
        <td>${r['得意先']||''}</td>
        <td>${r['製番号']||''}</td>
        <td>${r['品名']||''}</td>
        <td>${r['品番']||''}</td>
        <td>${r['図番']||''}</td>
        <td>${r.status||''}</td>
        <td>${r.current_process||''}</td>
        <td>${fmt(r.updated_at)}</td>
        <td>${r.updated_by||''}</td>
        <td><button class="btn s ghost" data-scan="${r.po_id}"><i data-lucide="scan"></i>スキャン</button></td>`;
      tb.appendChild(tr);
    }
    window.lucide&&lucide.createIcons();
    Array.from(document.querySelectorAll('#tbOrders [data-scan]')).forEach(b=> b.onclick = ()=> openScan(b.dataset.scan));
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
}
document.getElementById('btnRefresh').onclick = refreshDashboard;

/* ====== MASTERS → datalist ====== */
let MASTERS={customer:[],name:[],part:[],drw:[]};
async function loadMasters(){
  try{
    const rows = await apiGet({action:'masters'});
    const cs=new Set(), ns=new Set(), ps=new Set(), zs=new Set();
    rows.forEach(r=>{
      if(String(r.is_active).toLowerCase()!=='true') return;
      const t=String(r.type||'').trim(), name=String(r.name||'').trim(), code=String(r.code||'').trim(), z=String(r.zuban||'').trim();
      if(t==='得意先'&&(name||code)) cs.add(name||code);
      if(t==='品名'&&name) ns.add(name);
      if(t==='品番'&&(name||code)) ps.add(name||code);
      if(t==='図番'&&(name||z)) zs.add(name||z);
    });
    MASTERS.customer=[...cs]; MASTERS.name=[...ns]; MASTERS.part=[...ps]; MASTERS.drw=[...zs];
    fillDL('dl_tokui',MASTERS.customer); fillDL('dl_hinmei',MASTERS.name); fillDL('dl_hinban',MASTERS.part); fillDL('dl_zuban',MASTERS.drw);
  }catch(e){ console.warn('masters fail:',e.message); }
}
function fillDL(id,arr){ const dl=document.getElementById(id); dl.innerHTML=''; arr.sort().forEach(v=>{const o=document.createElement('option');o.value=v;dl.appendChild(o);}); }

/* ====== SALES ====== */
document.getElementById('btnSalesSave').onclick = async ()=>{
  try{
    loading(true);
    const payload={
      '受注日': document.getElementById('so_date').value || new Date().toISOString().slice(0,10),
      '得意先': document.getElementById('so_cust').value.trim(),
      '品名':   document.getElementById('so_item').value.trim(),
      '品番':   document.getElementById('so_part').value.trim(),
      '図番':   document.getElementById('so_drw').value.trim(),
      '製番号': document.getElementById('so_sei').value.trim(),
      '数量':   Number(document.getElementById('so_qty').value||0),
      '希望納期': document.getElementById('so_req').value || '',
      '備考': document.getElementById('so_note').value.trim()
    };
    const r = await apiAction('createSalesOrder', {
      payload: encodeURIComponent(JSON.stringify(payload)),
      user:    encodeURIComponent(JSON.stringify(CURRENT_USER))
    });
    alert('保存OK: '+r.so_id);
    loadSalesList();
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
};

async function loadSalesList(){
  try{
    loading(true);
    const rows = await apiGet({action:'listSales', q: document.getElementById('salesQ').value||''});
    const tb=document.getElementById('tbSales'); tb.innerHTML='';
    for(const r of rows){
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td>${r.so_id||''}</td>
        <td>${fmt(r['受注日'])}</td>
        <td>${r['得意先']||''}</td>
        <td>${r['品名']||''}</td>
        <td>${(r['品番']||'')}/${(r['図番']||'')}</td>
        <td>${r['数量']||0}</td>
        <td>${fmt(r['希望納期'])}</td>
        <td>${r.status||''}</td>
        <td>${r.linked_po_id||''}</td>
        <td>${fmt(r.updated_at)}</td>`;
      tb.appendChild(tr);
    }
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
}
document.getElementById('salesQ').onkeydown = e=>{ if(e.key==='Enter') loadSalesList(); };

/* ====== SCAN (html5-qrcode + jsQR fallback) ====== */
let _h5=null, _scanPO=null;
function openScan(po){ _scanPO=po; document.getElementById('scanPO').textContent=po; document.getElementById('scanResult').textContent=''; document.getElementById('dlgScan').showModal(); }
async function stopScan(){ try{ if(_h5){ await _h5.stop(); await _h5.clear(); } }catch{} _h5=null; }
document.getElementById('btnScanClose').onclick = async ()=>{ await stopScan(); document.getElementById('dlgScan').close(); };

document.getElementById('btnScanStart').onclick = async ()=>{
  try{
    if(!_h5) _h5 = new Html5Qrcode('scanHtml5', { verbose:false });
    await _h5.start({ facingMode:'environment' }, { fps:10, qrbox:{width:240,height:240} }, txt=>onScanText(txt), ()=>{});
  }catch(e){ alert('Camera error: '+e.message); }
};
document.getElementById('btnScanFromFile').onclick = ()=> document.getElementById('fileQR').click();
document.getElementById('fileQR').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{ const t=await decodeQRFromFile(f); onScanText(t); }catch(err){ alert('Gagal baca QR: '+err.message); }
});
async function decodeQRFromFile(file){
  const url=URL.createObjectURL(file), img=new Image();
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; });
  const c=document.createElement('canvas'),x=c.getContext('2d'); c.width=img.naturalWidth;c.height=img.naturalHeight; x.drawImage(img,0,0);
  const d=x.getImageData(0,0,c.width,c.height); URL.revokeObjectURL(url);
  const qr=jsQR(d.data,d.width,d.height); if(!qr) throw new Error('QR tidak terbaca'); return qr.data;
}
async function onScanText(text){
  document.getElementById('scanResult').textContent=text;
  const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const upd={}; let po=_scanPO;
  for(const l of lines){
    const [k,...rest]=l.split(':'); const v=rest.join(':').trim();
    if(/^ST$/i.test(k)) upd.current_process=v;
    if(/^STATUS$/i.test(k)) upd.status=v;
    if(/^NOTE$/i.test(k)) upd.note=v;
    if(/^PO$/i.test(k)) po=v;
  }
  if(!upd.current_process && lines.length===1 && lines[0].startsWith('ST:')) upd.current_process=lines[0].slice(3).trim();
  if(!po) return alert('PO tidak diketahui');
  try{
    await apiAction('updateOrder', {
      po_id:   po,
      updates: encodeURIComponent(JSON.stringify(upd)),
      user:    encodeURIComponent(JSON.stringify(CURRENT_USER))
    });
    await stopScan(); refreshDashboard();
  }catch(e){ alert(e.message); }
}

/* ====== CHARTS ====== */
let chMonthly=null, chCustomer=null;
async function loadCharts(){
  try{
    loading(true);
    const stat = await apiGet({action:'stock'});
    document.getElementById('statFinished').textContent = stat.finishedStock;
    document.getElementById('statReady').textContent    = stat.ready;
    document.getElementById('statShipped').textContent  = stat.shipped;
    const data = await apiGet({action:'charts'});
    renderBar('#chMonthly',  data.monthly.labels,  data.monthly.values,  v=>chMonthly=v);
    renderBar('#chCustomer', data.customer.labels, data.customer.values, v=>chCustomer=v);
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
}
document.getElementById('btnReloadCharts').onclick = loadCharts;

function renderBar(sel, labels, values, setRef){
  const ctx=document.querySelector(sel).getContext('2d');
  if(sel==='#chMonthly' && chMonthly){ chMonthly.destroy(); }
  if(sel==='#chCustomer'&& chCustomer){ chCustomer.destroy(); }
  const instChart = new Chart(ctx,{
    type:'bar',
    data:{ labels, datasets:[{ label:'数量', data:values }] },
    options:{ responsive:true, plugins:{legend:{display:false}} }
  });
  setRef(instChart);
}

window.addEventListener('load', ()=>{ window.lucide&&lucide.createIcons(); });

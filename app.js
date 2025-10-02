/* ========= CONFIG ========= */
// Ganti jika perlu; bisa juga diset via localStorage.GAS_URL
const GAS_URL = (localStorage.getItem('GAS_URL') || 'https://script.google.com/macros/s/AKfycbxQ1vV7lfEAoIPPq09K6a7yCJtSzEtlt6ncjv6K3QG3ydQOeTBdK0u5Hlu1Nme0EKbGnw/exec').trim();

/* ========= UTIL ========= */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const show = (el, on=true)=> el.classList[on?'remove':'add']('hidden');
const loading = on => show($('#loading'), on);

async function apiGet(params){
  const url = GAS_URL + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url, { method:'GET' });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const j = await res.json();
  if(!j.ok) throw new Error(j.error||'Server error');
  return j.data;
}
async function apiPost(body){
  const res = await fetch(GAS_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const j = await res.json();
  if(!j.ok) throw new Error(j.error||'Server error');
  return j.data;
}

/* ========= AUTH ========= */
let CURRENT_USER = null;

$('#btnLogin').onclick = async () => {
  try{
    loading(true);
    const u = $('#inUser').value.trim(), p = $('#inPass').value.trim();
    CURRENT_USER = await apiPost({ action:'login', username:u, password:p });
    afterLogin();
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
};

$('#btnLogout').onclick = () => location.reload();

$('#btnNewUser').onclick = async ()=>{
  try{
    loading(true);
    const payload = {
      username: $('#nuUser').value.trim(),
      password: $('#nuPass').value.trim(),
      full_name: $('#nuName').value.trim(),
      department: $('#nuDept').value,
      role: $('#nuRole').value
    };
    await apiPost({ action:'createUser', user:CURRENT_USER, payload });
    alert('ユーザー追加OK');
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
};

function afterLogin(){
  show($('#authView'), false);
  show($('#btnToDash'), true);
  show($('#btnToSales'), true);
  show($('#btnLogout'), true);
  $('#userInfo').textContent = `${CURRENT_USER.full_name}（${CURRENT_USER.department}）`;

  // default buka dashboard
  toPage('pageDash');
  refreshDashboard();
  loadMasters();     // penting: untuk dropdown sales
  loadSalesList();   // render tabel sales
}

/* ========= NAV ========= */
function toPage(id){
  ['pageDash','pageSales'].forEach(pid => show($('#'+pid), pid===id));
  ['btnToDash','btnToSales'].forEach(btn=>{
    const el = $('#'+btn);
    if(!el) return;
    btn.includes('Dash') ? el.onclick = ()=>{ toPage('pageDash'); refreshDashboard(); }
                         : el.onclick = ()=>{ toPage('pageSales'); loadSalesList(); };
  });
}

/* ========= DASHBOARD (Orders) ========= */
async function refreshDashboard(){
  try{
    loading(true);
    const rows = await apiGet({ action:'listOrders', q: $('#searchQ').value||'' });
    const tb = $('#tbOrders'); tb.innerHTML = '';
    for(const r of rows){
      const tr = document.createElement('tr');
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
        <td class="ops">
          <button class="btn s ghost" data-scan="${r.po_id}"><i data-lucide="scan"></i>スキャン</button>
        </td>`;
      tb.appendChild(tr);
    }
    lucide.createIcons();

    // bind scan buttons
    $$('#tbOrders [data-scan]').forEach(b=>{
      b.onclick = ()=> openScan(b.dataset.scan);
    });
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
}
$('#btnRefresh').onclick = refreshDashboard;
function fmt(d){ if(!d) return ''; const t = new Date(d); return isNaN(+t)?'':t.toISOString().slice(0,19).replace('T',' '); }

/* ========= MASTERS -> datalist Sales ========= */
let MASTERS = { customer:[], name:[], part:[], drw:[] };

async function loadMasters(){
  try{
    const data = await apiGet({ action:'masters' });
    // normalisasi
    const cs = new Set(), ns = new Set(), ps = new Set(), zs = new Set();
    for(const r of data){
      const t = String(r.type||'').trim();
      const name = String(r.name||'').trim();
      const z = String(r.zuban||'').trim();
      const code = String(r.code||'').trim();
      if(String(r.is_active).toLowerCase()!=='true') continue;

      if(t==='得意先' && (name||code)) cs.add(name||code);
      if(t==='品名'   && name) ns.add(name);
      if(t==='品番'   && (name||code)) ps.add(name||code);
      if(t==='図番'   && (name||z)) zs.add(name||z);
    }
    MASTERS.customer = [...cs]; MASTERS.name=[...ns]; MASTERS.part=[...ps]; MASTERS.drw=[...zs];

    fillList('dl_tokui', MASTERS.customer);
    fillList('dl_hinmei', MASTERS.name);
    fillList('dl_hinban', MASTERS.part);
    fillList('dl_zuban',  MASTERS.drw);
  }catch(e){ console.warn('Masters load failed:', e.message); }
}

function fillList(id, arr){
  const dl = $('#'+id); dl.innerHTML='';
  arr.sort().forEach(v=>{
    const o=document.createElement('option'); o.value=v; dl.appendChild(o);
  });
}

/* ========= SALES ========= */
$('#btnSalesSave').onclick = async ()=>{
  try{
    loading(true);
    const payload = {
      '受注日'  : $('#so_date').value || new Date().toISOString().slice(0,10),
      '得意先'  : $('#so_cust').value.trim(),
      '品名'    : $('#so_item').value.trim(),
      '品番'    : $('#so_part').value.trim(),
      '図番'    : $('#so_drw').value.trim(),
      '製番号'  : $('#so_sei').value.trim(),
      '数量'    : Number($('#so_qty').value||0),
      '希望納期': $('#so_req').value||'',
      '備考'    : $('#so_note').value.trim()
    };
    const r = await apiPost({ action:'createSalesOrder', user:CURRENT_USER, payload });
    alert('保存OK: '+r.so_id);
    loadSalesList();
  }catch(e){ alert(e.message); }
  finally{ loading(false); }
};

async function loadSalesList(){
  try{
    loading(true);
    const rows = await apiGet({ action:'listSales', q: $('#salesQ').value||'' });
    const tb = $('#tbSales'); tb.innerHTML='';
    for(const r of rows){
      const tr = document.createElement('tr');
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
$('#salesQ').onkeydown = e=>{ if(e.key==='Enter') loadSalesList(); };

/* ========= SCAN (html5-qrcode only) ========= */
let _h5 = null, _scanPO=null;

function openScan(po){
  _scanPO = po;
  $('#scanPO').textContent = po;
  $('#scanResult').textContent = '';
  $('#dlgScan').showModal();
}

async function stopScan(){
  try{
    if(_h5){
      await _h5.stop(); await _h5.clear();
    }
  }catch{}
  _h5 = null;
}

$('#btnScanClose').onclick = async()=>{ await stopScan(); $('#dlgScan').close(); };

$('#btnScanStart').onclick = async ()=>{
  try{
    if(!_h5) _h5 = new Html5Qrcode('scanHtml5', { verbose:false });
    await _h5.start(
      { facingMode:'environment' },
      { fps:10, qrbox:{ width:240, height:240 } },
      txt => onScanText(txt),
      _ => {}
    );
  }catch(e){
    alert('Camera error: '+e.message);
  }
};

$('#btnScanFromFile').onclick = ()=> $('#fileQR').click();
$('#fileQR').addEventListener('change', async e=>{
  const f = e.target.files[0]; if(!f) return;
  try{
    const txt = await decodeQRFromFile(f);
    onScanText(txt);
  }catch(err){ alert('Gagal baca QR: '+err.message); }
});

async function decodeQRFromFile(file){
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; });
  const cvs = document.createElement('canvas'), ctx=cvs.getContext('2d');
  cvs.width=img.naturalWidth; cvs.height=img.naturalHeight; ctx.drawImage(img,0,0);
  const d = ctx.getImageData(0,0,cvs.width,cvs.height);
  URL.revokeObjectURL(url);
  const qr = jsQR(d.data, d.width, d.height);
  if(!qr) throw new Error('QR tidak terbaca');
  return qr.data;
}

async function onScanText(text){
  $('#scanResult').textContent = text;
  // format yang didukung:
  // "ST:レーザ加工" atau multi-line:
  // ST:レーザ加工\nSTATUS:検査済\nNOTE:xxx\nPO:PO-123
  const lines = String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const upd = {}; let po=_scanPO;
  for(const l of lines){
    const [k,...rest] = l.split(':'); const v = rest.join(':').trim();
    if(/^ST$/i.test(k)) upd.current_process = v;
    if(/^STATUS$/i.test(k)) upd.status = v;
    if(/^NOTE$/i.test(k)) upd.note = v;
    if(/^PO$/i.test(k)) po = v;
  }
  if(!upd.current_process && lines.length===1 && lines[0].startsWith('ST:'))
    upd.current_process = lines[0].slice(3).trim();

  if(!po){ alert('PO tidak diketahui'); return; }

  try{
    await apiPost({ action:'updateOrder', po_id:po, updates:upd, user:CURRENT_USER });
    await stopScan();
    refreshDashboard();
  }catch(e){ alert(e.message); }
}

/* ========= BOOT ========= */
window.addEventListener('load', ()=>{
  // biar icon render
  if(window.lucide) lucide.createIcons();
});

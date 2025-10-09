/* =========================================================
 * app.js — Frontend
 * ========================================================= */
const API_BASE = "https://script.google.com/macros/s/AKfycbwU5weHTlKMx7cztUIs060C9nCrQlQHCiGj3qvOzDdRFNgrAc9FO6nhqkin42nEq3df/exec"; // <= GANTI
const API_KEY  = ""; // optional

// PROSES baku (sinkron dengan backend)
const PROCESSES = [
  'レザー加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング',
  '外枠塗装','組立（組立中）','組立（組立済）','外注','検査中','検査済'
];

// STATION alias => update fields
const STATION_RULES = {
  'レザー加工': (o)=> ({ current_process:'レザー加工', status:o.status||'生産開始' }),
  'レーサ加工': (o)=> ({ current_process:'レザー加工', status:o.status||'生産開始' }), // alias lama
  '曲げ工程':   (o)=> ({ current_process:'曲げ加工' }),
  '曲げ加工':   (o)=> ({ current_process:'曲げ加工' }),
  '外枠組立':   (o)=> ({ current_process:'外枠組立' }),
  'シャッター組立':(o)=> ({ current_process:'シャッター組立' }),
  'シャッター溶接':(o)=> ({ current_process:'シャッター溶接' }),
  'コーキング': (o)=> ({ current_process:'コーキング' }),
  '外枠塗装':   (o)=> ({ current_process:'外枠塗装' }),
  '組立工程':   (o)=> (o.current_process==='組立（組立中）' ? { current_process:'組立（組立済）' } : { current_process:'組立（組立中）' }),
  '検査工程':   (o)=> ({ current_process: (o.status==='検査済' ? '検査済' : '検査中') }), // alias lama
  '検査中':     (o)=> ({ current_process:'検査中' }),
  '検査済':     (o)=> ({ current_process:'検査済', status:'検査済' }),
  '出荷工程':   (o)=> (o.status==='出荷準備' ? { status:'出荷済', current_process:o.current_process||'検査済' } : { status:'出荷準備', current_process:'検査中' })
};

/* ===== API helpers (aman) ===== */
async function apiPost(action, body){
  const payload={action,...body}; if(API_KEY) payload.apiKey=API_KEY;
  const res=await fetch(API_BASE,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),cache:'no-store'});
  const txt=await res.text(); let j; try{ j=JSON.parse(txt); }catch{ throw new Error('Invalid response'); }
  if(!j.ok) throw new Error(j.error||'API error'); return j.data;
}
async function apiGet(params){ const url=API_BASE+'?'+new URLSearchParams(params).toString();
  const r=await fetch(url,{cache:'no-store'}); const txt=await r.text(); const j=JSON.parse(txt); if(!j.ok) throw new Error(j.error||'API error'); return j.data; }

/* ====== Scan/Manual dengan OK/NG ====== */
let SESSION=null, CURRENT_PO=null;
async function startScanFor(po){ CURRENT_PO=po; const data=await apiGet({action:'ticket',po_id:po});
  const token = prompt(`Scan/ketik kode stasiun (mis. ST:レザー加工, ST:検査中)\nPO: ${po}\n(Contoh ketik manual: ST:検査中)`);
  if(!token) return;
  const t = String(token).trim().replace(/^ST:/i,'');
  const rule = STATION_RULES[t] || ((_o)=>({current_process:t}));
  const updates = rule(data)||{};
  // wajib input OK/NG
  const ok = Number(prompt('OK品 数量 (kosong=0)')||0);
  const ng = Number(prompt('不良品 数量 (kosong=0)')||0);
  const note = prompt('メモ/備考 (opsional)')||'';
  await apiPost('setProcess',{user:SESSION, po_id:po, process:t, options:{ status:updates.status, ok_qty:ok, ng_qty:ng, note }});
  alert('更新しました'); await refreshAll(true);
}

/* ====== Charts (tambahan Defects) ====== */
async function renderDefectsChart(){
  const obj = await apiGet({action:'defects'});
  const labels = Object.keys(obj||{}); const vals = Object.values(obj||{});
  const el = document.getElementById('chDefects'); if(!el) return;
  new Chart(el,{type:'bar', data:{labels, datasets:[{label:'不良品', data:vals}]},
    options:{responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true}}}});
}

/* ====== Boot (ringkas): ambil sebagian dari versimu ====== */
window.addEventListener('DOMContentLoaded', async ()=>{
  SESSION = JSON.parse(localStorage.getItem('erp_session')||'null');
  if(!SESSION){
    // login minimal
    const u=prompt('ユーザー名'); const p=prompt('パスワード'); try{ SESSION=await apiPost('login',{username:u,password:p}); localStorage.setItem('erp_session',JSON.stringify(SESSION)); }catch(e){ alert(e.message||e); return; }
  }
  await refreshAll();
  // tombol scan demo
  const btns=document.querySelectorAll('[data-scan]');
  btns.forEach(b=> b.addEventListener('click',()=> startScanFor(b.dataset.scan)));
  // defects chart
  try{ await renderDefectsChart(); }catch(e){ console.warn(e); }
});

/* ====== Functions kamu lain (render list, dsb.) tetap bisa pakai versi sebelumnya ====== */
async function refreshAll(keep=false){
  try{
    const s=await apiGet({action:'stock'});
    const elS=x=>document.getElementById(x)&& (document.getElementById(x).textContent=s[x]);
    elS('statFinished'); elS('statReady'); elS('statShipped');
    // TODO: panggil renderOrders(), renderInventory(), dsb (pakai versi kamu yang lama; struktur tetap)
  }catch(e){ console.warn(e); }
}

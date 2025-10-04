// ===== Config =====
const API_BASE = "https://script.google.com/macros/s/AKfycbwnU2BvQ6poO4EmMut3g5Zuu_cuojNbTmM8oRSCyNJDwm_38VgS7BhsFLKU0eoUt-BAKw/exec"; // Ganti dgn URL Web App Apps Script

// ===== API Helpers =====
async function apiPost(action, payload = {}) {
  const r = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ action, ...payload })
  });
  const j = await r.json(); if(!j.ok) throw new Error(j.error||'API');
  return j.data;
}
async function apiGet(params = {}) {
  const url = new URL(API_BASE);
  Object.entries(params).forEach(([k,v])=> url.searchParams.set(k,v));
  const r = await fetch(url, { cache:"no-store" });
  const j = await r.json(); if(!j.ok) throw new Error(j.error||'API');
  return j.data;
}

// ===== UI Controller =====
const UI = {
  init(){
    // tabs
    document.querySelectorAll(".nav-right .btn.ghost[data-tab]").forEach(b=>{
      b.addEventListener("click", ()=> UI.switchTab(b.dataset.tab));
    });
    UI.switchTab("orders");

    // search inputs
    const qMap = { orders:"qOrders", inventory:"qInventory", finished:"qFinished" };
    Object.entries(qMap).forEach(([tab,id])=>{
      const el=document.getElementById(id); if(el) el.addEventListener("input", ()=> UI.renderTab(tab));
    });

    // health
    UI.pingHealth();
    setInterval(UI.pingHealth, 15000);
  },

  async pingHealth(){
    try{
      await apiGet({action:"summary"});
      const el=document.getElementById("healthStatus");
      if(el){ el.textContent="オンライン"; el.style.color="green"; }
    }catch{
      const el=document.getElementById("healthStatus");
      if(el){ el.textContent="接続不安定"; el.style.color="red"; }
    }
  },

  currentTab:"orders",
  switchTab(tab){
    UI.currentTab=tab;
    document.querySelectorAll(".tab-panel").forEach(p=> p.classList.add("hidden"));
    document.getElementById(`tab-${tab}`).classList.remove("hidden");
    UI.renderTab(tab);
  },

  async renderTab(tab){
    if(tab==="orders"){
      const q = document.getElementById("qOrders")?.value.trim()||"";
      const rows = await apiGet({action:"listOrders", q});
      document.getElementById("tbOrders").innerHTML = rows.map(UI.rowOrder).join("");
    }
    if(tab==="inventory"){
      const q = document.getElementById("qInventory")?.value.trim()||"";
      const rows = await apiGet({action:"listInventory", q});
      document.getElementById("tbInventory").innerHTML = rows.map(UI.rowStockLike).join("");
    }
    if(tab==="finished"){
      const q = document.getElementById("qFinished")?.value.trim()||"";
      const rows = await apiGet({action:"listFinished", q});
      document.getElementById("tbFinished").innerHTML = rows.map(UI.rowStockLike).join("");
    }
    if(tab==="plans"){
      const d = await apiGet({action:"summary"});
      document.getElementById("plansTable").innerHTML = `<div class="muted">計画件数のサマリ：WIP ${d.wipCount}、完成在庫 ${d.finishedStock}</div>`;
    }
    if(tab==="shipments"){
      const d = await apiGet({action:"todayShip"});
      document.getElementById("shipmentsTable").innerHTML = d.length ? `<ul>${d.map(r=>`<li>${r.po_id} — ${fmtD(r.scheduled_date)} / ${r.qty||0}</li>`).join("")}</ul>` : '<div class="muted">予定なし</div>';
    }
  },

  // ===== Rows Renderer =====
  badgeStatus(name){
    const map = { '生産開始':'badge-st-open','検査保留':'badge-st-hold','検査済':'badge-st-progress','出荷準備':'badge-st-ready','出荷済':'badge-st-done','不良品（要リペア）':'badge-st-ng' };
    const cls = map[name] || 'badge-st-open';
    return `<span class="badge ${cls}"><span class="dot"></span><span>${name||'-'}</span></span>`;
  },
  badgeProcess(name){
    const cls = { 'レーザ加工':'badge-prc-A','曲げ加工':'badge-prc-B','外枠組立':'badge-prc-C','シャッター組立':'badge-prc-D','シャッター溶接':'badge-prc-E','コーキング':'badge-prc-C','外枠塗装':'badge-prc-D','組立（組立中）':'badge-prc-B','組立（組立済）':'badge-prc-A','外注':'badge-prc-E','検査工程':'badge-prc-B' }[name] || 'badge-prc-E';
    return `<span class="badge ${cls}"><span class="dot"></span><span>${name||'-'}</span></span>`;
  },
  rowOrder(r){
    const left = `
      <div class="row-main">
        <a href="javascript:void(0)" class="link" onclick="UI.openTicket('${r.po_id}')"><b>${r.po_id}</b></a>
        <div class="row-sub">
          <div class="kv"><span class="muted">得意先:</span> <b>${r['得意先']||'-'}</b></div>
          ${r['製番号']?`<div class="kv"><span class="muted">製番号:</span> <b>${r['製番号']}</b></div>`:''}
          ${(r['品番']||r['図番'])?`<div class="kv"><span class="muted">品番/図番:</span> <b>${r['品番']||''}/${r['図番']||''}</b></div>`:''}
        </div>
      </div>`;
    const actions = `
      <div class="actions">
        <button class="btn ghost s" onclick="UI.openTicket('${r.po_id}')"><i class="fa-regular fa-file-lines"></i> 票</button>
        <button class="btn ghost s" onclick="UI.openHistory('${r.po_id}')"><i class="fa-solid fa-clock-rotate-left"></i> 履歴</button>
        <button class="btn ghost s" onclick="UI.openShipByPO('${r.po_id}')"><i class="fa-solid fa-truck"></i> 出荷</button>
        <button class="btn ghost s" onclick="UI.scanStartFor('${r.po_id}')"><i class="fa-solid fa-qrcode"></i> 更新</button>
      </div>`;
    return `<tr>
      <td>${left}</td>
      <td>${r['品名']||''}</td>
      <td>${r['品番']||''}</td>
      <td>${r['図番']||''}</td>
      <td class="col-status">${UI.badgeStatus(r.status||'')}</td>
      <td class="col-proc">${UI.badgeProcess(r.current_process||'')}</td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s muted">${r.updated_by||''}</td>
      <td class="s">${actions}</td>
    </tr>`;
  },
  rowStockLike(r){
    const left = `
      <div class="row-main">
        <a href="javascript:void(0)" class="link" onclick="UI.openTicket('${r.po_id}')"><b>${r.po_id}</b></a>
        <div class="row-sub">
          <div class="kv"><span class="muted">得意先:</span> <b>${r['得意先']||'-'}</b></div>
          ${(r['品名']||'')?`<div class="kv"><span class="muted">品名:</span> <b>${r['品名']}</b></div>`:''}
        </div>
      </div>`;
    const actions = `
      <div class="actions">
        <button class="btn ghost s" onclick="UI.openTicket('${r.po_id}')"><i class="fa-regular fa-file-lines"></i> 票</button>
        <button class="btn ghost s" onclick="UI.openHistory('${r.po_id}')"><i class="fa-solid fa-clock-rotate-left"></i> 履歴</button>
      </div>`;
    return `<tr>
      <td>${left}</td>
      <td>${r['品名']||''}</td>
      <td>${UI.badgeProcess(r.current_process||'')}</td>
      <td>${UI.badgeStatus(r.status||'')}</td>
      <td class="s muted">${fmtDT(r.updated_at)}</td>
      <td class="s">${actions}</td>
    </tr>`;
  },

  // ===== Import =====
  importFile(target){
    const id = "import" + target.charAt(0).toUpperCase()+target.slice(1);
    const input = document.getElementById(id);
    input.click();
    input.onchange=()=>{ const f=input.files[0]; if(!f) return; UI.parseAndUpload(f,target); };
  },
  async parseAndUpload(file, target){
    const ext = file.name.split(".").pop().toLowerCase();
    let rows = [];
    if(ext==="csv"){
      await new Promise((res,rej)=> Papa.parse(file,{header:true,complete:(r)=>{rows=r.data;res();},error:rej}));
    }else{
      const wb = XLSX.read(await file.arrayBuffer(), {type:"array"});
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:""});
    }
    await UI.batchUpload(rows, target);
    alert("Import selesai: "+target);
    UI.renderTab(UI.currentTab);
  },
  async batchUpload(rows, target){
    const action = { orders:"bulkUpsertOrders", plans:"bulkUpsertPlans", shipments:"bulkUpsertShipments" }[target];
    const size=50;
    for(let i=0;i<rows.length;i+=size){
      const chunk = rows.slice(i, i+size);
      await apiPost(action, { payload:{rows:chunk} });
      await new Promise(r=> setTimeout(r,300)); // backoff
    }
  },

  // ===== Settings =====
  openSetting(type){
    const dlg=document.getElementById("dlgSetting");
    const body=document.getElementById("settingBody");
    if(type==='qr'){
      body.innerHTML = `
        <h3>工程QR</h3>
        <p class="muted s">フォーマット: <code>ST:工程名</code></p>
        <div id="qrWrap" class="row" style="gap:.6rem;flex-wrap:wrap"></div>`;
      dlg.showModal();
      UI.renderQRStations();
      return;
    }
    if(type==='user'){
      body.innerHTML = `
        <h3>ユーザー追加</h3>
        <div class="row" style="gap:.4rem;flex-wrap:wrap">
          <input id="u_user" placeholder="ユーザー名" />
          <input id="u_pass" type="password" placeholder="パスワード" />
          <input id="u_name" placeholder="氏名" />
          <select id="u_dept"><option>営業</option><option>生産技術</option><option>生産管理部</option><option>製造部</option><option>検査部</option></select>
          <select id="u_role"><option>member</option><option>manager</option><option>admin</option></select>
          <button class="btn" onclick="UI.addUser()">追加</button>
        </div>`;
      dlg.showModal(); return;
    }
    if(type==='pw'){
      body.innerHTML = `
        <h3>パス変更</h3>
        <div class="row" style="gap:.4rem;flex-wrap:wrap">
          <input id="pw_old" type="password" placeholder="旧パスワード" />
          <input id="pw_new" type="password" placeholder="新パスワード" />
          <button class="btn" onclick="UI.changePw()">変更</button>
        </div>`;
      dlg.showModal(); return;
    }
  },
  renderQRStations(){
    const stations = ['レーザ加工','曲げ加工','外枠組立','シャッター組立','シャッター溶接','コーキング','外枠塗装','組立（組立中）','組立（組立済）','外注','検査工程','出荷工程'];
    const wrap=document.getElementById("qrWrap");
    wrap.innerHTML="";
    stations.forEach(st=>{
      const box=document.createElement("div");
      box.className="card";
      box.innerHTML=`
        <div class="row-between"><b>${st}</b><a class="btn ghost s" target="_blank">PNG</a></div>
        <div class="qr-holder" style="background:#fff;border:1px solid #e3e6ef;border-radius:8px;display:inline-block"></div>
        <div class="s muted">内容: ST:${st}</div>`;
      wrap.appendChild(box);
      const holder=box.querySelector('.qr-holder');
      new QRCode(holder,{ text:'ST:'+st, width:180, height:180, correctLevel:QRCode.CorrectLevel.M });
      setTimeout(()=>{
        const cvs=holder.querySelector('canvas'); const link=box.querySelector('a'); if(!link) return;
        let url=''; if(cvs&&cvs.toDataURL) url=cvs.toDataURL('image/png');
        if(url){ link.href=url; link.download=`ST-${st}.png`; } else { link.remove(); }
      }, 50);
    });
  },
  async addUser(){
    const payload={
      user:{ username:"admin", role:"admin", department:"生産技術" }, // minimal actor; sesuaikan jika sudah ada sesi login
      payload:{
        username:document.getElementById("u_user").value.trim(),
        password:document.getElementById("u_pass").value.trim(),
        full_name:document.getElementById("u_name").value.trim(),
        department:document.getElementById("u_dept").value,
        role:document.getElementById("u_role").value
      }
    };
    if(!payload.payload.username||!payload.payload.password||!payload.payload.full_name) return alert("必須項目");
    try{ await apiPost("createUser", payload); alert("ユーザー追加OK"); }catch(e){ alert(e.message||e); }
  },
  async changePw(){
    const oldPass=document.getElementById("pw_old").value;
    const newPass=document.getElementById("pw_new").value;
    try{
      await apiPost("changePassword",{ user:{username:"admin",role:"admin",department:"生産技術"}, oldPass, newPass });
      alert("変更しました");
    }catch(e){ alert(e.message||e); }
  },

  // ===== Docs =====
  async openTicket(po_id){
    const o = await apiGet({action:"ticket", po_id});
    const html = `
      <h3>生産現品票</h3>
      <table>
        <tr><th>管理No</th><td>${o['管理No']||'-'}</td><th>通知書番号</th><td>${o['通知書番号']||'-'}</td></tr>
        <tr><th>得意先</th><td>${o['得意先']||''}</td><th>得意先品番</th><td>${o['得意先品番']||''}</td></tr>
        <tr><th>製番号</th><td>${o['製番号']||''}</td><th>投入日</th><td>${fmtD(o['created_at'])||'-'}</td></tr>
        <tr><th>品名</th><td>${o['品名']||''}</td><th>品番/図番</th><td>${(o['品番']||'')+' / '+(o['図番']||'')}</td></tr>
        <tr><th>工程</th><td colspan="3">${o.current_process||''}</td></tr>
        <tr><th>状態</th><td>${o.status||''}</td><th>更新</th><td>${fmtDT(o.updated_at)} / ${o.updated_by||''}</td></tr>
      </table>`;
    const dlg=document.getElementById("dlgDoc"); document.getElementById("docBody").innerHTML=html; dlg.showModal();
  },
  async openHistory(po_id){
    const logs = await apiGet({action:"history", po_id});
    const html = logs.length ? `<table class="table s"><thead><tr><th>時刻</th><th>旧状態</th><th>新状態</th><th>旧工程</th><th>新工程</th><th>更新者</th><th>備考</th></tr></thead><tbody>${
      logs.map(l=>`<tr><td>${fmtDT(l.timestamp)}</td><td>${l.prev_status||''}</td><td>${l.new_status||''}</td><td>${l.prev_process||''}</td><td>${l.new_process||''}</td><td>${l.updated_by||''}</td><td>${l.note||''}</td></tr>`).join('')
    }</tbody></table>` : '<div class="muted">履歴なし</div>';
    const dlg=document.getElementById("dlgDoc"); document.getElementById("docBody").innerHTML=html; dlg.showModal();
  },
  async openShipByPO(po_id){
    try{
      const d=await apiGet({action:"shipByPo", po_id});
      const dt=d.shipment.scheduled_date? new Date(d.shipment.scheduled_date):null;
      const html = `
        <h3>出荷確認書</h3>
        <table>
          <tr><th>得意先</th><td>${d.order['得意先']||''}</td><th>出荷日</th><td>${dt?fmtD(dt):'-'}</td></tr>
          <tr><th>品名</th><td>${d.order['品名']||''}</td><th>品番/図番</th><td>${(d.order['品番']||'')+' / '+(d.order['図番']||'')}</td></tr>
          <tr><th>注番</th><td>${d.order.po_id||d.shipment.po_id}</td><th>数量</th><td>${d.shipment.qty||0}</td></tr>
          <tr><th>出荷ステータス</th><td>${d.shipment.status||''}</td><th>備考</th><td></td></tr>
        </table>`;
      const dlg=document.getElementById("dlgDoc"); document.getElementById("docBody").innerHTML=html; dlg.showModal();
    }catch(e){ alert(e.message||e); }
  },

  // ===== Scan (quick) =====
  scanStartFor(po_id){
    alert("Scan cepat: arahkan kamera ke QR 'ST:工程名' lalu jalankan update manual lewat menu Setting/QR jika perlu.\n(Implementasi kamera penuh bisa disisipkan bila dibutuhkan.)");
  }
};

// ===== Utils =====
const fmtDT = (s)=> s? new Date(s).toLocaleString(): '';
const fmtD  = (s)=> s? new Date(s).toLocaleDateString(): '';

// ===== Boot =====
window.addEventListener("DOMContentLoaded", ()=>{
  UI.init();
});

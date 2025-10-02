:root{
  --bg:#f7f9fc; --card:#ffffff; --border:#e0e6f1; --ink:#222; --muted:#6b7a99;
  --primary:#2563eb; --primary-hover:#1d4ed8; --chip:#eff6ff;
  --radius:14px; --shadow:0 2px 6px rgba(0,0,0,.05);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial}
.hidden{display:none!important}.muted{color:var(--muted)}.s{font-size:12px}
.row{display:flex;align-items:center}.row-between{display:flex;align-items:center;justify-content:space-between}
.row-end{display:flex;justify-content:flex-end;gap:.5rem}.row.gap{gap:.5rem}
.container{padding:.8rem;max-width:1180px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;margin-bottom:1rem;box-shadow:var(--shadow)}
.card-tight{max-width:520px;margin:2rem auto}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
.grid.m1{grid-template-columns:1fr}
.grid-3{display:grid;grid-template-columns:1fr;gap:1rem}
@media(min-width:820px){.grid-3{grid-template-columns:1fr 1fr 1fr}}
.tile{background:#fff;border:1px solid var(--border);border-radius:12px;padding:.8rem;box-shadow:var(--shadow)}
.stat-num{font-size:28px;font-weight:700}

.nav{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;border-bottom:1px solid var(--border);background:#fff;box-shadow:var(--shadow)}
.logo{height:28px}.brand{margin-left:.5rem;font-weight:700;font-size:15px}
.nav-right{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}

input,select,textarea{width:100%;padding:.75rem;border-radius:12px;border:1px solid var(--border);background:#fff;color:var(--ink)}
.input{width:210px}
.btn{padding:.55rem .9rem;border-radius:12px;border:1px solid transparent;background:var(--primary);color:#fff;cursor:pointer;display:flex;align-items:center;gap:.3rem;font-size:13px}
.btn:hover{background:var(--primary-hover)}
.btn.ghost{background:#fff;border:1px solid var(--border);color:var(--ink)}.btn.ghost:hover{background:#f3f6fb}
.btn.primary{background:var(--primary);color:#fff}.btn.full{width:100%}.btn.s{padding:.35rem .55rem;font-size:11px;border-radius:10px}

.table-wrap{overflow:auto;max-height:60vh;border:1px solid var(--border);border-radius:12px;background:#fff}
.table{width:100%;border-collapse:collapse}
.table th,.table td{padding:.6rem;border-bottom:1px solid #edf1f7;vertical-align:middle}

.paper{width:min(860px,96vw);border:0;padding:0;background:#fff;color:#000;border-radius:10px;box-shadow:var(--shadow)}
.paper .body{padding:16px}
.loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.6);backdrop-filter:saturate(1.2) blur(2px)}
.spinner{width:36px;height:36px;border:3px solid #dbe4ff;border-top-color:#2563eb;border-radius:50%;animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}

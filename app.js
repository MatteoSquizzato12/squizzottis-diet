const FV="Frutta e verdura", CP="Carne e pesce", SA="Salumi", LU="Latticini e uova", PC="Pane, pasta e cereali", DI="Dispensa";
const CATS=[FV,CP,SA,LU,PC,DI];
const OLIO="Olio extravergine d'oliva", UOVA="Uova bio";
const PEZZI={[UOVA]:{g:60,u:["uovo","uova"]}};
const PERSONE=["matteo","anna"];
const PASTI=[["colazione","Colazione"],["spuntino","Spuntino"],["pranzo","Pranzo"],["merenda","Merenda"],["cena","Cena"]];
/* Le diete arrivano da Supabase (tabella "diete"): nel codice pubblico non ci sono dati personali. */
let DIETE={};

/* ===================== APP ===================== */
const GIORNI=["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
const G3=["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const MESI=["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
const slug=s=>s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rnd=a=>a[Math.floor(Math.random()*a.length)];
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const clone=x=>JSON.parse(JSON.stringify(x));

function normalizeDiet(D){
  D.ricette=D.ricette||{};
  for(const pid in D.pasti){
    const P=D.pasti[pid]; P.id=pid;
    for(const V of P.varianti) for(const pt of V.portate){
      pt.byId={};
      for(const op of pt.opz){ let id=op.id||slug(op.n)||"x"; while(pt.byId[id]&&pt.byId[id]!==op)id+="-2"; op.id=id; pt.byId[id]=op; }
    }
  }
}

function mondayOf(dt){const d=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate());d.setDate(d.getDate()-((d.getDay()+6)%7));return d;}
function iso(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function parseISO(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function defaultWeek(){const t=new Date();let m=mondayOf(t);if((t.getDay()+6)%7>=3)m=addDays(m,7);return iso(m);}
function dayDate(i){return addDays(parseISO(S.week),i);}
function weekLabel(){const a=dayDate(0),b=dayDate(6);return a.getMonth()===b.getMonth()?`${a.getDate()} – ${b.getDate()} ${MESI[b.getMonth()]} ${b.getFullYear()}`:`${a.getDate()} ${MESI[a.getMonth()].slice(0,3)} – ${b.getDate()} ${MESI[b.getMonth()].slice(0,3)} ${b.getFullYear()}`;}
function todayIdx(){const t=iso(new Date());for(let i=0;i<7;i++)if(iso(dayDate(i))===t)return i;return -1;}

function pref(k,d){try{return localStorage.getItem("menu:"+k)||d;}catch(e){return d;}}
function setPref(k,v){try{localStorage.setItem("menu:"+k,v);}catch(e){}}

const S={week:defaultWeek(),tab:"piano",who:pref("who","both"),view:pref("view",innerWidth<760?"day":"week"),day:0,confirmClear:0,hideGot:pref("hideGot","0")==="1"};
S.day=Math.max(0,todayIdx());
const sb=supabase.createClient(CONFIG.supabaseUrl,CONFIG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
let user=null,chan=null,sync="conn",ready=false,retryT=null;
let plan={piano:{},spesa:{}};
const queue=[];let busy=false;
let sheetCtx=null;

const persons=()=>S.who==="both"?PERSONE:[S.who];
const mealOf=(p,d,pid)=>{const m=plan.piano?.[p]?.["d"+d]?.[pid];return m&&m.v?m:null;};
const picks=m=>(m&&m.s)||{};
const variantOf=(p,pid,m)=>m?DIETE[p].pasti[pid].varianti.find(v=>v.id===m.v)||null:null;
const isLib=(V,s)=>V.portate.some(pt=>pt.byId[s[pt.id]]?.lib);
const qtyLabel=op=>op.lib?"":op.g?(op.t?op.t+" · ":"")+op.g+" g":(op.t||"");
const fcls=(c,max)=>c>max?"over":c===max?"done":"todo";

function deepMerge(t,s){for(const k in s){const v=s[k];if(v===null)delete t[k];else if(typeof v==="object"&&!Array.isArray(v)){if(typeof t[k]!=="object"||t[k]===null)t[k]={};deepMerge(t[k],v);}else t[k]=v;}return t;}
const patchAt=(p,d,pid,val)=>({piano:{[p]:{["d"+d]:{[pid]:val}}}});

/* ---------- salvataggio ---------- */
/* Ogni modifica è una "patch" (null = cancella) che va in coda, viene salvata nel telefono e inviata a Supabase,
   che la fonde nel documento della settimana (funzione aggiorna_settimana). Senza rete la coda resta e riparte da sola. */
const LS={get(k){try{const r=localStorage.getItem("menu:"+k);return r?JSON.parse(r):null;}catch(e){return null;}},
  set(k,v){try{localStorage.setItem("menu:"+k,JSON.stringify(v));}catch(e){}},
  clear(){try{for(const k of Object.keys(localStorage))if(k.startsWith("menu:")&&!/^menu:(who|view|hideGot)$/.test(k))localStorage.removeItem(k);}catch(e){}}};
const emptyPlan=()=>({piano:{},spesa:{}});
function withQueue(week,dati){
  const d=clone(dati||{}); d.piano=d.piano||{}; d.spesa=d.spesa||{};
  for(const it of queue) if(it.week===week) deepMerge(d,clone(it.patch));
  return d;
}
function write(patch){
  deepMerge(plan,clone(patch));
  plan.piano=plan.piano||{}; plan.spesa=plan.spesa||{};
  queue.push({week:S.week,patch}); LS.set("queue",queue); LS.set("plan:"+S.week,plan);
  renderAll(); pump();
}
const netErr=e=>!navigator.onLine||!e||!e.code||/fetch|network|timeout/i.test(e.message||"");
async function pump(){
  if(busy||!user)return; busy=true; clearTimeout(retryT);
  while(queue.length){
    const it=queue[0];
    const {data,error}=await sb.rpc("aggiorna_settimana",{p_settimana:it.week,p_patch:it.patch});
    if(error&&netErr(error)){ sync="local"; busy=false; renderAll(); retryT=setTimeout(pump,15000); return; }
    queue.shift(); LS.set("queue",queue);
    if(error){ toast("Modifica non salvata, riprova."); if(it.week===S.week) fetchWeek(it.week); continue; }
    if(it.week===S.week) applyRemote(it.week,data);
  }
  busy=false;
}
function applyRemote(week,dati){
  if(week!==S.week)return;
  LS.set("plan:"+week,dati||emptyPlan());
  plan=withQueue(week,dati); if(!queue.length) sync="cloud"; renderAll();
}
async function fetchWeek(week){
  const {data,error}=await sb.from("settimane").select("dati").eq("settimana",week).maybeSingle();
  if(week!==S.week)return;
  if(error){ sync="local"; renderAll(); return; }
  applyRemote(week,data?data.dati:emptyPlan());
}
function subscribe(){
  plan=withQueue(S.week,LS.get("plan:"+S.week)||emptyPlan());
  if(sync!=="local") sync="conn";
  renderAll(); fetchWeek(S.week);
}

/* ---------- logica piano ---------- */
function usage(p,pid,vid,pt){const u={};for(let d=0;d<7;d++){const m=mealOf(p,d,pid);if(!m||m.v!==vid)continue;const op=pt.byId[picks(m)[pt.id]];if(op&&op.f)u[op.f]=(u[op.f]||0)+1;}return u;}
function variantCounts(p,pid){const u={};for(let d=0;d<7;d++){const m=mealOf(p,d,pid);if(m)u[m.v]=(u[m.v]||0)+1;}return u;}
function mealSummary(p,d,pid){
  const m=mealOf(p,d,pid); if(!m)return{state:"empty"};
  const P=DIETE[p].pasti[pid], V=variantOf(p,pid,m); if(!V)return{state:"empty"};
  const s=picks(m), lines=[]; let missing=0, warn=false;
  const variant=P.varianti.length>1?V.nome:null;
  if(isLib(V,s))return{state:"libero",lines:["Pasto libero"],variant};
  for(const pt of V.portate){const op=pt.byId[s[pt.id]];if(!op){if(!pt.opt)missing++;continue;}if(op.w)warn=true;if(!pt.mini&&!(pt.opz.length===1&&pt.id==="olio"))lines.push(op.n+(op.g?" "+op.g+" g":""));}
  return{state:missing?"partial":"full",lines,variant,missing,warn};
}
function pickGroupOption(pt,u,avoidLib,preferGroup){
  let opts=pt.opz.filter(x=>!x.w&&!(avoidLib&&x.lib));
  if(pt.freq){
    let g=preferGroup;
    if(!g){const free=Object.keys(pt.freq).filter(k=>(u[k]||0)<pt.freq[k].max&&!(avoidLib&&k==="libero"));if(free.length)g=rnd(free);}
    if(g){const inG=opts.filter(x=>x.f===g);if(inG.length)opts=inG;}
  }
  return rnd(opts.length?opts:pt.opz).id;
}
function autoFill(){
  const patch={piano:{}}; let n=0;
  for(const p of persons()) for(const [pid] of PASTI){
    const P=DIETE[p].pasti[pid]; if(!P)continue;
    const empty=[];for(let d=0;d<7;d++)if(!mealOf(p,d,pid))empty.push(d);
    if(!empty.length)continue;
    const assign={};
    if(P.varianti.length===1)empty.forEach(d=>assign[d]=P.varianti[0].id);
    else{
      const used=variantCounts(p,pid),pool=[];
      P.varianti.forEach(v=>{if(v.max)for(let i=0;i<v.max-(used[v.id]||0);i++)pool.push(v.id);});
      shuffle(pool); const free=P.varianti.filter(v=>!v.max);
      empty.forEach(d=>assign[d]=pool.length?pool.pop():rnd(free.length?free:P.varianti).id);
    }
    const byV={};empty.forEach(d=>(byV[assign[d]]=byV[assign[d]]||[]).push(d));
    for(const vid in byV){
      const V=P.varianti.find(v=>v.id===vid), days=byV[vid], sel={};
      days.forEach(d=>sel[d]={});
      for(const pt of V.portate){
        if(pt.opt)continue;
        if(pt.freq){
          const u=usage(p,pid,vid,pt),pool=[];
          for(const g in pt.freq)for(let i=0;i<pt.freq[g].max-(u[g]||0);i++)pool.push(g);
          shuffle(pool);
          const order=[...days];
          const li=pool.indexOf("libero");
          if(li>=0&&order.includes(5)){pool.splice(li,1);sel[5][pt.id]=pickGroupOption(pt,{},false,"libero");order.splice(order.indexOf(5),1);}
          order.forEach(d=>{const g=pool.length?pool.pop():null;sel[d][pt.id]=g?pickGroupOption(pt,{},false,g):pickGroupOption(pt,{},true);});
        } else days.forEach(d=>sel[d][pt.id]=pickGroupOption(pt,{},true));
      }
      days.forEach(d=>{
        let s=sel[d];
        if(isLib(V,s)){const k=V.portate.find(pt=>pt.byId[s[pt.id]]?.lib).id;s={[k]:s[k]};}
        deepMerge(patch,patchAt(p,d,pid,{v:vid,s}));n++;
      });
    }
  }
  if(!n){toast("La settimana è già tutta compilata.");return;}
  write(patch); toast(`Compilati ${n} pasti. Toccane uno per cambiarlo.`);
}
function clearWeek(){
  const patch={piano:{}};for(const p of persons())patch.piano[p]=null;
  if(S.who==="both")patch.spesa=null;
  write(patch); toast("Settimana svuotata.");
}

/* ---------- spesa ---------- */
function shopping(){
  const items={};
  const add=(name,g,cat,p)=>{const k=slug(name);const it=items[k]||(items[k]={k,name,cat,g:0,qb:0,per:{matteo:0,anna:0}});if(g){it.g+=g;it.per[p]+=g;}else it.qb++;};
  for(const p of PERSONE)for(let d=0;d<7;d++)for(const [pid] of PASTI){
    const m=mealOf(p,d,pid); if(!m)continue; const V=variantOf(p,pid,m); if(!V)continue; const s=picks(m);
    if(isLib(V,s))continue;
    for(const pt of V.portate){
      if(pt.noShop)continue; const op=pt.byId[s[pt.id]]; if(!op)continue;
      const r=DIETE[p].ricette[op.n];
      if(r)r.forEach(([n,g,c])=>add(n,g,c,p)); else add(op.s||op.n,op.g,op.c||pt.c,p);
    }
  }
  return Object.values(items).filter(it=>it.g>0||it.qb>0);
}
function fmtG(g){g=Math.round(g);return g>=1000?(g/1000).toFixed(g%1000===0?0:2).replace(/0$/,"").replace(".",",")+" kg":g+" g";}
function qtyItem(it){
  const parts=[];
  if(it.g){const pz=PEZZI[it.name];if(pz){const n=Math.ceil(it.g/pz.g);parts.push(`${n} ${n===1?pz.u[0]:pz.u[1]} · ${fmtG(it.g)}`);}else parts.push(fmtG(it.g));}
  if(it.qb)parts.push(it.g?"+ a piacere":`a piacere · per ${it.qb} ${it.qb===1?"pasto":"pasti"}`);
  return parts.join(" ");
}

/* ---------- render ---------- */
const $=id=>document.getElementById(id);
function renderAll(){
  $("weeklabel").textContent=weekLabel();
  const st=$("status");st.className="status "+sync;st.hidden=sync!=="local";
  st.lastElementChild.textContent=queue.length?"Senza rete: le modifiche partono appena torna la connessione":"Senza rete: stai vedendo l'ultima copia salvata";
  if(!ready){$("tabs").innerHTML="";$("main").innerHTML=`<div class="empty" style="margin-top:16px">${loadMsg}</div>`;return;}
  const nShop=shopping().filter(it=>!plan.spesa[it.k]).length;
  $("tabs").innerHTML=[["piano","Piano"],["spesa","Lista della spesa",nShop||""],["controllo","Controllo"]].map(([id,l,c])=>`<button class="tab" role="tab" data-act="tab" data-tab="${id}" aria-selected="${S.tab===id}">${l}${c?`<span class="count">${c}</span>`:""}</button>`).join("");
  $("main").innerHTML=S.tab==="piano"?renderPiano():S.tab==="spesa"?renderSpesa():renderControllo();
  if(sheetCtx)renderSheet();
}
function whoSeg(){
  return `<div class="seg" role="group" aria-label="Persona">${[["both","Entrambi"],["matteo","Matteo"],["anna","Anna"]].map(([k,l])=>`<button data-act="who" data-who="${k}" aria-pressed="${S.who===k}" class="${k!=="both"?"p-"+k:""}">${k!=="both"?'<span class="dot"></span>':""}${l}</button>`).join("")}</div>`;
}
function renderPiano(){
  const confirming=Date.now()-S.confirmClear<4000;
  let h=`<div class="toolbar">${whoSeg()}
    <div class="seg" role="group" aria-label="Vista"><button data-act="view" data-view="week" aria-pressed="${S.view==="week"}">Settimana</button><button data-act="view" data-view="day" aria-pressed="${S.view==="day"}">Giorno</button></div>
    <span class="grow"></span>
    <button class="btn ghost${confirming?" danger":""}" data-act="clear-week">${confirming?"Tocca ancora per svuotare":"Svuota settimana"}</button></div>`;
  const wp=weekProgress(persons());
  if(wp.ok===wp.tot)h+=`<p class="banner">Piano della settimana completo. <button class="btn" data-act="tab" data-tab="spesa">Apri la lista della spesa</button></p>`;
  h+=S.view==="week"?renderWeek():renderDay();
  return h;
}
function cellHTML(p,d,pid){
  const sm=mealSummary(p,d,pid), P=DIETE[p].pasti[pid];
  let inner="";
  if(sm.state==="empty")inner=`<span class="add">+ Scegli</span>`;
  else{
    if(sm.variant)inner+=`<span class="vn">${esc(sm.variant)}</span>`;
    const L=sm.lines;inner+=L.slice(0,4).map(l=>`<span class="ln">${esc(l)}</span>`).join("");
    if(L.length>4)inner+=`<span class="more">+ altre ${L.length-4}</span>`;
    if(sm.missing)inner+=`<span class="miss">${sm.missing===1?"manca 1 portata":"mancano "+sm.missing+" portate"}</span>`;
    if(sm.warn)inner+=`<span class="wl">! da verificare</span>`;
  }
  return `<button class="cell ${sm.state}" data-act="cell" data-p="${p}" data-d="${d}" data-pid="${pid}" aria-label="${esc(DIETE[p].nome+", "+GIORNI[d]+", "+P.nome)}">${inner}</button>`;
}
function renderWeek(){
  const ti=todayIdx(), ps=persons();
  let h=`<div class="tablewrap"><table class="week"><thead><tr><th class="rowh"></th>${[0,1,2,3,4,5,6].map(d=>`<th class="${d===ti?"today":""}">${G3[d]} <b>${dayDate(d).getDate()}</b></th>`).join("")}</tr></thead><tbody>`;
  for(const [pid,nome] of PASTI){
    const rows=ps.filter(p=>DIETE[p].pasti[pid]); if(!rows.length)continue;
    rows.forEach((p,j)=>{h+=`<tr class="p-${p}${j===0?" first":""}"><th class="rowh">${j===0?`<span class="pasto">${nome}</span>`:""}<span class="who"><span class="dot"></span>${DIETE[p].nome}</span></th>${[0,1,2,3,4,5,6].map(d=>`<td>${cellHTML(p,d,pid)}</td>`).join("")}</tr>`;});
  }
  return h+`</tbody></table></div>`;
}
function renderDay(){
  const ps=persons(), ti=todayIdx();
  let h=`<div class="daychips" role="group" aria-label="Giorno">`;
  for(let d=0;d<7;d++){
    let tot=0,ok=0;for(const p of ps)for(const [pid] of PASTI)if(DIETE[p].pasti[pid]){tot++;const st=mealSummary(p,d,pid).state;if(st==="full"||st==="libero")ok++;}
    h+=`<button class="daychip" data-act="day" data-d="${d}" aria-pressed="${S.day===d}">${G3[d]}${d===ti?" ·":""}<b>${dayDate(d).getDate()}</b><span class="bar"><span style="width:${tot?Math.round(ok/tot*100):0}%"></span></span></button>`;
  }
  h+=`</div>`;
  for(const [pid,nome] of PASTI){
    const rows=ps.filter(p=>DIETE[p].pasti[pid]); if(!rows.length)continue;
    h+=`<section class="dmeal"><h3>${nome}</h3><div class="dcells">${rows.map(p=>`<div class="dcol p-${p}"><span class="who"><span class="dot"></span>${DIETE[p].nome}</span>${cellHTML(p,S.day,pid)}</div>`).join("")}</div></section>`;
  }
  return h;
}
function weekProgress(ps){let tot=0,ok=0;for(const p of ps)for(const [pid] of PASTI){if(!DIETE[p].pasti[pid])continue;for(let d=0;d<7;d++){tot++;const st=mealSummary(p,d,pid).state;if(st==="full"||st==="libero")ok++;}}return{tot,ok};}
function renderSpesa(){
  const items=shopping();
  if(!items.length)return `<div class="empty" style="margin-top:16px"><b>La lista è vuota</b>Si crea da sola mentre scegli i pasti nel Piano.</div>`;
  const tot=items.length, got=items.filter(it=>plan.spesa[it.k]).length, wp=weekProgress(PERSONE);
  let h=`<div class="spesa-head"><div class="spesa-prog"><div class="sp-num"><b>${got}</b> di ${tot} prodotti presi</div><div class="progress"><span style="width:${Math.round(got/tot*100)}%"></span></div><p>Settimana ${weekLabel()} · totali di Matteo e Anna, a crudo e senza scarto${wp.ok<wp.tot?` · piano compilato ${wp.ok}/${wp.tot}, la lista si aggiorna se aggiungi pasti`:""}</p></div>
    <div class="toolbar" style="margin:0"><button class="btn ghost" data-act="hide-got" aria-pressed="${S.hideGot}">${S.hideGot?"Mostra i presi":"Nascondi i presi"}</button><button class="btn ghost" data-act="uncheck">Togli le spunte</button><button class="btn" data-act="copy">Copia la lista</button></div></div>`;
  if(got===tot)h+=`<p class="banner">Spesa completata: hai preso tutto.</p>`;
  h+=`<div class="spesa-grid">`;
  for(const c of CATS){
    let its=items.filter(it=>it.cat===c); if(!its.length)continue;
    const left=its.filter(it=>!plan.spesa[it.k]).length;
    its.sort((a,b)=>((plan.spesa[a.k]?1:0)-(plan.spesa[b.k]?1:0))||a.name.localeCompare(b.name,"it"));
    if(S.hideGot)its=its.filter(it=>!plan.spesa[it.k]);
    if(!its.length)continue;
    h+=`<section class="cat"><h3>${c}<span>${left?left+" da prendere":"tutto preso"}</span></h3>`;
    for(const it of its){
      const got=!!plan.spesa[it.k];
      h+=`<label class="item${got?" got":""}"><input type="checkbox" id="chk-${it.k}" data-check="${it.k}" ${got?"checked":""}><span class="nm">${esc(it.name)}</span><span class="q">${esc(qtyItem(it))}</span></label>`;
    }
    h+=`</section>`;
  }
  return h+`</div>`;
}
function renderControllo(){
  let h=`<div class="toolbar">${whoSeg()}</div><div class="ck-grid">`;
  for(const p of persons()){
    let tot=0,ok=0,rows="",warns=[];
    for(const [pid] of PASTI){
      const P=DIETE[p].pasti[pid]; if(!P)continue;
      for(let d=0;d<7;d++){tot++;const sm=mealSummary(p,d,pid);if(sm.state==="full"||sm.state==="libero")ok++;}
      if(P.varianti.some(v=>v.max)){const vu=variantCounts(p,pid);rows+=`<div class="ck"><div class="ck-t">${P.nome}: tipo di pasto</div><div class="freqbar">${P.varianti.filter(v=>v.max).map(v=>`<span class="fq ${fcls(vu[v.id]||0,v.max)}">${esc(v.nome)} ${vu[v.id]||0}/${v.max}</span>`).join("")}</div></div>`;}
      for(const V of P.varianti)for(const pt of V.portate){
        if(!pt.freq)continue;const u=usage(p,pid,V.id,pt);
        rows+=`<div class="ck"><div class="ck-t">${P.nome}${P.varianti.length>1?" · "+esc(V.nome):""} · ${esc(pt.nome)}</div><div class="freqbar">${Object.keys(pt.freq).map(g=>`<span class="fq ${fcls(u[g]||0,pt.freq[g].max)}">${esc(pt.freq[g].nome)} ${u[g]||0}/${pt.freq[g].max}</span>`).join("")}</div></div>`;
      }
      for(let d=0;d<7;d++){const m=mealOf(p,d,pid);if(!m)continue;const V=variantOf(p,pid,m);if(!V)continue;const s=picks(m);for(const pt of V.portate){const op=pt.byId[s[pt.id]];if(op&&op.w)warns.push(`${G3[d]} ${P.nome.toLowerCase()}: ${op.n}`);}}
    }
    h+=`<section class="card p-${p}"><h3><span class="dot"></span>${DIETE[p].nome}</h3><p class="meta">${ok} pasti completi su ${tot}</p><div class="progress"><span style="width:${tot?Math.round(ok/tot*100):0}%"></span></div>${rows}${warns.length?`<div class="ck"><div class="ck-t">Da verificare con la nutrizionista</div><ul>${warns.map(w=>`<li>${esc(w)}</li>`).join("")}</ul></div>`:""}</section>`;
  }
  h+=`<section class="card"><h3>Regole dei piani</h3><ul>
    <li>Per ogni portata si sceglie un alimento, senza saltarne nessuna. Se sei sazio riduci le grammature, non le portate.</li>
    <li>Le grammature sono a crudo e senza scarto: all'inizio conviene pesare.</li>
    <li>Rispetta le frequenze settimanali (es. 2/7 = due volte a settimana). Verde = obiettivo raggiunto, rosso = superato.</li>
    <li>Acqua almeno 1,5–2 litri al giorno. Sale da cucina al massimo 3 g; spezie, erbe, aceto, limone e brodo vegetale liberi.</li>
    <li>Pesce almeno due volte a settimana; preferire carne bianca e tagli magri.</li>
  </ul></section>
  <section class="card"><h3>Account</h3><p class="meta">Accesso fatto come ${esc(user?.email||"")}</p><ul>${PERSONE.map(p=>{const i=DIETE[p].info||{};return `<li>Piano di ${esc(DIETE[p].nome)}: aggiornato il ${i.aggiornato?esc(new Date(i.aggiornato).toLocaleDateString("it-IT")):"–"}${i.fonte?" da "+esc(i.fonte):""}</li>`;}).join("")}</ul>
  <p class="hint">Per un nuovo piano della nutrizionista: mettete il PDF nella cartella raw/ del vault e chiedete a Claude di aggiornare la dieta.</p>
  <div class="sh-foot"><button class="btn ghost" data-act="logout">Esci</button></div></section></div>`;
  return h;
}
function renderSheet(){
  const {p,d,pid}=sheetCtx, P=DIETE[p].pasti[pid], m=mealOf(p,d,pid);
  const vid=m?m.v:(P.varianti.length===1?P.varianti[0].id:null);
  const V=vid?P.varianti.find(v=>v.id===vid):null, s=picks(m);
  let h=`<div class="sh-head p-${p}"><div><div class="eyebrow"><span class="dot"></span>${DIETE[p].nome} · ${GIORNI[d]} ${dayDate(d).getDate()}</div><h2>${P.nome}</h2></div><button class="iconbtn" data-act="close" aria-label="Chiudi" id="sheet-close">×</button></div>`;
  if(P.varianti.length>1){
    const vu=variantCounts(p,pid);
    h+=`<div class="variants">${P.varianti.map(v=>`<button class="vbtn" data-act="variant" data-v="${v.id}" aria-pressed="${v.id===vid}"><b>${esc(v.nome)}</b>${v.max?`<span class="vfq ${fcls(vu[v.id]||0,v.max)}">${vu[v.id]||0} su ${v.max} a settimana</span>`:""}</button>`).join("")}</div>`;
  }
  if(!V)h+=`<p class="hint">Scegli che tipo di ${P.nome.toLowerCase()} fare in questo giorno.</p>`;
  else{
    if(V.nota)h+=`<p class="nota">${esc(V.nota)}</p>`;
    const lib=isLib(V,s);
    for(const pt of V.portate){if(lib&&!pt.byId[s[pt.id]]?.lib)continue;h+=renderPortata(p,pid,V,pt,s);}
    if(lib)h+=`<p class="hint">Pasto libero: niente grammature e niente in lista della spesa.</p>`;
  }
  h+=`<div class="sh-foot"><button class="btn ghost" data-act="clear-meal">Svuota pasto</button>${V&&!isLib(V,s)?`<button class="btn ghost" data-act="fill-meal">Completa a caso</button>`:""}<button class="btn" data-act="close">Fatto</button></div>`;
  const sh=$("sheet"), y=sh.scrollTop; sh.innerHTML=h; sh.scrollTop=y;
}
function renderPortata(p,pid,V,pt,s){
  const sel=s[pt.id], u=pt.freq?usage(p,pid,V.id,pt):null, mineG=pt.byId[sel]?.f;
  const chip=op=>{
    const full=u&&op.f&&mineG!==op.f&&(u[op.f]||0)>=pt.freq[op.f].max, q=qtyLabel(op);
    return `<button class="chip${full?" full":""}${op.w?" warn":""}" data-act="opt" data-pt="${pt.id}" data-o="${op.id}" aria-pressed="${op.id===sel}">${op.w?'<span class="wmark" aria-hidden="true">!</span>':""}<span>${esc(op.n)}</span>${q?`<span class="g">${esc(q)}</span>`:""}</button>`;
  };
  let h=`<section class="portata"><h3>${esc(pt.nome)}</h3>`;
  if(pt.freq)for(const g in pt.freq){const F=pt.freq[g],c=u[g]||0;h+=`<div class="fgroup"><div class="fglabel">${esc(F.nome)} <span class="fq ${fcls(c,F.max)}">${c}/${F.max} a settimana</span></div><div class="chips">${pt.opz.filter(x=>x.f===g).map(chip).join("")}</div></div>`;}
  else h+=`<div class="chips">${pt.opz.map(chip).join("")}</div>`;
  const so=pt.byId[sel];
  if(so){if(so.w)h+=`<p class="warnline">${esc(so.w)}</p>`;const r=DIETE[p].ricette[so.n];if(r)h+=`<p class="ricetta">Ricetta della nutrizionista, in lista spesa: ${r.map(([n,g])=>esc(n)+" "+g+" g").join(", ")}.</p>`;}
  return h+`</section>`;
}

/* ---------- azioni ---------- */
function openSheet(p,d,pid){sheetCtx={p,d,pid};$("overlay").hidden=false;document.body.style.overflow="hidden";$("sheet").scrollTop=0;renderSheet();$("sheet-close")?.focus();}
function closeSheet(){sheetCtx=null;$("overlay").hidden=true;document.body.style.overflow="";}
function pickVariant(vid){
  const {p,d,pid}=sheetCtx,P=DIETE[p].pasti[pid],m=mealOf(p,d,pid),V=P.varianti.find(v=>v.id===vid),old=picks(m),s={};
  for(const pt of V.portate){if(old[pt.id]&&pt.byId[old[pt.id]])s[pt.id]=old[pt.id];else if(pt.opz.length===1)s[pt.id]=pt.opz[0].id;}
  for(const k in old)if(!(k in s))s[k]=null;
  write(patchAt(p,d,pid,{v:vid,s}));
}
function pickOpt(ptid,oid){
  const {p,d,pid}=sheetCtx,P=DIETE[p].pasti[pid],m=mealOf(p,d,pid);
  const vid=m?m.v:P.varianti[0].id,V=P.varianti.find(v=>v.id===vid),pt=V.portate.find(x=>x.id===ptid);
  const val=picks(m)[ptid]===oid?null:oid, s={[ptid]:val};
  if(!m)for(const x of V.portate)if(x.opz.length===1&&x.id!==ptid)s[x.id]=x.opz[0].id;
  if(val&&pt.byId[oid].lib)for(const x of V.portate)if(x.id!==ptid)s[x.id]=null;
  write(patchAt(p,d,pid,{v:vid,s}));
}
function fillMeal(){
  const {p,d,pid}=sheetCtx,P=DIETE[p].pasti[pid],m=mealOf(p,d,pid);
  let vid=m?m.v:null;
  if(!vid){const vu=variantCounts(p,pid);const av=P.varianti.filter(v=>!v.max||(vu[v.id]||0)<v.max);vid=rnd(av.length?av:P.varianti).id;}
  const V=P.varianti.find(v=>v.id===vid),cur=picks(m),s={};
  for(const pt of V.portate)if(!pt.opt&&(!cur[pt.id]||!pt.byId[cur[pt.id]]))s[pt.id]=pickGroupOption(pt,pt.freq?usage(p,pid,vid,pt):{},true);
  write(patchAt(p,d,pid,{v:vid,s}));
}
async function copyList(){
  const items=shopping().filter(it=>!plan.spesa[it.k]);
  let t=`Spesa · settimana ${weekLabel()}\n`;
  for(const c of CATS){const its=items.filter(it=>it.cat===c).sort((a,b)=>a.name.localeCompare(b.name,"it"));if(!its.length)continue;t+=`\n${c.toUpperCase()}\n`+its.map(it=>`- ${it.name}: ${qtyItem(it)}`).join("\n")+"\n";}
  try{await navigator.clipboard.writeText(t);toast("Lista copiata: incollala su WhatsApp o nelle Note.");}
  catch(e){toast("Copia non riuscita da questo dispositivo.");}
}
let toastT;function toast(msg){const el=$("toast");el.textContent=msg;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,3200);}

document.addEventListener("click",e=>{
  if(e.target.id==="overlay"){closeSheet();return;}
  const b=e.target.closest("[data-act]");if(!b)return;const a=b.dataset.act;
  if(a==="logout"){signOut();return;}
  if(!ready)return;
  if(a==="tab"){S.tab=b.dataset.tab;renderAll();}
  else if(a==="who"){S.who=b.dataset.who;setPref("who",S.who);renderAll();}
  else if(a==="view"){S.view=b.dataset.view;setPref("view",S.view);renderAll();}
  else if(a==="day"){S.day=+b.dataset.d;renderAll();}
  else if(a==="week-prev"||a==="week-next"){S.week=iso(addDays(parseISO(S.week),a==="week-prev"?-7:7));const ti=todayIdx();S.day=ti>=0?ti:0;closeSheet();subscribe();}
  else if(a==="cell")openSheet(b.dataset.p,+b.dataset.d,b.dataset.pid);
  else if(a==="close")closeSheet();
  else if(a==="variant")pickVariant(b.dataset.v);
  else if(a==="opt")pickOpt(b.dataset.pt,b.dataset.o);
  else if(a==="clear-meal"){const {p,d,pid}=sheetCtx;write(patchAt(p,d,pid,null));}
  else if(a==="fill-meal")fillMeal();
  else if(a==="autofill")autoFill();
  else if(a==="clear-week"){if(Date.now()-S.confirmClear<4000){S.confirmClear=0;clearWeek();}else{S.confirmClear=Date.now();renderAll();setTimeout(renderAll,4100);}}
  else if(a==="copy")copyList();
  else if(a==="hide-got"){S.hideGot=!S.hideGot;setPref("hideGot",S.hideGot?"1":"0");renderAll();}
  else if(a==="uncheck"){const sp={};for(const k in plan.spesa)sp[k]=null;write({spesa:sp});}
});
document.addEventListener("change",e=>{
  const k=e.target.dataset&&e.target.dataset.check;if(k)write({spesa:{[k]:e.target.checked?true:null}});
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&sheetCtx)closeSheet();});

/* ---------- diete ---------- */
let loadMsg="Carico i piani…";
function applyDiete(rows){
  const next={};
  for(const r of rows||[]){
    if(!PERSONE.includes(r.persona)||!r.dieta||!r.dieta.pasti)continue;
    const D=clone(r.dieta); D.nome=D.nome||r.persona[0].toUpperCase()+r.persona.slice(1);
    for(const pid in D.pasti)for(const V of D.pasti[pid].varianti)for(const pt of V.portate)if(pt.noShop)pt.mini=true;
    normalizeDiet(D); D.info={aggiornato:r.aggiornato||"",fonte:r.fonte||""}; next[r.persona]=D;
  }
  if(!PERSONE.every(p=>next[p]))return false;
  DIETE=next; ready=true; return true;
}
async function loadDiete(){
  const {data,error}=await sb.from("diete").select("persona,dieta,aggiornato,fonte");
  if(error){ if(!ready){ sync="local"; loadMsg="Non riesco a caricare i piani: controlla la connessione e riapri l'app."; } renderAll(); return; }
  if(applyDiete(data)){ LS.set("diete",data); if(sheetCtx&&!DIETE[sheetCtx.p].pasti[sheetCtx.pid])closeSheet(); }
  else if(!ready){
    const {data:me}=await sb.from("membri").select("persona").eq("user_id",user.id).maybeSingle();
    const mail=esc(user.email||"");
    if(!me) loadMsg=`<b>Account non abilitato</b>Hai fatto l'accesso come ${mail}, ma questo account non è nella tabella "membri" di Supabase.<br><br><button class="btn ghost" data-act="logout">Esci</button>`;
    else{
      const have=(data||[]).map(r=>r.persona), miss=PERSONE.filter(p=>!have.includes(p));
      loadMsg=`<b>Diete mancanti</b>Accesso come ${mail} (${esc(me.persona)}): ok. Su Supabase manca la dieta di ${esc(miss.join(" e "))}.<br><br><button class="btn ghost" data-act="logout">Esci</button>`;
    }
  }
  renderAll();
}

/* ---------- accesso e avvio ---------- */
function showLogin(msg){
  document.body.className="signed-out"; $("app").hidden=true; $("login").hidden=false;
  const er=$("login-err"); er.hidden=!msg; er.textContent=msg||"";
}
async function start(){
  document.body.className="signed-in"; $("login").hidden=true; $("app").hidden=false; loadMsg="Carico i piani…";
  applyDiete(LS.get("diete"));
  if(!queue.length) queue.push(...(LS.get("queue")||[]));
  subscribe();
  await loadDiete();
  if(chan) sb.removeChannel(chan);
  chan=sb.channel("app")
    .on("postgres_changes",{event:"*",schema:"public",table:"settimane"},p=>{const r=p.new;if(r&&r.settimana===S.week&&!queue.some(q=>q.week===S.week))applyRemote(S.week,r.dati);})
    .on("postgres_changes",{event:"*",schema:"public",table:"diete"},()=>loadDiete())
    .subscribe(st=>{if(st==="SUBSCRIBED"&&user)fetchWeek(S.week);});
  pump();
}
async function signOut(){
  try{ await sb.auth.signOut({scope:"local"}); }catch(e){}
  try{ for(const k of Object.keys(localStorage)) if(/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); }catch(e){}
  if(chan){ sb.removeChannel(chan); chan=null; }
  queue.length=0; LS.clear(); DIETE={}; ready=false; plan=emptyPlan(); user=null; closeSheet();
  showLogin();
}
$("login-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("login-btn"); btn.disabled=true; showLogin();
  const {error}=await sb.auth.signInWithPassword({email:$("login-email").value.trim(),password:$("login-pw").value});
  btn.disabled=false;
  if(error) showLogin(/invalid/i.test(error.message)?"Email o password non corrette.":!navigator.onLine?"Serve la connessione per accedere.":"Accesso non riuscito, riprova.");
  else $("login-pw").value="";
});
let authSeen=false;
sb.auth.onAuthStateChange((ev,session)=>{
  const u=session?.user||null;
  if(authSeen&&(u?u.id:null)===(user?user.id:null))return;
  authSeen=true; user=u;
  if(user) setTimeout(start,0); else { if(chan){sb.removeChannel(chan);chan=null;} showLogin(); }
});
/* Il telefono sospende le app in background: al ritorno si riallinea e riprova i salvataggi in coda. */
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&user&&ready){fetchWeek(S.week);pump();}});
addEventListener("online",()=>{if(user){pump();fetchWeek(S.week);}});
if("serviceWorker" in navigator) addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));

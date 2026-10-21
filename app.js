const FV="Frutta e verdura", CP="Carne e pesce", SA="Salumi", LU="Latticini e uova", PC="Pane, pasta e cereali", DI="Dispensa";
const CATS=[FV,CP,SA,LU,PC,DI];
const OLIO="Olio extravergine d'oliva", UOVA="Uova bio";
const PEZZI={[UOVA]:{g:60,u:["uovo","uova"]}};
const PERSONE=["matteo","anna"];
const PASTI=[["colazione","Colazione"],["spuntino","Spuntino"],["pranzo","Pranzo"],["merenda","Merenda"],["cena","Cena"]];
/* Le diete arrivano da Supabase (tabella "diete_versioni"): nel codice pubblico non ci sono dati personali.
   Ogni persona può avere più versioni, ognuna valida da un lunedì in poi: DIETE è quella della settimana visualizzata. */
let DIETE={}, VERS={}, versioni=true;
const PRIMA="2000-01-03";

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
const mealOf=(p,d,pid)=>{const m=plan.piano?.[p]?.["d"+d]?.[pid];return m&&(m.v||m.lib)?m:null;};
const picks=m=>(m&&m.s)||{};
const variantOf=(p,pid,m)=>m&&m.v?DIETE[p].pasti[pid].varianti.find(v=>v.id===m.v)||null:null;
const isLib=(V,s)=>V.portate.some(pt=>pt.byId[s[pt.id]]?.lib);
const qtyLabel=op=>op.lib?"":op.g?op.g+" g":(op.t||"");
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
function usage(p,pid,vid,pt){const u={};for(let d=0;d<7;d++){const m=mealOf(p,d,pid);if(!m)continue;if(m.lib){if(pt.freq&&pt.freq.libero)u.libero=(u.libero||0)+1;continue;}if(m.v!==vid)continue;const op=pt.byId[picks(m)[pt.id]];if(op&&op.f)u[op.f]=(u[op.f]||0)+1;}return u;}
function variantCounts(p,pid){const u={};for(let d=0;d<7;d++){const m=mealOf(p,d,pid);if(m&&m.v)u[m.v]=(u[m.v]||0)+1;}return u;}
function mealSummary(p,d,pid){
  const m=mealOf(p,d,pid); if(!m)return{state:"empty"};
  if(m.lib)return{state:"libero",lines:["Pasto libero"]};
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
  if(S.who==="both"){patch.spesa=null;patch.extra=null;}
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
/* Voci scritte a mano, fuori dalla dieta: plan.extra = {<id>: {n: nome, t: quando}}, spunta in plan.spesa["x-<id>"]. */
const extraItems=()=>Object.entries(plan.extra||{}).filter(([,v])=>v&&v.n).map(([id,v])=>({k:"x-"+id,id,name:String(v.n),t:v.t||0}));
function addExtra(){
  const inp=$("extra-in"); if(!inp)return;
  const n=inp.value.trim().replace(/\s+/g," ").slice(0,80); if(!n)return;
  inp.value="";
  if(extraItems().some(it=>it.name.toLowerCase()===n.toLowerCase()&&!plan.spesa[it.k])){toast(`"${n}" è già in lista.`);return;}
  const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  write({extra:{[id]:{n,t:Date.now()}}});
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
  const nShop=[...shopping(),...extraItems()].filter(it=>!plan.spesa[it.k]).length;
  $("tabs").innerHTML=[["piano","Piano"],["spesa","Lista della spesa",nShop||""],["account","Account"]].map(([id,l,c])=>`<button class="tab" role="tab" data-act="tab" data-tab="${id}" aria-selected="${S.tab===id}">${l}${c?`<span class="count">${c}</span>`:""}</button>`).join("");
  // Un aggiornamento dall'altro telefono non deve cancellare quello che si sta scrivendo.
  const inp=$("extra-in"), typed=inp?inp.value:"", typing=inp&&document.activeElement===inp;
  $("main").innerHTML=S.tab==="piano"?renderPiano():S.tab==="spesa"?renderSpesa():renderAccount();
  const inp2=$("extra-in"); if(inp2){ if(typed)inp2.value=typed; if(typing)inp2.focus(); }
  if(sheetCtx&&!sheetCtx.up)renderSheet();
}
function whoSeg(){
  return `<div class="seg" role="group" aria-label="Persona">${[["both","Entrambi"],["matteo","Matteo"],["anna","Anna"]].map(([k,l])=>`<button data-act="who" data-who="${k}" aria-pressed="${S.who===k}" class="${k!=="both"?"p-"+k:""}">${k!=="both"?'<span class="dot"></span>':""}${l}</button>`).join("")}</div>`;
}
function renderPiano(){
  const confirming=Date.now()-S.confirmClear<4000;
  let h=`<div class="toolbar piano-bar"><div class="tb-left">${whoSeg()}</div>
    <div class="seg tb-mid" role="group" aria-label="Vista"><button data-act="view" data-view="week" aria-pressed="${S.view==="week"}">Settimana</button><button data-act="view" data-view="day" aria-pressed="${S.view==="day"}">Giorno</button></div>
    <div class="tb-right"><button class="btn ghost${confirming?" danger":""}" data-act="clear-week">${confirming?"Tocca ancora per svuotare":"Svuota settimana"}</button></div></div>`;
  const nuove=persons().filter(p=>(VERS[p]||[]).some((v,i)=>i>0&&v.dal===S.week));
  if(nuove.length)h+=`<p class="banner">Da questa settimana ${nuove.map(p=>esc(DIETE[p].nome)).join(" e ")} ${nuove.length>1?"seguono":"segue"} la nuova dieta.</p>`;
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
/* Icone dei pasti: tratti semplici su cerchio giallo. */
const ICONE={
  colazione:'<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3c0 1.5 1.5 1.5 1.5 3M12 3c0 1.5 1.5 1.5 1.5 3"/>',
  spuntino:'<path d="M12 7.5c-2-1.6-6.5-1.2-6.5 4 0 4.2 2.8 9 6.5 8 3.7 1 6.5-3.8 6.5-8 0-5.2-4.5-5.6-6.5-4z"/><path d="M12 7.5c0-2 1-3.6 3-4.3"/>',
  pranzo:'<circle cx="12" cy="12" r="5.5"/><path d="M3.5 4v4.5a1.5 1.5 0 0 0 3 0V4M5 9v11"/><path d="M20.5 4c-1.5 1-2 3-2 6h2v10"/>',
  merenda:'<circle cx="12" cy="12" r="8"/><path d="M9 9.5h.01M14.5 8.5h.01M13.5 14.5h.01M9 14h.01M16 12h.01"/>',
  cena:'<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/><path d="M17 4v3M15.5 5.5h3"/>'
};
const mealTitle=(pid,nome)=>`<span class="m-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONE[pid]||""}</svg></span>${nome}`;
const badge=p=>`<span class="badge" aria-hidden="true">${esc(DIETE[p].nome[0])}</span>`;
function renderWeek(){
  const ti=todayIdx(), ps=persons();
  // Griglia in sottofondo: una colonna per giorno, oggi evidenziato.
  const cols=`<div class="daycols" aria-hidden="true"><span></span><span></span>${[0,1,2,3,4,5,6].map(d=>`<span class="d${d%2?" alt":""}${d===ti?" today":""}"></span>`).join("")}</div>`;
  let h=`<div class="tablewrap"><div class="weekgrid">${cols}<table class="week"><colgroup><col class="c-meal"><col class="c-rowh"><col span="7"></colgroup><thead><tr><th class="mealside"></th><th class="rowh"></th>${[0,1,2,3,4,5,6].map(d=>`<th class="dayh${d===ti?" today":""}${d>4?" we":""}"><span class="dw">${G3[d]}</span><b>${dayDate(d).getDate()}</b></th>`).join("")}</tr></thead><tbody>`;
  for(const [pid,nome] of PASTI){
    const rows=ps.filter(p=>DIETE[p].pasti[pid]); if(!rows.length)continue;
    h+=`<tr class="gap"><td colspan="9"></td></tr>`;
    rows.forEach((p,j)=>{h+=`<tr class="p-${p} prow">${j===0?`<th class="mealside" rowspan="${rows.length}" scope="rowgroup"><span class="pasto">${mealTitle(pid,nome)}</span></th>`:""}<th class="rowh">${badge(p)}<span class="sr-only">${DIETE[p].nome}</span></th>${[0,1,2,3,4,5,6].map(d=>`<td>${cellHTML(p,d,pid)}</td>`).join("")}</tr>`;});
  }
  return h+`</tbody></table></div></div>`;
}
function renderDay(){
  const ps=persons(), ti=todayIdx();
  let h=`<div class="daychips" role="group" aria-label="Giorno">`;
  for(let d=0;d<7;d++){
    let tot=0,ok=0;for(const p of ps)for(const [pid] of PASTI)if(DIETE[p].pasti[pid]){tot++;const st=mealSummary(p,d,pid).state;if(st==="full"||st==="libero")ok++;}
    h+=`<button class="daychip${d===ti?" today":""}" data-act="day" data-d="${d}" aria-pressed="${S.day===d}">${G3[d]}<b>${dayDate(d).getDate()}</b><span class="bar"><span style="width:${tot?Math.round(ok/tot*100):0}%"></span></span></button>`;
  }
  h+=`</div>`;
  for(const [pid,nome] of PASTI){
    const rows=ps.filter(p=>DIETE[p].pasti[pid]); if(!rows.length)continue;
    h+=`<section class="dmeal"><h3>${mealTitle(pid,nome)}</h3><div class="dcells">${rows.map(p=>`<div class="dcol p-${p} prow"><span class="dhead">${badge(p)}<span class="sr-only">${DIETE[p].nome}</span></span>${cellHTML(p,S.day,pid)}</div>`).join("")}</div></section>`;
  }
  return h;
}
function weekProgress(ps){let tot=0,ok=0;for(const p of ps)for(const [pid] of PASTI){if(!DIETE[p].pasti[pid])continue;for(let d=0;d<7;d++){tot++;const st=mealSummary(p,d,pid).state;if(st==="full"||st==="libero")ok++;}}return{tot,ok};}
function renderExtra(){
  const extra=extraItems(), left=extra.filter(it=>!plan.spesa[it.k]).length;
  let its=extra.sort((a,b)=>((plan.spesa[a.k]?1:0)-(plan.spesa[b.k]?1:0))||a.t-b.t);
  if(S.hideGot)its=its.filter(it=>!plan.spesa[it.k]);
  let h=`<section class="cat extra"><h3>Altro da comprare<span>${extra.length?(left?left+" da prendere":"tutto preso"):"fuori dalla dieta"}</span></h3>
    <form class="extra-add" data-form="extra"><input id="extra-in" type="text" maxlength="80" placeholder="Es. detersivo, acqua, caffè…" aria-label="Cosa comprare" autocomplete="off" enterkeyhint="done"><button class="btn" type="submit">Aggiungi</button></form>`;
  for(const it of its){
    const got=!!plan.spesa[it.k];
    h+=`<div class="item extra-item${got?" got":""}"><input type="checkbox" id="chk-${it.k}" data-check="${it.k}" ${got?"checked":""}><label class="nm" for="chk-${it.k}">${esc(it.name)}</label><button class="iconbtn sm" data-act="extra-del" data-id="${esc(it.id)}" aria-label="Togli ${esc(it.name)} dalla lista">×</button></div>`;
  }
  return h+`</section>`;
}
function renderSpesa(){
  const items=shopping(), all=[...items,...extraItems()];
  if(!all.length)return `<div class="empty" style="margin-top:16px"><b>La lista è vuota</b>Si crea da sola mentre scegli i pasti nel Piano. Qui sotto puoi aggiungere altro da comprare.</div><div class="spesa-grid" style="margin-top:14px">${renderExtra()}</div>`;
  const tot=all.length, got=all.filter(it=>plan.spesa[it.k]).length, wp=weekProgress(PERSONE);
  let h=`<div class="spesa-head"><div class="spesa-prog"><div class="sp-num"><b>${got}</b> di ${tot} prodotti presi</div><div class="progress"><span style="width:${Math.round(got/tot*100)}%"></span></div><p>Settimana ${weekLabel()} · totali di Matteo e Anna, a crudo e senza scarto${wp.ok<wp.tot?` · piano compilato ${wp.ok}/${wp.tot}, la lista si aggiorna se aggiungi pasti`:""}</p></div>
    <div class="toolbar" style="margin:0"><button class="btn ghost" data-act="hide-got" aria-pressed="${S.hideGot}">${S.hideGot?"Mostra i presi":"Nascondi i presi"}</button><button class="btn ghost" data-act="uncheck">Togli le spunte</button><button class="btn" data-act="copy">Copia la lista</button></div></div>`;
  if(got===tot)h+=`<p class="banner">Spesa completata: hai preso tutto.</p>`;
  h+=`<div class="spesa-grid">`+renderExtra();
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
const fmtDal=d=>{const x=parseISO(d),y=new Date().getFullYear();return `lunedì ${x.getDate()} ${MESI[x.getMonth()]}${x.getFullYear()!==y?" "+x.getFullYear():""}`;};
function renderAccount(){
  const day=s=>s?esc(new Date(s).toLocaleDateString("it-IT")):"–", oggi=iso(mondayOf(new Date()));
  const confirming=id=>S.confirmDel&&S.confirmDel.id===id&&Date.now()-S.confirmDel.t<4000;
  const fineIl=d=>{const x=addDays(parseISO(d),-1);return `domenica ${x.getDate()} ${MESI[x.getMonth()]}`;};
  return `<section class="card account"><h3>Account</h3>
    <div class="ck"><div class="ck-t">Accesso fatto come</div><div class="acc-mail">${esc(user?.email||"")}</div></div>
    <div class="ck"><div class="ck-t">Piani alimentari</div>${PERSONE.map(p=>{
      const L=VERS[p]||[], cur=versioneDi(p,oggi), dopo=L.filter(v=>v.dal>oggi);
      return `<div class="acc-row p-${p}"><span class="who"><span class="dot"></span>${esc(DIETE[p].nome)}</span><div class="acc-vers">
        <span>${esc(cur.fonte||"PDF della nutrizionista")}<br><span class="hint">in uso${cur.dal>PRIMA?" da "+fmtDal(cur.dal):""}${dopo.length?" fino a "+fineIl(dopo[0].dal):""} · caricato il ${day(cur.caricato)}</span></span>
        ${dopo.map(v=>`<span class="acc-next"><span>${esc(v.fonte||"PDF della nutrizionista")}<br><span class="hint">da ${fmtDal(v.dal)} · caricato il ${day(v.caricato)}</span></span>${versioni&&v.id?`<button class="btn ghost sm${confirming(v.id)?" danger":""}" data-act="ver-del" data-id="${v.id}">${confirming(v.id)?"Tocca ancora":"Elimina"}</button>`:""}</span>`).join("")}
      </div></div>`;}).join("")}
      <div class="acc-up"><button class="btn" data-act="upload-open"${versioni?"":" disabled"}>Carica nuova dieta</button>
      <span class="hint">${versioni?"Il PDF della nutrizionista: poi scegli da che lunedì vale.":"Prima va aggiornato il database Supabase (supabase/versioni-diete.sql)."}</span></div></div>
    <div class="sh-foot"><button class="btn ghost" data-act="logout">Log out</button></div></section>`;
}
function renderSheet(){
  if(sheetCtx.up){renderUpload();return;}
  const {p,d,pid}=sheetCtx, P=DIETE[p].pasti[pid], m=mealOf(p,d,pid);
  const vid=m?m.v:(P.varianti.length===1?P.varianti[0].id:null);
  const V=vid?P.varianti.find(v=>v.id===vid):null, s=picks(m);
  let h=`<div class="sh-head p-${p}"><div><div class="eyebrow"><span class="dot"></span>${DIETE[p].nome} · ${GIORNI[d]} ${dayDate(d).getDate()}</div><h2>${P.nome}</h2></div><button class="iconbtn" data-act="close" aria-label="Chiudi" id="sheet-close">×</button></div>`;
  const conLibero=LIBERO.includes(pid), libOn=isLibMeal(p,pid,m);
  if(conLibero){
    const F=libFreq(P), c=libCount(p,pid);
    h+=`<button class="libero-btn" data-act="libero" aria-pressed="${libOn}"><b>Pasto libero</b>${F?`<span class="vfq ${fcls(c,F.max)}">${c} su ${F.max} a settimana</span>`:""}<span class="lib-hint">${libOn?"Tocca di nuovo per scegliere gli alimenti":"Niente alimenti da scegliere e niente spesa"}</span></button>`;
  }
  if(libOn){
    h+=`<p class="hint">Pasto libero: niente grammature e niente in lista della spesa.</p>`;
  } else {
    if(P.varianti.length>1){
      const vu=variantCounts(p,pid);
      h+=`<div class="variants">${P.varianti.map(v=>`<button class="vbtn" data-act="variant" data-v="${v.id}" aria-pressed="${v.id===vid}"><b>${esc(v.nome)}</b>${v.max?`<span class="vfq ${fcls(vu[v.id]||0,v.max)}">${vu[v.id]||0} su ${v.max} a settimana</span>`:""}</button>`).join("")}</div>`;
    }
    if(!V)h+=`<p class="hint">Scegli che tipo di ${P.nome.toLowerCase()} fare in questo giorno.</p>`;
    else{
      if(V.nota&&!conLibero)h+=`<p class="nota">${esc(V.nota)}</p>`;
      for(const pt of V.portate)h+=renderPortata(p,pid,V,pt,s);
    }
  }
  h+=`<div class="sh-foot"><button class="btn ghost" data-act="clear-meal">Svuota pasto</button>${V&&!libOn?`<button class="btn ghost" data-act="fill-meal">Completa a caso</button>`:""}<button class="btn" data-act="close">Fatto</button></div>`;
  const sh=$("sheet"), y=sh.scrollTop; sh.innerHTML=h; sh.scrollTop=y;
}
function renderPortata(p,pid,V,pt,s){
  const sel=s[pt.id], u=pt.freq?usage(p,pid,V.id,pt):null, mineG=pt.byId[sel]?.f;
  const chip=op=>{
    const full=u&&op.f&&mineG!==op.f&&(u[op.f]||0)>=pt.freq[op.f].max, q=qtyLabel(op);
    return `<button class="chip${full?" full":""}${op.w?" warn":""}" data-act="opt" data-pt="${pt.id}" data-o="${op.id}" aria-pressed="${op.id===sel}">${op.w?'<span class="wmark" aria-hidden="true">!</span>':""}<span>${esc(op.n)}</span>${q?`<span class="g">${esc(q)}</span>`:""}</button>`;
  };
  let h=`<section class="portata"><h3>${esc(pt.nome)}</h3>`;
  if(pt.freq)for(const g in pt.freq){if(g==="libero"&&LIBERO.includes(pid))continue;const F=pt.freq[g],c=u[g]||0;h+=`<div class="fgroup"><div class="fglabel">${esc(F.nome)} <span class="fq ${fcls(c,F.max)}">${c}/${F.max} a settimana</span></div><div class="chips">${pt.opz.filter(x=>x.f===g).map(chip).join("")}</div></div>`;}
  else h+=`<div class="chips">${pt.opz.filter(x=>!(x.lib&&LIBERO.includes(pid))).map(chip).join("")}</div>`;
  const so=pt.byId[sel];
  if(so){if(so.w)h+=`<p class="warnline">${esc(so.w)}</p>`;const r=DIETE[p].ricette[so.n];if(r)h+=`<p class="ricetta">Ricetta della nutrizionista, in lista spesa: ${r.map(([n,g])=>esc(n)+" "+g+" g").join(", ")}.</p>`;}
  return h+`</section>`;
}

/* ---------- nuova dieta dal PDF ---------- */
/* Il PDF si legge nel telefono (dieta-pdf.js + PDF.js); si salva solo la dieta già convertita, con il lunedì da cui vale. */
const PDFJS="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/";
let pdfjsP=null;
function loadPdfJs(){
  return pdfjsP||(pdfjsP=new Promise((ok,ko)=>{
    const sc=document.createElement("script"); sc.src=PDFJS+"pdf.min.js";
    sc.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS+"pdf.worker.min.js";ok(window.pdfjsLib);};
    sc.onerror=()=>{pdfjsP=null;ko(new Error("pdfjs"));};
    document.head.appendChild(sc);
  }));
}
function versioneDi(p,week){const L=VERS[p]||[];let v=L[0];for(const x of L)if(x.dal<=week)v=x;return v;}
function dieteDi(week){const o={};for(const p of PERSONE)if(VERS[p]&&VERS[p].length)o[p]=versioneDi(p,week).D;return o;}
function prevFor(p,dal){const L=VERS[p]||[];let v=null;for(const x of L)if(x.dal<dal)v=x;return (v||L[0]||{}).raw||null;}
function lunediScelta(){const m=mondayOf(new Date()),o=[];for(let i=0;i<=12;i++)o.push(iso(addDays(m,7*i)));return o;}
function openUpload(){
  const own=LS.get("persona:"+user.id), t=new Date();
  sheetCtx={up:true,p:PERSONE.includes(own)?own:S.who!=="both"?S.who:PERSONE[0],dal:iso(addDays(mondayOf(t),(t.getDay()+6)%7===0?0:7)),S:null};
  $("overlay").hidden=false;document.body.style.overflow="hidden";$("sheet").scrollTop=0;renderUpload();$("sheet-close")?.focus();
}
function upCompute(){
  const u=sheetCtx, prev=prevFor(u.p,u.dal);
  try{u.res=DietaPDF.converti(u.S,prev);u.diff=DietaPDF.confronta(prev,u.res.dieta);u.err="";}
  catch(e){u.res=null;u.err=e&&e.message||"Non riesco a leggere questo PDF.";}
}
async function upRead(file){
  const u=sheetCtx; if(!u||!u.up||!file)return;
  u.busy=true;u.err="";u.file=file.name;renderUpload();
  try{
    const lib=await loadPdfJs();
    u.S=DietaPDF.struttura(await DietaPDF.estrai(lib,new Uint8Array(await file.arrayBuffer())));
    const paz=u.S.info.paziente.toLowerCase().split(/\s+/), chi=PERSONE.find(p=>DIETE[p]&&paz.includes(DIETE[p].nome.toLowerCase()));
    if(chi)u.p=chi;
    upCompute();
  }catch(e){u.S=null;u.err=e&&e.message==="pdfjs"?"Serve la connessione per leggere il PDF.":"Questo file non sembra un PDF leggibile.";}
  u.busy=false; if(sheetCtx===u)renderUpload();
}
async function upSave(){
  const u=sheetCtx; if(!u||!u.res||u.busy)return;
  const i=u.S.info, fonte=`PDF ${i.studio||"della nutrizionista"} del ${i.data||new Date().toLocaleDateString("it-IT")}`;
  u.busy=true;renderUpload();
  const {error}=await sb.from("diete_versioni").upsert({persona:u.p,dal:u.dal,dieta:u.res.dieta,fonte},{onConflict:"persona,dal"});
  u.busy=false;
  if(error){u.err=netErr(error)?"Senza rete: la dieta non è stata salvata, riprova.":"Salvataggio non riuscito: "+(error.message||"riprova.");if(sheetCtx===u)renderUpload();return;}
  if(sheetCtx===u)closeSheet();
  toast(`Dieta di ${DIETE[u.p].nome} salvata: vale da ${fmtDal(u.dal)}.`);
  await loadDiete();
}
function renderUpload(){
  const u=sheetCtx, nome=p=>esc(DIETE[p]?DIETE[p].nome:p);
  let h=`<div class="sh-head"><div><div class="eyebrow">PDF della nutrizionista</div><h2>Nuova dieta</h2></div><button class="iconbtn" data-act="close" aria-label="Chiudi" id="sheet-close">×</button></div>`;
  if(!u.S){
    h+=`<p class="hint">Scegli il PDF che ha mandato la nutrizionista. Lo legge il telefono, il file non viene caricato da nessuna parte. Prima di salvare vedi cosa cambia.</p>`;
    h+=u.busy?`<p class="up-busy">Leggo il PDF…</p>`:`<label class="btn up-file">Scegli il PDF<input type="file" accept="application/pdf,.pdf" data-file="dieta"></label>`;
    if(u.err)h+=`<p class="warnline">${esc(u.err)}</p>`;
    h+=`<div class="sh-foot"><button class="btn ghost" data-act="close">Annulla</button></div>`;
  } else {
    const i=u.S.info, paz=i.paziente, giaC=(VERS[u.p]||[]).some(v=>v.dal===u.dal&&v.dal>PRIMA), oggi=iso(mondayOf(new Date()));
    h+=`<p class="hint up-src">${esc(u.file||"PDF")}${i.data?" · del "+esc(i.data):""}${paz?" · intestato a "+esc(paz):""}</p>`;
    h+=`<div class="up-row"><span class="up-l">Dieta di</span><div class="seg" role="group" aria-label="Persona">${PERSONE.map(p=>`<button data-act="up-who" data-who="${p}" aria-pressed="${u.p===p}" class="p-${p}"><span class="dot"></span>${nome(p)}</button>`).join("")}</div></div>`;
    h+=`<label class="up-row"><span class="up-l">Vale da</span><select class="up-sel" data-change="up-dal">${lunediScelta().map(d=>`<option value="${d}"${d===u.dal?" selected":""}>${fmtDal(d)}${d===oggi?" (questa settimana)":""}</option>`).join("")}</select></label>`;
    if(paz&&DIETE[u.p]&&!paz.toLowerCase().split(/\s+/).includes(DIETE[u.p].nome.toLowerCase()))h+=`<p class="warnline">Il PDF è intestato a ${esc(paz)}: controlla di chi è la dieta.</p>`;
    h+=`<p class="hint">Fino alla settimana prima resta la dieta di adesso${giaC?"; questa sostituisce quella già caricata per la stessa data":""}.</p>`;
    if(u.err)h+=`<p class="warnline">${esc(u.err)}</p>`;
    if(u.res){
      const P=u.res.dieta.pasti;
      h+=`<p class="hint">Pasti: ${Object.values(P).map(x=>esc(x.nome)+(x.varianti.length>1?` (${x.varianti.length} varianti)`:"")).join(" · ")}</p>`;
      for(const a of u.res.avvisi)h+=`<p class="warnline">${esc(a)}</p>`;
      h+=`<section class="up-diff"><h3>Cosa cambia</h3>`;
      h+=u.diff.length?u.diff.map(g=>`<div class="up-g"><b>${esc(g.pasto)}</b><ul>${g.righe.map(r=>`<li>${esc(r)}</li>`).join("")}</ul></div>`).join(""):`<p class="hint">Nessuna differenza rispetto alla dieta di prima.</p>`;
      h+=`</section>`;
    }
    h+=`<div class="sh-foot"><button class="btn ghost" data-act="up-reset">Altro PDF</button><button class="btn ghost" data-act="close">Annulla</button><button class="btn" data-act="up-save"${!u.res||u.busy?" disabled":""}>${u.busy?"Salvo…":"Salva per "+nome(u.p)}</button></div>`;
  }
  const sh=$("sheet"), y=sh.scrollTop; sh.innerHTML=h; sh.scrollTop=y;
}
async function delVersione(id){
  const {error}=await sb.from("diete_versioni").delete().eq("id",id);
  if(error){toast("Non riesco a eliminarla, riprova.");return;}
  toast("Dieta eliminata."); await loadDiete();
}

/* ---------- azioni ---------- */
function openSheet(p,d,pid){sheetCtx={p,d,pid};$("overlay").hidden=false;document.body.style.overflow="hidden";$("sheet").scrollTop=0;renderSheet();$("sheet-close")?.focus();}
function closeSheet(){sheetCtx=null;$("overlay").hidden=true;document.body.style.overflow="";}
function pickVariant(vid){
  const {p,d,pid}=sheetCtx,P=DIETE[p].pasti[pid],m=mealOf(p,d,pid),V=P.varianti.find(v=>v.id===vid),old=picks(m),s={};
  for(const pt of V.portate){if(old[pt.id]&&pt.byId[old[pt.id]])s[pt.id]=old[pt.id];else if(pt.opz.length===1)s[pt.id]=pt.opz[0].id;}
  for(const k in old)if(!(k in s))s[k]=null;
  write(patchAt(p,d,pid,{v:vid,s,lib:null}));
}
function pickOpt(ptid,oid){
  const {p,d,pid}=sheetCtx,P=DIETE[p].pasti[pid],m=mealOf(p,d,pid);
  const vid=m?m.v:P.varianti[0].id,V=P.varianti.find(v=>v.id===vid),pt=V.portate.find(x=>x.id===ptid);
  const val=picks(m)[ptid]===oid?null:oid, s={[ptid]:val};
  if(!m)for(const x of V.portate)if(x.opz.length===1&&x.id!==ptid)s[x.id]=x.opz[0].id;
  if(val&&pt.byId[oid].lib)for(const x of V.portate)if(x.id!==ptid)s[x.id]=null;
  write(patchAt(p,d,pid,{v:vid,s,lib:null}));
}
/* Pasto libero (pranzo e cena): primo pulsante del pannello; se scelto, il resto si chiude.
   Si salva come {lib:true}; i pasti liberi scelti come alimento (vecchio formato, compilazione automatica) valgono uguale. */
const LIBERO=["pranzo","cena"];
const isLibMeal=(p,pid,m)=>{if(!m)return false;if(m.lib)return true;const V=variantOf(p,pid,m);return !!(V&&isLib(V,picks(m)));};
const libFreq=P=>{for(const V of P.varianti)for(const pt of V.portate)if(pt.freq&&pt.freq.libero)return pt.freq.libero;return null;};
function libCount(p,pid){let c=0;for(let d=0;d<7;d++)if(isLibMeal(p,pid,mealOf(p,d,pid)))c++;return c;}
function toggleLibero(){
  const {p,d,pid}=sheetCtx, on=isLibMeal(p,pid,mealOf(p,d,pid));
  write(patchAt(p,d,pid,on?null:{lib:true,v:null,s:null}));
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
  const extra=extraItems().filter(it=>!plan.spesa[it.k]).sort((a,b)=>a.t-b.t);
  if(extra.length)t+=`\nALTRO\n`+extra.map(it=>`- ${it.name}`).join("\n")+"\n";
  try{await navigator.clipboard.writeText(t);toast("Lista copiata: incollala su WhatsApp o nelle Note.");}
  catch(e){toast("Copia non riuscita da questo dispositivo.");}
}
let toastT;function toast(msg){const el=$("toast");el.textContent=msg;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,3200);}

document.addEventListener("click",e=>{
  if(e.target.id==="overlay"){closeSheet();return;}
  const b=e.target.closest("[data-act]");if(!b)return;const a=b.dataset.act;
  if(a==="logout"){signOut();return;}
  if(!ready)return;
  if(a==="upload-open"){openUpload();return;}
  if(sheetCtx&&sheetCtx.up){
    if(a==="up-who"){sheetCtx.p=b.dataset.who;upCompute();renderUpload();return;}
    if(a==="up-reset"){sheetCtx.S=null;sheetCtx.res=null;sheetCtx.err="";renderUpload();return;}
    if(a==="up-save"){upSave();return;}
  }
  if(a==="ver-del"){const id=+b.dataset.id;if(S.confirmDel&&S.confirmDel.id===id&&Date.now()-S.confirmDel.t<4000){S.confirmDel=null;delVersione(id);}else{S.confirmDel={id,t:Date.now()};renderAll();setTimeout(renderAll,4100);}return;}
  if(a==="tab"){S.tab=b.dataset.tab;renderAll();}
  else if(a==="who"){S.who=b.dataset.who;setPref("who",S.who);renderAll();}
  else if(a==="view"){S.view=b.dataset.view;setPref("view",S.view);renderAll();}
  else if(a==="day"){S.day=+b.dataset.d;renderAll();}
  else if(a==="week-prev"||a==="week-next"){S.week=iso(addDays(parseISO(S.week),a==="week-prev"?-7:7));DIETE=dieteDi(S.week);const ti=todayIdx();S.day=ti>=0?ti:0;closeSheet();subscribe();}
  else if(a==="cell")openSheet(b.dataset.p,+b.dataset.d,b.dataset.pid);
  else if(a==="close")closeSheet();
  else if(a==="variant")pickVariant(b.dataset.v);
  else if(a==="libero")toggleLibero();
  else if(a==="opt")pickOpt(b.dataset.pt,b.dataset.o);
  else if(a==="clear-meal"){const {p,d,pid}=sheetCtx;write(patchAt(p,d,pid,null));}
  else if(a==="fill-meal")fillMeal();
  else if(a==="autofill")autoFill();
  else if(a==="clear-week"){if(Date.now()-S.confirmClear<4000){S.confirmClear=0;clearWeek();}else{S.confirmClear=Date.now();renderAll();setTimeout(renderAll,4100);}}
  else if(a==="copy")copyList();
  else if(a==="hide-got"){S.hideGot=!S.hideGot;setPref("hideGot",S.hideGot?"1":"0");renderAll();}
  else if(a==="uncheck"){const sp={};for(const k in plan.spesa)sp[k]=null;write({spesa:sp});}
  else if(a==="extra-del"){const id=b.dataset.id;write({extra:{[id]:null},spesa:{["x-"+id]:null}});}
});
document.addEventListener("submit",e=>{
  if(e.target.dataset.form!=="extra")return;
  e.preventDefault(); addExtra(); $("extra-in")?.focus();
});
document.addEventListener("change",e=>{
  if(e.target.dataset&&e.target.dataset.file==="dieta"){upRead(e.target.files&&e.target.files[0]);return;}
  if(e.target.dataset&&e.target.dataset.change==="up-dal"&&sheetCtx&&sheetCtx.up){sheetCtx.dal=e.target.value;upCompute();renderUpload();return;}
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
    normalizeDiet(D);
    (next[r.persona]=next[r.persona]||[]).push({id:r.id||null,dal:r.dal||PRIMA,D,raw:r.dieta,fonte:r.fonte||"",caricato:r.caricato||r.aggiornato||""});
  }
  if(!PERSONE.every(p=>next[p]))return false;
  for(const p in next)next[p].sort((a,b)=>a.dal<b.dal?-1:a.dal>b.dal?1:0);
  VERS=next; DIETE=dieteDi(S.week); ready=true; return true;
}
async function loadDiete(){
  let {data,error}=await sb.from("diete_versioni").select("id,persona,dal,dieta,fonte,caricato");
  // Database non ancora aggiornato (manca la tabella delle versioni): si usano le diete di prima, senza caricamento.
  if(error&&!netErr(error)&&/diete_versioni|42P01|PGRST20/i.test((error.code||"")+" "+(error.message||""))){
    versioni=false; ({data,error}=await sb.from("diete").select("persona,dieta,aggiornato,fonte"));
  } else if(!error) versioni=true;
  if(error){ if(!ready){ sync="local"; loadMsg="Non riesco a caricare i piani: controlla la connessione e riapri l'app."; } renderAll(); return; }
  if(applyDiete(data)){ LS.set("diete",data); if(sheetCtx&&!sheetCtx.up&&!DIETE[sheetCtx.p].pasti[sheetCtx.pid])closeSheet(); }
  else if(!ready){
    const {data:me}=await sb.from("membri").select("persona").eq("user_id",user.id).maybeSingle();
    const mail=esc(user.email||"");
    if(!me) loadMsg=`<b>Account non abilitato</b>Hai fatto l'accesso come ${mail}, ma questo account non è nella tabella "membri" di Supabase.<br><br><button class="btn ghost" data-act="logout">Log out</button>`;
    else{
      const have=(data||[]).map(r=>r.persona), miss=PERSONE.filter(p=>!have.includes(p));
      loadMsg=`<b>Diete mancanti</b>Accesso come ${mail} (${esc(me.persona)}): ok. Su Supabase manca la dieta di ${esc(miss.join(" e "))}.<br><br><button class="btn ghost" data-act="logout">Log out</button>`;
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
  // All'apertura ognuno vede il proprio calendario (Matteo il suo, Anna il suo).
  const own=LS.get("persona:"+user.id); if(PERSONE.includes(own)) S.who=own;
  subscribe();
  await loadDiete();
  const {data:me}=await sb.from("membri").select("persona").eq("user_id",user.id).maybeSingle();
  if(me&&PERSONE.includes(me.persona)){ LS.set("persona:"+user.id,me.persona); if(S.who!==me.persona){ S.who=me.persona; renderAll(); } }
  if(chan) sb.removeChannel(chan);
  chan=sb.channel("app")
    .on("postgres_changes",{event:"*",schema:"public",table:"settimane"},p=>{const r=p.new;if(r&&r.settimana===S.week&&!queue.some(q=>q.week===S.week))applyRemote(S.week,r.dati);})
    .on("postgres_changes",{event:"*",schema:"public",table:"diete"},()=>loadDiete())
    .on("postgres_changes",{event:"*",schema:"public",table:"diete_versioni"},()=>loadDiete())
    .subscribe(st=>{if(st==="SUBSCRIBED"&&user)fetchWeek(S.week);});
  pump();
}
async function signOut(){
  try{ await sb.auth.signOut({scope:"local"}); }catch(e){}
  try{ for(const k of Object.keys(localStorage)) if(/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); }catch(e){}
  if(chan){ sb.removeChannel(chan); chan=null; }
  queue.length=0; LS.clear(); DIETE={}; VERS={}; ready=false; plan=emptyPlan(); user=null; closeSheet();
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

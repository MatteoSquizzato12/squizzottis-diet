/* Lettura dei PDF della nutrizionista (Nutrizone, "dieta con sostituzioni") nel formato dell'app.
   Tutto avviene nel telefono: il PDF non viene caricato da nessuna parte.
   Qui ci sono solo regole e un dizionario di alimenti generici: nessun dato personale.

   Come è fatto il PDF: ogni pasto ha un titolo in grassetto ("Colazione", "Colazione alternativa 1", "Pranzo"…),
   un'eventuale nota, poi le portate. Ogni portata comincia con un'icona a sinistra; a destra di ogni alimento
   c'è la grammatura e, se serve, la frequenza ("1/7"): una frequenza in grassetto apre un nuovo gruppo. */
(function(root){
"use strict";
const FV="Frutta e verdura", CP="Carne e pesce", SA="Salumi", LU="Latticini e uova", PC="Pane, pasta e cereali", DI="Dispensa";
const OLIO="Olio extravergine d'oliva", UOVA="Uova bio";
const key=s=>String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[’`]/g,"'").replace(/\s+/g," ").trim();
const slug=s=>key(s).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

/* Nome nel PDF → [nome nell'app, reparto della spesa, {s: nome in lista spesa, skip: non va in lista}] */
const NOMI={};
const N=(pdf,n,c,x)=>{NOMI[key(pdf)]=Object.assign({n,c},x||{});};
[["Caffe' in tazza","Caffè"],["Caffe' decaffeinato, in tazza","Caffè decaffeinato"],["Caffe' d'orzo in tazza","Caffè d'orzo"],
 ["Caffe' all'americana in tazza","Caffè americano"],["Te' in tazza","Tè"],["Tisana in tazza","Tisana"]].forEach(([a,b])=>N(a,b,DI));
N("Uova di gallina biologiche","Uova di gallina biologiche",LU,{s:UOVA});
N("Uova di gallina alla coque o occhio di bue","Uova alla coque o all'occhio di bue",LU,{s:UOVA});
N("Uova di gallina - albume","Albume d'uovo",LU);
N("Marmellata ridotto zucchero","Marmellata a ridotto zucchero",DI);
N("Yogurt bianco greco 0%","Yogurt greco bianco 0%",LU);
N("Yogurt bianco da latte - scremato","Yogurt bianco scremato",LU);
N("Yogurt di latte scremato alla frutta non zuccherat","Yogurt scremato alla frutta non zuccherato",LU);
N("Yogurt di latte scremato alla frutta non zuccherato","Yogurt scremato alla frutta non zuccherato",LU);
N("Frutta fresca (media)","Frutta fresca di stagione",FV);
N("Cocco - essiccato","Cocco essiccato",DI);
N("Mora","More",FV); N("Melagrane","Melagrana",FV); N("Ciliege","Ciliegie",FV);
N("Salmone in busta affumicato","Salmone affumicato",CP);
N("Cozza o mitilo","Cozze",CP); N("Vongola","Vongole",CP);
N("Pecorino da grattugiare","Pecorino grattugiato",LU);
N("Olio di oliva extra vergine estratto a freddo",OLIO,DI);
N("Olio di oliva extra vergine",OLIO,DI);
N("Acciughe Sotto Sale - Delicius","Acciughe sotto sale",DI);
N("Pollo intero - senza pelle","Pollo intero senza pelle",CP);
N("Pollo coscia - senza pelle","Coscia di pollo senza pelle",CP);
N("Tacchino petto","Petto di tacchino",CP);
N("Tacchino intero - senza pelle","Tacchino intero senza pelle",CP);
N("Frittata di verdure (zucchine, biete, ecc)","Frittata di verdure",LU);
N("Merluzzo o nasello surgelato - filetti","Filetti di merluzzo surgelati",CP);
N("Orata fresca","Orata",CP);
N("Vitello - filetto","Filetto di vitello",CP); N("Vitellone - fesa","Fesa di vitellone",CP); N("Vitellone - scamone","Scamone di vitellone",CP);
N("Vitellone - filetto","Filetto di vitellone (roast-beef)",CP);
N("Tonno al naturale sgocciolato","Tonno al naturale",DI);
N("Filetti di sgombro al naturale sgocciolato","Filetti di sgombro al naturale",DI);
N("Sgombro o maccarello fresco","Sgombro fresco",CP);
N("Sì&No snack al mais e riso - Fiorentini","Sì&No snack mais e riso",PC);
N("Sì&No snack con legumi croccanti - Fiorentini","Sì&No snack con legumi",PC);
N("Polenta","Polenta",PC,{s:"Farina per polenta"});
N("Minestrina (brodo + 30 g di pastina)","Minestrina",PC);
N("Minestrone + 30 g di pasta o riso","Minestrone con pasta o riso",PC);
N("Minestrone di sole verdure (senza patate e legumi)","Minestrone di sole verdure",FV);
N("Vellutata di sole verdure (senza patate o legumi)","Vellutata di sole verdure",FV);
N("Legumi cotti (media)","Legumi cotti",DI);
N("Fagiolini freschi","Fagiolini",FV); N("Funghi coltivati prataioli","Funghi prataioli",FV); N("Insalata ns","Insalata",FV);
N("Panna (da cucina)","Panna da cucina",LU);
N("Minestrone di verdure, patate e legumi","Minestrone di verdure, patate e legumi",FV); N("Brodo di pollo","Brodo di pollo",DI);
N("Vino da pasto","Vino rosso",DI);
N("Pepe nero","Pepe nero",DI,{skip:true}); N("Sale da cucina","Sale",DI,{skip:true});

/* Reparto della spesa quando l'alimento non è nel dizionario. */
const REPARTI=[
  [DI,/^crema |marmellat|sott'olio|^sugo|pesto|^olio|^olive|cioccolat|cocco|cannella|proteine|acciughe sotto sale|(tonno|sgombr[oi]) al naturale|legumi|ceci|lenticch|fagioli(?!ni)|miele|frutta secca|noci|mandorle|aceto|spezie/],
  [FV,/minestrone di sole|vellutata/],
  [SA,/prosciutto|bresaola|speck|salame|mortadella|affettat|coppa|lonza/],
  [CP,/pollo|tacchino|vitell|manzo|maiale|cavallo|carpaccio|roast|hamburger|tartare|spigola|branzino|merluzzo|nasello|dentice|orata|tonno|sgombro|salmone|pesce|polpo|calamar|seppia|gamber|cozz|vongol|ragu|coniglio|trota|platessa|sogliola|alici|sardin|carne/],
  [LU,/uov|albume|yogurt|skyr|latte|parmigiano|pecorino|grana|mozzarella|ricotta|formagg|stracchino|burro|panna|kefir|feta|primo sale|frittata|omelette/],
  [PC,/riso|pasta|\bpane\b|\bpan\b|farina|fette|wasa|grissin|cracker|gallett|cereal|cornflakes|avena|quinoa|miglio|sorgo|grano|orzo|farro|cous|polenta|pastina|minestr|si&no|piadin|gnocchi|patate|crostin|friselle/],
  [FV,/frutta|verdur|\bmela\b|\bmele\b|\bpera\b|\bpere\b|banan|kiwi|ananas|mango|melone|nespol|papaia|\bpesc[ah]e?\b|prugn|\buva\b|aranc|clementin|mandar|pompelm|fragol|lampon|\bmor[ae]\b|melagran|mirtill|ribes|albicocc|cilieg|cocomer|asparag|barbabietol|bieta|biete|broccol|carciof|carot|cavol|cetriol|cicori|cipoll|fagiolin|finocch|fungh|insalat|peperon|radicch|porr|\brape\b|ravanell|scarol|sedan|spinac|valerian|zucc|pomodor|avocado|prezzemol|rosmarin|basilic|lattug|rucol|melanzan|limon/]
];
function reparto(n){const k=key(n);for(const [c,re] of REPARTI)if(re.test(k))return c;return DI;}

/* "Ragù Alla Bolognese" → "Ragù alla bolognese", "Caffe'" → "Caffè", "… - Marca" → "…". */
function pulisci(s){
  s=s.replace(/\s+/g," ").trim().replace(/\s+-\s+[A-Z][\wà-ù]*$/,"");
  s=s.replace(/([aeiou])'(?=\s|$|,)/gi,(m,v)=>({a:"à",e:"è",i:"ì",o:"ò",u:"ù",A:"À",E:"È",I:"Ì",O:"Ò",U:"Ù"}[v]));
  if(s===s.toUpperCase()&&/[A-Z]/.test(s))s=s.toLowerCase();
  const w=s.split(" ");
  s=w.map((x,i)=>i&&/^[A-ZÀ-Ù][a-zà-ù]+$/.test(x)?x.toLowerCase():x).join(" ");
  s=s.replace(/ - /g," ");
  return s.charAt(0).toUpperCase()+s.slice(1);
}
function alimento(pdf){
  const d=NOMI[key(pdf)];
  if(d)return {n:d.n,c:d.c,s:d.s,skip:d.skip};
  const n=pulisci(pdf); return {n,c:reparto(n)};
}

/* "Due Cucchiai 20 g" → {g:20, t:"2 cucchiai"}; "Quanto basta" → {g:null}. */
const NUM={un:"1",uno:"1",una:"1",due:"2",tre:"3",quattro:"4",cinque:"5",sei:"6",sette:"7",otto:"8"};
const QTY=/^(?:(.*?)\s+)?(\d+(?:[.,]\d+)?)\s*(g|gr|ml)$|^(quanto basta|a piacere|q\.?b\.?)$/i;
function quantita(q){
  const m=String(q).trim().match(QTY); if(!m)return null;
  if(m[4])return {g:null};
  let t=(m[1]||"").toLowerCase().replace(/un quarto di/,"¼ di").replace(/\be mezz[oa]\b/,"e ½").replace(/^mezz[oa]\b/,"½").replace(/\b(un|uno|una|due|tre|quattro|cinque|sei|sette|otto)\b/g,w=>NUM[w]);
  return t?{g:Math.round(parseFloat(m[2].replace(",","."))),t}:{g:Math.round(parseFloat(m[2].replace(",",".")))};
}

/* ---------- 1. estrazione del testo e delle icone ---------- */
async function estrai(pdfjsLib, data){
  const doc=await pdfjsLib.getDocument({data, isEvalSupported:false}).promise, O=pdfjsLib.OPS, pages=[];
  const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  for(let n=1;n<=doc.numPages;n++){
    const pg=await doc.getPage(n), tc=await pg.getTextContent(), ops=await pg.getOperatorList();
    const bold={}; for(const it of tc.items)if(it.fontName&&!(it.fontName in bold)){let f=null;try{f=pg.commonObjs.get(it.fontName);}catch(e){} bold[it.fontName]=!!(f&&(/bold|black|heavy/i.test(f.name||"")||f.bold));}
    const icons=[]; const st=[[1,0,0,1,0,0]];
    ops.fnArray.forEach((f,i)=>{
      const a=ops.argsArray[i];
      if(f===O.save)st.push(st[st.length-1].slice());
      else if(f===O.restore){if(st.length>1)st.pop();}
      else if(f===O.transform)st[st.length-1]=mul(st[st.length-1],a);
      else if(f===O.paintImageXObject||f===O.paintInlineImageXObject||f===O.paintJpegXObject||f===O.paintImageMaskXObject){const m=st[st.length-1];icons.push({x:m[4],y:m[5],w:Math.abs(m[0]),h:Math.abs(m[3])});}
    });
    const items=tc.items.filter(it=>it.str&&it.str.trim()).map(it=>({x:it.transform[4],y:it.transform[5],s:it.str.replace(/\s+/g," ").trim(),b:bold[it.fontName]||false}));
    pages.push({n,items,icons:icons.filter(c=>c.w<60&&c.h<60&&c.x<80)});
    pg.cleanup();
  }
  await doc.destroy();
  return pages;
}

/* Righe: elementi alla stessa altezza; le icone diventano righe speciali appena sopra il primo alimento. */
function righe(page){
  const its=[...page.items].sort((a,b)=>b.y-a.y||a.x-b.x), out=[];
  for(const it of its){const r=out.find(r=>Math.abs(r.y-it.y)<=2.5);if(r)r.it.push(it);else out.push({y:it.y,it:[it]});}
  const rs=out.map(r=>{
    r.it.sort((a,b)=>a.x-b.x);
    const fr=r.it.find(i=>/^\d+\/\d+$/.test(i.s)), rest=r.it.filter(i=>i!==fr);
    let q=null; const last=rest[rest.length-1];
    if(rest.length>1&&last.x-rest[0].x>90&&quantita(last.s)){q=last.s;rest.pop();}
    return {y:r.y,x:rest.length?rest[0].x:r.it[0].x,txt:rest.map(i=>i.s).join(" ").replace(/\s+/g," ").trim(),
      bold:rest.length>0&&rest.every(i=>i.b),boldPart:rest.filter(i=>i.b).map(i=>i.s).join(" "),plainPart:rest.filter(i=>!i.b).map(i=>i.s).join(" "),
      q,fr:fr?{v:fr.s,b:fr.b}:null};
  });
  for(const c of page.icons)rs.push({y:c.y+c.h-4,icon:true});
  return rs.sort((a,b)=>b.y-a.y);
}

/* ---------- 2. dal testo alla struttura del PDF ---------- */
function struttura(pages){
  const info={paziente:"",data:"",studio:""}, sezioni=[], ricette=[];
  let sez=null, port=null, last=null, ric=null, inNota=false, modo="";
  for(const page of pages){
    const H=Math.max(...page.items.map(i=>i.y),800);
    for(const r of righe(page)){
      if(r.icon){ if(sez&&modo==="pasto"){port={opz:[]};sez.portate.push(port);last=null;inNota=false;} continue; }
      if(r.y>H-60){ if(/studionutrizone/i.test(r.txt))info.studio="Nutrizone"; continue; }
      if(r.y<45){ const d=r.txt.match(/^(\d{1,2}\/\d{1,2}\/\d{4})/); if(d&&!info.data)info.data=d[1]; continue; }
      const t=r.txt; if(!t)continue;
      const paz=t.match(/^(.*?)\s*\(Piano nutrizionale/i); if(paz){info.paziente=paz[1];continue;}
      if(/^\.{2,}\s*continua/i.test(t))continue;
      const ingr=r.bold&&t.match(/^Ingredienti per\s+\d+\s*g di\s+(.+)$/i);
      if(ingr){ric={nome:ingr[1],ingr:[]};ricette.push(ric);modo="ricetta";sez=null;port=null;last=null;continue;}
      if(r.boldPart&&!r.q&&!r.fr&&r.x>120&&r.boldPart.length<60&&!/^Ingredienti per/i.test(r.boldPart)){
        sez={titolo:r.boldPart.trim(),nota:[],portate:[]}; port=null; last=null; inNota=false;
        if(/^ingredienti ricette/i.test(sez.titolo)){modo="ricette";sez=null;continue;}
        sezioni.push(sez); modo="pasto";
        const n=r.plainPart.match(/^Nota:\s*(.*)$/i); if(n&&n[1])sez.nota.push(n[1]);
        continue;
      }
      if(modo==="ricetta"&&ric){
        if(r.q&&r.x>34){const a={nome:t,q:r.q};ric.ingr.push(a);last=a;}
        else if(!r.q&&r.x>34&&last&&ric.ingr.includes(last))last.nome+=" "+t;
        else last=null;
        continue;
      }
      if(modo!=="pasto"||!sez)continue;
      if(/^Nota:/i.test(t)){inNota=true;const s=t.replace(/^Nota:\s*/i,"");if(s)sez.nota.push(s);continue;}
      if(!port&&inNota&&!r.q&&!r.fr){sez.nota.push(t);continue;}
      if(r.q||r.fr){
        if(!port){port={opz:[]};sez.portate.push(port);}
        const o={nome:t,q:r.q,fr:r.fr}; port.opz.push(o); last=o; inNota=false; continue;
      }
      if(last&&port&&port.opz.includes(last)){last.nome+=" "+t;continue;}
    }
  }
  return {info,sezioni,ricette};
}

/* ---------- 3. dalla struttura al formato dell'app ---------- */
const PASTO_DI=[[/^colazione/i,"colazione"],[/^spuntino\s*pom/i,"merenda"],[/^spuntino/i,"spuntino"],[/^pranzo/i,"pranzo"],[/^merenda/i,"merenda"],[/^cena/i,"cena"]];
const NOMI_PASTI={colazione:"Colazione",spuntino:"Spuntino",pranzo:"Pranzo",merenda:"Merenda",cena:"Cena"};
const IGNORA=/^(durante la giornata|dieta con sostituzioni)/i;
const NOME_PORTATA={[FV]:"Frutta e verdura",[CP]:"Secondo",[SA]:"Salumi",[LU]:"Latticini e uova",[PC]:"Cereali e pane",[DI]:"Condimento"};
const isBev=n=>/^(caffe|te\b|te'|tè|tisana|camomilla|infuso)/i.test(key(n));
const sameSets=(a,b)=>{const B=new Set(b);let k=0;for(const x of a)if(B.has(x))k++;return {k,ov:k/Math.max(1,Math.min(a.length,b.length)),jac:k/Math.max(1,new Set([...a,...b]).size)};};
function abbina(nuovi,vecchi,ids){
  // Abbina ogni elemento nuovo a quello vecchio con più alimenti in comune (per tenere nomi e id di prima).
  const cand=[];
  nuovi.forEach((a,i)=>vecchi.forEach((b,j)=>{const s=sameSets(ids(a),ids(b));if(s.k)cand.push({i,j,ov:s.ov,jac:s.jac});}));
  cand.sort((x,y)=>y.ov-x.ov||y.jac-x.jac);
  const res=new Array(nuovi.length).fill(null), usati=new Set();
  for(const c of cand){if(res[c.i]!=null||usati.has(c.j)||c.ov<0.34)continue;res[c.i]=c.j;usati.add(c.j);}
  return res.map(j=>j==null?null:vecchi[j]);
}
const clone=x=>JSON.parse(JSON.stringify(x));
const qbVerdure=p=>p.opz.filter(o=>!o.g&&!o.lib&&(o.c||p.c)===FV).length;
const uniq=(id,set)=>{let x=id||"p",n=2;while(set.has(x))x=(id||"p")+"-"+n++;set.add(x);return x;};

function converti(S, prev){
  const avvisi=[], pasti={};
  prev=prev&&prev.pasti?prev:{pasti:{}};
  const perPasto={};
  for(const s of S.sezioni){
    const m=PASTO_DI.find(([re])=>re.test(s.titolo));
    if(!m){ if(!IGNORA.test(s.titolo)&&s.portate.length)avvisi.push(`La sezione "${s.titolo}" del PDF non corrisponde a un pasto dell'app: non l'ho usata.`); continue; }
    if(!s.portate.length)continue;
    (perPasto[m[1]]=perPasto[m[1]]||[]).push(s);
  }
  // Chi non ha una colazione nel PDF usa lo spuntino del mattino come colazione (come fa Matteo).
  if(!perPasto.colazione&&perPasto.spuntino){perPasto.colazione=perPasto.spuntino;delete perPasto.spuntino;avvisi.push("Il PDF non ha una colazione: lo spuntino del mattino è usato come colazione.");}
  // "ho eliminato le solanacee (pomodori, melanzane, peperoni)" → pomodor, melanzan, peperon
  const escluse=[], esclNomi=[], tenute=[];
  for(const s of S.sezioni){const m=s.nota.join(" ").match(/eliminat[oaie]\s+(?:\S+\s+){0,2}\(([^)]+)\)/i);if(m)m[1].split(/,|\se\s/).map(w=>w.trim()).filter(w=>w.length>2).forEach(w=>{const k=key(w).replace(/[aeiou]$/,"");if(!escluse.includes(k)){escluse.push(k);esclNomi.push(w);}});}

  for(const pid of Object.keys(NOMI_PASTI)){
    const sez=perPasto[pid]; if(!sez)continue;
    const P0=prev.pasti[pid]||{varianti:[]};
    const varianti=sez.map((s,vi)=>{
      const nota=s.nota.join(" ").replace(/\s+/g," ").trim();
      const portate=s.portate.filter(p=>p.opz.length).map(p=>{
        const opz=p.opz.map(o=>{
          if(/^pasto libero$/i.test(o.nome.trim()))return {n:"Pasto libero",g:null,lib:true,_fr:o.fr};
          const a=alimento(o.nome), q=quantita(o.q||"")||{g:null};
          const op={n:a.n,g:q.g}; if(q.t)op.t=q.t; if(a.s)op.s=a.s; op._c=a.c; op._fr=o.fr; return op;
        });
        return {opz};
      });
      return {s,nota,portate,vi};
    });
    // Abbinamento con le varianti della dieta precedente.
    const optNames=V=>V.portate.flatMap(p=>p.opz.map(o=>slug(o.n)));
    const vMatch=abbina(varianti,P0.varianti,V=>optNames(V));
    const vIds=new Set(), out=[], nAvvisi=avvisi.length;
    varianti.forEach((V,vi)=>{
      const V0=vMatch[vi];
      const isOlio=p=>p.opz.length===1&&p.opz[0].n===OLIO;
      // Nome dell'olio "in più" quando è una scelta tra altri condimenti.
      for(const p of V.portate)if(p.opz.length>1)for(const o of p.opz)if(o.n===OLIO){o.n="Olio EVO in più";o.s=OLIO;}
      const pMatch=abbina(V.portate,V0?V0.portate:[],p=>p.opz.map(o=>slug(o.n)));
      const ptIds=new Set(); let vmax=null;
      const portate=V.portate.map((p,pi)=>{
        const p0=pMatch[pi], pt={};
        const cats={}; p.opz.forEach(o=>{if(o._c)cats[o._c]=(cats[o._c]||0)+1;});
        const c=Object.keys(cats).sort((a,b)=>cats[b]-cats[a])[0]||DI;
        if(p.opz.every(o=>isBev(o.n))){pt.id=uniq("bevanda",ptIds);pt.nome="Bevanda";pt.noShop=true;pt.mini=true;}
        else if(isOlio(p)){pt.id=uniq(p0?p0.id:"olio",ptIds);pt.nome=p0?p0.nome:"Olio";pt.c=DI;}
        else if(p0){pt.id=uniq(p0.id,ptIds);pt.nome=p0.nome;pt.c=c;if(p0.noShop){pt.noShop=true;pt.mini=true;}}
        else{const nm=p.opz.length===1?p.opz[0].n:NOME_PORTATA[c];pt.id=uniq(slug(nm).split("-")[0],ptIds);pt.nome=nm;pt.c=c;}
        if(pt.noShop)delete pt.c;
        // Frequenze: una frequenza in grassetto apre un gruppo.
        const gruppi=[]; let g=null;
        for(const o of p.opz){if(!o._fr){continue;} if(o._fr.b||!g){g={max:parseInt(o._fr.v,10),opz:[]};gruppi.push(g);} g.opz.push(o);}
        if(gruppi.length===1&&gruppi[0].opz.length===p.opz.length){ vmax=Math.max(vmax||0,gruppi[0].max); }
        else if(gruppi.length){
          const old=p0&&p0.freq?Object.entries(p0.freq).map(([id,F])=>({id,nome:F.nome,opz:p0.opz.filter(o=>o.f===id).map(o=>slug(o.n))})):[];
          const gm=abbina(gruppi,old,x=>x.opz?x.opz.map(o=>typeof o==="string"?o:slug(o.n)):[]);
          pt.freq={}; const fIds=new Set();
          gruppi.forEach((G,gi)=>{
            const lib=G.opz.some(o=>o.lib);
            const id=uniq(lib?"libero":gm[gi]?gm[gi].id:slug(G.opz[0].n).split("-").slice(0,2).join("-"),fIds);
            pt.freq[id]={nome:lib?"Pasto libero":gm[gi]?gm[gi].nome:G.opz[0].n+(G.opz.length>1?" e simili":""),max:G.max};
            G.opz.forEach(o=>o.f=id);
          });
        }
        pt.opz=p.opz.map(o=>{const r={n:o.n,g:o.g};if(o.t)r.t=o.t;if(o.f)r.f=o.f;if(o.lib)r.lib=true;if(o.s)r.s=o.s;if(!pt.noShop&&o._c&&o._c!==pt.c)r.c=o._c;return r;});
        return pt;
      });
      // Portate facoltative aggiunte a mano nella dieta precedente: restano.
      // Lo stesso per quelle ricavate dalla nota (es. "1 cucchiaino di olio di cocco"), se la nota le cita ancora.
      if(V0)for(const p0 of V0.portate)if(!portate.some(p=>p.id===p0.id)&&(p0.opt||p0.opz.every(o=>key(V.nota).includes(key(o.n)))))portate.push(clone(p0));
      // Verdure a piacere: se il PDF non ne ha l'elenco, resta quello della dieta precedente
      // (senza le verdure che le note del PDF dicono di togliere, es. le solanacee).
      const vecchia=V0&&V0.portate.find(p=>!p.opt&&qbVerdure(p)>=3);
      if(vecchia&&!portate.some(p=>qbVerdure(p)>=3)){
        const ok=o=>!escluse.some(w=>key(o.n).startsWith(w));
        let pt=portate.find(p=>p.id===vecchia.id);
        if(pt){const have=new Set(pt.opz.map(o=>slug(o.n)));pt.opz=[...vecchia.opz.filter(o=>!o.g&&ok(o)&&!have.has(slug(o.n))).map(clone),...pt.opz];}
        else{pt=clone(vecchia);pt.opz=pt.opz.filter(ok);portate.splice(Math.min(V0.portate.indexOf(vecchia),portate.length),0,pt);}
        tenute.push(NOMI_PASTI[pid]+(sez.length>1?" ("+(V0.nome||"")+")":""));
      }
      const nomeBase=sez.length===1?NOMI_PASTI[pid]:V.nota&&V.nota.length<=30?V.nota:vi===0?NOMI_PASTI[pid]:"Alternativa "+vi;
      const nome=V0?V0.nome:nomeBase.charAt(0).toUpperCase()+nomeBase.slice(1);
      const v={id:uniq(V0?V0.id:sez.length===1?"std":slug(nome),vIds),nome};
      if(V.nota.length>30)v.nota=V.nota.replace(/\s*\.?$/,".");
      if(vmax&&sez.length>1)v.max=vmax;
      const dice=V.nota.match(/(\d+)\s*volte a settimana/i);
      if(v.max&&dice&&+dice[1]!==v.max)avvisi.push(`${NOMI_PASTI[pid]} – ${nome}: la nota dice ${dice[1]} volte a settimana, ma le frequenze del PDF dicono ${v.max}/7. L'app conta ${v.max} a settimana.`);
      v.portate=portate; out.push(v);
    });
    const tot=out.reduce((a,v)=>a+(v.max||0),0);
    if(out.every(v=>v.max)&&tot!==7&&avvisi.length===nAvvisi)avvisi.push(`${NOMI_PASTI[pid]}: le varianti sommano ${tot} volte a settimana invece di 7.`);
    pasti[pid]={nome:NOMI_PASTI[pid],varianti:out};
  }
  if(tenute.length)avvisi.push(`Il PDF non ha l'elenco delle verdure a piacere: tengo quello della dieta precedente (${tenute.join(", ")})${esclNomi.length?", senza "+esclNomi.join(", "):""}.`);
  for(const pid in prev.pasti)if(!pasti[pid])avvisi.push(`Nel nuovo PDF non c'è ${NOMI_PASTI[pid]?NOMI_PASTI[pid].toLowerCase():pid}: nell'app sparirà.`);
  if(!Object.keys(pasti).length)throw new Error("Nel PDF non ho trovato pasti: è un piano Nutrizone?");

  // Ricette: ingredienti per la lista della spesa, legate al nome dell'alimento nel piano.
  const nomiPiano=new Set(); for(const pid in pasti)for(const V of pasti[pid].varianti)for(const p of V.portate)for(const o of p.opz)nomiPiano.add(o.n);
  const ricette={};
  for(const r of S.ricette){
    const nome=alimento(r.nome).n; if(!nomiPiano.has(nome)||ricette[nome])continue;
    const ing=[]; for(const a of r.ingr){const al=alimento(a.nome),q=quantita(a.q);if(al.skip||!q||!q.g)continue;ing.push([al.s||al.n,q.g,al.c]);}
    if(ing.length)ricette[nome]=ing;
  }
  return {dieta:{pasti,ricette},info:S.info,avvisi};
}

/* ---------- 4. cosa cambia rispetto alla dieta precedente ---------- */
function confronta(prev,next){
  const out=[], lista=(a,max=6)=>a.length<=max?a.join(", "):a.slice(0,max).join(", ")+` e altri ${a.length-max}`;
  const P0=(prev&&prev.pasti)||{}, P1=next.pasti;
  for(const pid of Object.keys(NOMI_PASTI)){
    const A=P0[pid], B=P1[pid], r=[];
    if(!A&&!B)continue;
    if(!A){out.push({pasto:NOMI_PASTI[pid],righe:["Pasto nuovo"]});continue;}
    if(!B){out.push({pasto:NOMI_PASTI[pid],righe:["Tolto"]});continue;}
    for(const v of B.varianti){
      const v0=A.varianti.find(x=>x.id===v.id), tag=B.varianti.length>1||A.varianti.length>1?v.nome+": ":"";
      if(!v0){r.push(`Nuova variante: ${v.nome}`);continue;}
      if((v0.max||0)!==(v.max||0))r.push(`${tag}${v0.max||"–"} → ${v.max||"–"} volte a settimana`);
      for(const p of v.portate){
        const p0=v0.portate.find(x=>x.id===p.id);
        if(!p0){r.push(`${tag}nuova portata ${p.nome} (${lista(p.opz.map(o=>o.n),4)})`);continue;}
        const m0={};p0.opz.forEach(o=>m0[slug(o.n)]=o);
        const m1={};p.opz.forEach(o=>m1[slug(o.n)]=o);
        const add=p.opz.filter(o=>!m0[slug(o.n)]).map(o=>o.n), del=p0.opz.filter(o=>!m1[slug(o.n)]).map(o=>o.n);
        const gr=p.opz.filter(o=>{const x=m0[slug(o.n)];return x&&(x.g||null)!==(o.g||null);}).map(o=>`${o.n} ${m0[slug(o.n)].g||"q.b."} → ${o.g?o.g+" g":"q.b."}`);
        if(add.length)r.push(`${tag}${p.nome}, in più: ${lista(add)}`);
        if(del.length)r.push(`${tag}${p.nome}, tolti: ${lista(del)}`);
        if(gr.length)r.push(`${tag}${p.nome}: ${lista(gr,4)}`);
        if(p.freq||p0.freq)for(const id of new Set([...Object.keys(p.freq||{}),...Object.keys(p0.freq||{})])){
          const a=p0.freq&&p0.freq[id], b=p.freq&&p.freq[id];
          if(!a&&b)r.push(`${tag}nuovo gruppo ${b.nome}: ${b.max} a settimana`);
          else if(a&&!b)r.push(`${tag}tolto il gruppo ${a.nome}`);
          else if(a.max!==b.max)r.push(`${tag}${b.nome}: ${a.max} → ${b.max} a settimana`);
        }
      }
      for(const p0 of v0.portate)if(!v.portate.some(x=>x.id===p0.id))r.push(`${tag}tolta la portata ${p0.nome}`);
    }
    for(const v0 of A.varianti)if(!B.varianti.some(x=>x.id===v0.id))r.push(`Tolta la variante ${v0.nome}`);
    if(r.length)out.push({pasto:NOMI_PASTI[pid],righe:r});
  }
  return out;
}

const api={estrai,struttura,converti,confronta,leggi:async(pdfjsLib,data,prev)=>converti(struttura(await estrai(pdfjsLib,data)),prev)};
if(typeof module!=="undefined"&&module.exports)module.exports=api; else root.DietaPDF=api;
})(typeof window!=="undefined"?window:this);

// Crea l'SQL che carica le diete in Supabase (tabella diete_versioni).
// Uso: node sql-diete.js <diete.json> <diete.sql> <fonti.json> [dal]
//   fonti.json = {"matteo":"PDF … del gg/mm/aaaa","anna":"…"}; dal = lunedì da cui vale (aaaa-mm-gg), se manca vale "da sempre".
// Vengono caricate solo le persone presenti in fonti.json: per aggiornare una sola dieta basta indicare solo quella.
const fs = require("fs");
const [src, out, fontiPath, dal = "2000-01-03"] = process.argv.slice(2);
if (new Date(dal + "T12:00:00Z").getUTCDay() !== 1) throw new Error("dal deve essere un lunedì");
const fonti = JSON.parse(fs.readFileSync(fontiPath, "utf8"));
const { diete } = JSON.parse(fs.readFileSync(src, "utf8"));
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
let sql = "-- Carica le diete in Supabase. Contiene dati personali: NON va nel repository pubblico.\n-- Supabase → SQL Editor → New query → incolla → Run.\n\n";
for (const p of Object.keys(fonti)) {
  const json = JSON.stringify(diete[p]), fonte = fonti[p];
  if (!diete[p]) throw new Error("dieta non trovata per " + p);
  if (json.includes("$dieta$")) throw new Error("tag in collisione");
  sql += `insert into public.diete_versioni (persona, dal, dieta, fonte) values (${q(p)}, date ${q(dal)}, $dieta$${json}$dieta$::jsonb, ${q(fonte)})\n  on conflict (persona, dal) do update set dieta = excluded.dieta, fonte = excluded.fonte, caricato = now();\n\n`;
}
sql += "select persona, dal, fonte, caricato from public.diete_versioni order by 1, 2;\n";
fs.writeFileSync(out, sql);
console.log(out, sql.length, "caratteri");

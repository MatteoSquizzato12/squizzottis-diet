// Crea l'SQL che carica le diete in Supabase (archiviando la versione precedente, se c'è).
// Uso: node sql-diete.js <diete.json> <diete.sql> <fonti.json>   (fonti.json = {"matteo":"PDF … del gg/mm/aaaa","anna":"…"})
// Vengono caricate solo le persone presenti in fonti.json: per aggiornare una sola dieta basta indicare solo quella.
const fs = require("fs");
const [src, out, fontiPath] = process.argv.slice(2);
const fonti = JSON.parse(fs.readFileSync(fontiPath, "utf8"));
const { diete } = JSON.parse(fs.readFileSync(src, "utf8"));
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
let sql = "-- Carica le diete in Supabase. Contiene dati personali: NON va nel repository pubblico.\n-- Supabase → SQL Editor → New query → incolla → Run.\n\n";
for (const p of Object.keys(fonti)) {
  const json = JSON.stringify(diete[p]), fonte = fonti[p];
  if (!diete[p]) throw new Error("dieta non trovata per " + p);
  if (json.includes("$dieta$")) throw new Error("tag in collisione");
  sql += `insert into public.diete_archivio (persona, dieta, fonte) select persona, dieta, fonte from public.diete where persona = ${q(p)};\n`;
  sql += `insert into public.diete (persona, dieta, aggiornato, fonte) values (${q(p)}, $dieta$${json}$dieta$::jsonb, now(), ${q(fonte)})\n  on conflict (persona) do update set dieta = excluded.dieta, aggiornato = excluded.aggiornato, fonte = excluded.fonte;\n\n`;
}
sql += "select persona, aggiornato, fonte, jsonb_object_keys(dieta->'pasti') as pasto from public.diete order by 1;\n";
fs.writeFileSync(out, sql);
console.log(out, sql.length, "caratteri");

# Squizzotti's Diet

Web app installabile (PWA) per pianificare i pasti della settimana di Matteo e Anna e generare la lista della spesa.

- **Frontend**: file statici (`index.html`, `app.css`, `app.js`) pubblicati con GitHub Pages.
- **Dati**: Supabase. Diete, piani settimanali e spunte della spesa sono accessibili solo agli account abilitati (login + Row Level Security).
- **Offline**: il service worker (`sw.js`) tiene in memoria i file dell'app; le modifiche fatte senza rete restano in coda sul telefono e partono appena torna la connessione.

Questo repository è pubblico: **non contiene dati personali né chiavi segrete**. `config.js` contiene solo l'URL del progetto e la chiave *publishable*, pubbliche per definizione.

## Struttura

| File | Cosa fa |
|---|---|
| `index.html` | Pagina, schermata di accesso |
| `app.js` | Logica: piano, spesa, controllo frequenze, sincronizzazione con Supabase |
| `dieta-pdf.js` | Legge nel telefono il PDF della nutrizionista (Nutrizone) e lo converte nel formato della dieta |
| `app.css` | Stile (brand Allos) |
| `fonts/` | Akira Expanded Super Bold (titoli), usato con licenza web di Allos |
| `config.js` | URL e chiave publishable di Supabase |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installazione sul telefono e uso offline |
| `supabase/schema.sql` | Tabelle, regole di accesso e funzioni del database |
| `supabase/versioni-diete.sql` | Tabella `diete_versioni` (diete con data di inizio), da eseguire dopo `schema.sql` |

## Database

`supabase/schema.sql` va eseguito una volta nel SQL Editor di Supabase. Crea:

- `membri`: chi può usare l'app (user id → persona);
- `diete_versioni`: i piani per persona, in JSON, ognuno valido da un lunedì (`dal`) finché non ne arriva uno più recente; l'app li carica dal pulsante "Carica nuova dieta";
- `diete`, `diete_archivio`: il formato precedente (una dieta per persona), copiato in `diete_versioni` da `versioni-diete.sql`;
- `settimane`: per ogni lunedì, `{piano, spesa}`; l'app invia solo le modifiche tramite `aggiorna_settimana`, che le fonde lato server.

## Aggiornare una dieta

Dall'app: tendina **Account → Carica nuova dieta**. Si sceglie il PDF della nutrizionista, che viene letto nel telefono da `dieta-pdf.js` (PDF.js): le icone del PDF separano le portate, le frequenze in grassetto aprono i gruppi, un dizionario di alimenti dà nomi puliti e reparti della spesa. Nomi e id della dieta precedente vengono mantenuti dove gli alimenti coincidono, così le scelte già fatte nelle settimane restano valide. Prima di salvare si vedono avvisi e differenze; si sceglie di chi è la dieta e da che lunedì vale. Il PDF non viene caricato da nessuna parte: si salva solo la dieta convertita.

In alternativa, da SQL Editor: `strumenti/sql-diete.js` genera l'SQL a partire dal JSON delle diete e da un file con la fonte di ciascun piano. JSON e SQL generati contengono dati personali e restano fuori dal repository.

## Rilasciare una nuova versione

Dopo aver cambiato i file, aumentare `VERSION` in `sw.js`, poi commit e push su `main`.

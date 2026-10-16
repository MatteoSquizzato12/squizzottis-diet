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
| `app.css` | Stile (brand Allos) |
| `config.js` | URL e chiave publishable di Supabase |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installazione sul telefono e uso offline |
| `supabase/schema.sql` | Tabelle, regole di accesso e funzioni del database |

## Database

`supabase/schema.sql` va eseguito una volta nel SQL Editor di Supabase. Crea:

- `membri`: chi può usare l'app (user id → persona);
- `diete`: un piano per persona, in JSON (solo lettura per l'app; si aggiorna da SQL Editor);
- `diete_archivio`: versioni precedenti dei piani;
- `settimane`: per ogni lunedì, `{piano, spesa}`; l'app invia solo le modifiche tramite `aggiorna_settimana`, che le fonde lato server.

## Aggiornare una dieta

Il PDF della nutrizionista non passa dall'app: viene trascritto nel formato JSON della dieta e caricato nella tabella `diete` dal SQL Editor (la versione precedente va in `diete_archivio`).

## Rilasciare una nuova versione

Dopo aver cambiato i file, aumentare `VERSION` in `sw.js`, poi commit e push su `main`.

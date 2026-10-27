# Narratore 🎧📖

**Trasforma i tuoi PDF e documenti Word in audiolibri letti da una voce italiana naturale.**

Narratore è un'app web che funziona nel browser di telefono, tablet e computer. Apri un file, premi ▶ e ascolti: il testo scorre da solo con la frase in lettura evidenziata, come nelle app di audiolibri.

## Cosa sa fare

| | |
|---|---|
| 📄 **PDF e Word (.docx)** | Toglie intestazioni ripetute e numeri di pagina, ricompone le parole sillabate e i paragrafi, legge anche elenchi e tabelle. |
| 📚 **Capitoli** | Li ricava dall'indice del PDF, dagli stili «Titolo» di Word o da righe come «Capitolo 3», «Prologo», «IV». I documenti senza capitoli vengono divisi in sezioni. |
| 🔖 **Segnalibri e ripresa** | Ricorda per ogni libro il punto esatto in cui ti sei fermato; aggiungi segnalibri con un tocco. |
| ✨ **Evidenziato sul documento** | La frase letta si illumina direttamente sulle pagine originali del PDF o sul Word con la sua formattazione, e la pagina scorre da sola. Tocca una frase per far ripartire la lettura da lì. Con il pulsante ☰ in alto passi alla vista di solo testo. |
| ⏩ **Velocità** | Da 0,5× a 2× senza effetto «voce di cartone animato». |
| 🌙 **Timer di spegnimento** | 5 minuti – 1 ora oppure «fine capitolo», con dissolvenza finale. In pausa il timer si ferma. |
| 🎭 **Interpretazione espressiva** | Pause naturali (frase, paragrafo, capitolo), intonazione diversa per domande, esclamazioni, sospensioni e dialoghi; voce separata opzionale per le battute. |
| 🇮🇹 **Italiano corretto** | Legge bene abbreviazioni (*Sig.*, *Dott.ssa*, *ecc.*, *pag.*), numeri romani (*Luigi XIV*, *XIX secolo*, *Capitolo IV*), date (*12/03/2024*), orari, valute, percentuali, ordinali e numeri grandi. |
| 📱 **App installabile** | Si aggiunge alla schermata Home (iPhone e Android), funziona offline e si controlla dalla schermata di blocco e dalle cuffie. |
| 🔒 **Privato** | File, libreria e chiavi restano solo sul tuo dispositivo. |

## Le voci: come ottenere la più naturale

Narratore offre cinque motori vocali (Impostazioni ⚙️ › *Motore vocale*). Al primo avvio sceglie da solo il migliore disponibile.

| Motore | Qualità | Costo | Note |
|---|---|---|---|
| **Gemini** (Google AI Studio) | ★★★★★ | piano gratuito con limiti | Voci di Google Gemini dirette come un narratore italiano; legge un paragrafo per richiesta, con intonazione continua. |
| **ElevenLabs** | ★★★★★ | a pagamento | La voce più realistica, quella delle app di audiolibri professionali. Scegli una voce italiana dalla Voice Library di ElevenLabs. |
| **OpenAI** | ★★★★½ | a pagamento | Le chiediamo di leggere come un narratore italiano madrelingua e di recitare i dialoghi. |
| **Google Cloud** (Chirp 3 HD) | ★★★★½ | piano gratuito mensile ampio | Voci italiane HD molto naturali. |
| **Paola** (neurale, offline) | ★★★½ | gratis | Voce neurale italiana che gira nel browser. Si scarica una volta (~64 MB), poi funziona senza internet. |
| **Voci del dispositivo** | da ★★ a ★★★★ | gratis | Dipende dal sistema: vedi sotto. |

### Voci gratuite migliori per ogni dispositivo

- **Windows / Mac con Microsoft Edge** → le voci *Isabella*, *Elsa*, *Diego*, *Giuseppe* «Natural» sono neurali, gratuite e bellissime: Narratore le sceglie in automatico.
- **iPhone / iPad / Mac (Safari)** → *Impostazioni › Accessibilità › Contenuto letto ad alta voce › Voci › Italiano* e scarica **Federica (Premium)** o **Luca/Alice (Migliorata)**. Poi riapri Narratore.
- **Android (Chrome)** → *Impostazioni › Sistema › Lingue › Sintesi vocale › Google* e installa i dati vocali italiani in alta qualità.

### Chiavi API per i motori premium

- **Gemini**: aistudio.google.com › *Get API key* (gratuita). Con il piano gratuito, se si raggiunge il limite di richieste al minuto, la lettura aspetta qualche secondo e riprende da sola.
- **ElevenLabs**: elevenlabs.io › *Developers › API Keys*. Aggiungi alla tua libreria almeno una voce italiana (Voice Library, filtro lingua *Italiano*).
- **OpenAI**: platform.openai.com › *API keys*.
- **Google Cloud**: console.cloud.google.com › attiva *Cloud Text-to-Speech API* › *Credenziali › Crea chiave API*.

La chiave si incolla in Impostazioni e resta salvata solo nel browser. Con i motori premium il testo del libro viene inviato al servizio scelto per generare l'audio.

## Pubblicare l'app (GitHub Pages)

Il repository contiene già il workflow `.github/workflows/deploy.yml` che a ogni push esegue tutti i test, crea l'app e la pubblica.

1. Su GitHub apri **Settings › Pages** del repository.
2. In *Build and deployment › Source* scegli **GitHub Actions**.
3. Fai un push sul branch predefinito (o avvia il workflow da *Actions › Test e pubblicazione › Run workflow*).

L'app sarà su `https://<utente>.github.io/<nome-repository>/`. Aprila dal telefono e usa *Condividi › Aggiungi a Home* per averla come un'app.

## Sviluppo

Requisiti: Node.js 20+.

```bash
npm install
npm run dev        # server di sviluppo su http://localhost:5173
npm test           # test unitari (testo italiano, PDF, Word, player, voci)
npm run build      # build di produzione in dist/
npm run test:e2e   # test end-to-end nel browser (richiede Playwright e una build)
```

### Struttura

```
src/
  main.js              interfaccia: libreria, lettore, impostazioni, segnalibri, timer
  player.js            il narratore: coda delle frasi, pre-caricamento audio, pause espressive
  book.js              capitoli → paragrafi → frasi
  text/
    normalize-it.js    testo scritto → testo da pronunciare in italiano
    numbers-it.js      numeri in lettere, ordinali, numeri romani
    segment.js         divisione in frasi, dialoghi, tono della frase
  parsers/
    pdf.js             righe, paragrafi, intestazioni, sillabazione, indice del PDF
    docx.js            Word tramite mammoth, con titolo e autore
  engines/
    webspeech.js       voci del dispositivo (con classifica di naturalezza)
    piper.js           voce neurale offline in un Web Worker
    cloud.js           Gemini, OpenAI, ElevenLabs, Google Cloud
  views/
    align.js           trova ogni frase nel testo del documento originale
    pdf-view.js        pagine del PDF con la frase evidenziata
    docx-view.js       documento Word formattato con la frase evidenziata
  storage.js           libreria, progressi e segnalibri (IndexedDB)
  sleep-timer.js       timer di spegnimento
tests/                 test unitari (Vitest) ed end-to-end (Playwright)
```

## Limiti noti

- I **PDF scansionati** (immagini senza testo selezionabile) non si possono leggere: serve prima un OCR.
- Il vecchio formato **.doc** non è supportato: salvalo come .docx.
- Su **iPhone con le voci del dispositivo** la lettura di solito si ferma quando lo schermo si blocca (limite di iOS). Con Paola o i motori premium l'audio passa dal lettore multimediale del sistema, pensato per continuare anche a schermo bloccato (non ancora provato su un iPhone reale).
- I PDF impaginati su più colonne possono avere l'ordine delle frasi meno preciso.

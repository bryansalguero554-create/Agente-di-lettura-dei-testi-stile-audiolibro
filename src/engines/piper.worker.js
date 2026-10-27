// Worker che esegue la sintesi neurale Piper fuori dal thread principale,
// così l'interfaccia resta fluida mentre la frase successiva viene preparata.

import { TtsSession, flush } from '@mintplex-labs/piper-tts-web';

let session = null;
let queue = Promise.resolve();

async function handle({ type, id, ...data }) {
  if (type === 'init') {
    session = await TtsSession.create({
      voiceId: data.voiceId,
      wasmPaths: data.wasmPaths,
      progress: (p) => {
        if (p.url?.endsWith('.onnx')) self.postMessage({ type: 'progress', loaded: p.loaded, total: p.total });
      },
    });
    self.postMessage({ type: 'ready', id });
  } else if (type === 'synth') {
    const blob = await session.predict(data.text);
    self.postMessage({ type: 'audio', id, blob });
  } else if (type === 'flush') {
    await flush();
    self.postMessage({ type: 'flushed', id });
  }
}

// le richieste vengono eseguite una alla volta: la sessione ONNX non è rientrante
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data)).catch((err) => {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message || err) });
  });
};

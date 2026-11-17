// Gera os áudios das falas do Professor com o ElevenLabs (uma vez só; depois ficam salvos).
//
// Uso:  node gerar-falas.js            gera o que falta
//       node gerar-falas.js --teste    gera só a primeira fala (pra ouvir a voz)
//       node gerar-falas.js --contar   só mostra quantos caracteres vai gastar
//
// Lê as falas de publico/falas.json e os desenhos de publico/desenhos/desenhos.json
// (as falas com {p} viram uma por desenho: "Era TARTARUGA!").
// Salva em publico/audio/falas/ e escreve o índice publico/audio/falas/indice.json.
// A chave fica no .env da raiz da Fire Code (ELEVENLABS_API_KEY), nunca no código.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUB = path.join(__dirname, 'publico');
const PASTA = path.join(PUB, 'audio', 'falas');
const falas = JSON.parse(fs.readFileSync(path.join(PUB, 'falas.json'), 'utf8'));
const desenhos = JSON.parse(fs.readFileSync(path.join(PUB, 'desenhos', 'desenhos.json'), 'utf8'));
const TESTE = process.argv.includes('--teste');
const CONTAR = process.argv.includes('--contar');

function chave(nome) {
  if (process.env[nome]) return process.env[nome];
  let pasta = __dirname;
  for (let i = 0; i < 6; i++) {
    const arq = path.join(pasta, '.env');
    if (fs.existsSync(arq)) {
      const linha = fs.readFileSync(arq, 'utf8').split(/\r?\n/).find(l => l.startsWith(nome + '='));
      if (linha) return linha.slice(nome.length + 1).trim().replace(/^"|"$/g, '');
    }
    pasta = path.dirname(pasta);
  }
}

// Todas as frases que precisam de áudio
const textos = new Set();
for (const lista of Object.values(falas.grupos)) {
  for (const f of lista) {
    if (f.texto.includes('{p}')) desenhos.forEach(d => textos.add(f.texto.replace('{p}', d.palavra.toUpperCase())));
    else textos.add(f.texto);
  }
}

const v = falas.voz;
const nomeArquivo = t => crypto.createHash('sha1').update(`${v.id}|${v.modelo}|${JSON.stringify(v.ajustes)}|${t}`).digest('hex').slice(0, 12) + '.mp3';

async function gerar(texto, arquivo) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.id}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': chave('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json' },
    // O texto vai em minúsculas na voz pra ela não soletrar palavras em CAIXA ALTA.
    body: JSON.stringify({ text: texto.replace(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ-]{2,}\b/g, s => s.toLowerCase()), model_id: v.modelo, voice_settings: v.ajustes }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  fs.writeFileSync(arquivo, Buffer.from(await r.arrayBuffer()));
}

(async () => {
  fs.mkdirSync(PASTA, { recursive: true });
  const lista = [...textos];
  // --refazer: gera tudo de novo (ex.: depois de assinar o plano pago, pra ter licença comercial)
  const REFAZER = process.argv.includes('--refazer');
  const faltam = lista.filter(t => REFAZER || !fs.existsSync(path.join(PASTA, nomeArquivo(t))));
  const caracteres = faltam.reduce((s, t) => s + t.length, 0);
  console.log(`${lista.length} falas no total, ${faltam.length} sem áudio (${caracteres} caracteres).`);
  if (CONTAR) return;
  if (!chave('ELEVENLABS_API_KEY')) throw new Error('Falta ELEVENLABS_API_KEY no .env');

  const fazer = TESTE ? faltam.slice(0, 1) : faltam;
  for (const t of fazer) {
    process.stdout.write(`  gerando: ${t} ... `);
    await gerar(t, path.join(PASTA, nomeArquivo(t)));
    console.log('ok');
  }

  // índice: texto -> arquivo (só os que existem)
  const indice = {};
  for (const t of lista) if (fs.existsSync(path.join(PASTA, nomeArquivo(t)))) indice[t] = nomeArquivo(t);
  fs.writeFileSync(path.join(PASTA, 'indice.json'), JSON.stringify(indice, null, 2));
  console.log(`Pronto. ${Object.keys(indice).length} falas com áudio em publico/audio/falas/`);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });

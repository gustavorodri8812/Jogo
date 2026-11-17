// Voz do Professor feita pelo SITE do ElevenLabs (o plano grátis só libera as vozes brasileiras
// no site, não pelo programa). Fluxo:
//
//   1) node voz-site.js roteiro
//        Cria voz/roteiro-parte-1.txt e voz/roteiro-parte-2.txt: todas as falas, uma por parágrafo.
//   2) No site do ElevenLabs: colar o roteiro de uma parte, escolher a voz, gerar e baixar o MP3.
//   3) node voz-site.js dividir 1 "C:\Users\...\Downloads\arquivo.mp3"
//        Acha cada fala pela transcrição, corta uma por arquivo, iguala o volume e coloca no jogo
//        (publico/audio/falas/ + indice.json). Repetir pra parte 2.
//
// Precisa do ffmpeg instalado. O corte usa a transcrição do ElevenLabs (tempo de cada palavra),
// então funciona mesmo se a voz não fizer pausa entre as falas.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PUB = path.join(__dirname, 'publico');
const PASTA_AUDIO = path.join(PUB, 'audio', 'falas');
const PASTA_ROTEIRO = path.join(__dirname, 'voz');
const falas = JSON.parse(fs.readFileSync(path.join(PUB, 'falas.json'), 'utf8'));
const desenhos = JSON.parse(fs.readFileSync(path.join(PUB, 'desenhos', 'desenhos.json'), 'utf8'));
// Falas separadas por linha em branco. (As pausas <break> faziam a voz soltar "Ôôôw" e "Hmmm" estranhos.)

// Linhas de uma parte: { mostrar (texto do balão/índice), falar (texto pra voz) }
function linhas(parte) {
  const out = [];
  for (const grupo of falas.partes[parte] || []) {
    for (const f of falas.grupos[grupo]) {
      if (f.texto.includes('{p}')) {
        for (const d of desenhos) out.push({ mostrar: f.texto.replace('{p}', d.palavra.toUpperCase()), falar: f.texto.replace('{p}', d.palavra) });
      } else out.push({ mostrar: f.texto, falar: f.texto });
    }
  }
  return out;
}

function roteiro() {
  fs.mkdirSync(PASTA_ROTEIRO, { recursive: true });
  for (const parte of Object.keys(falas.partes)) {
    const ls = linhas(parte);
    const texto = ls.map(l => l.falar).join('\n\n');
    const arq = path.join(PASTA_ROTEIRO, `roteiro-parte-${parte}.txt`);
    fs.writeFileSync(arq, texto + '\n', 'utf8');
    console.log(`Parte ${parte}: ${ls.length} falas, ${texto.length} caracteres -> ${arq}`);
  }
}

// ---------- transcrição (ElevenLabs Speech to Text, com o tempo de cada palavra) ----------
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

async function transcrever(mp3) {
  const fd = new FormData();
  fd.append('model_id', 'scribe_v1');
  fd.append('language_code', 'por');
  fd.append('timestamps_granularity', 'word');
  fd.append('file', new Blob([fs.readFileSync(mp3)]), 'audio.mp3');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': chave('ELEVENLABS_API_KEY') }, body: fd });
  if (!r.ok) throw new Error(`Transcrição falhou (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).words.filter(w => w.type === 'word');
}

const norm = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const parecida = (a, b) => a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) || lev(a, b) <= (Math.max(a.length, b.length) >= 6 ? 2 : 1);

// Alinha as palavras esperadas (roteiro) com as faladas (transcrição) e devolve início/fim de cada fala.
function alinhar(ls, palavras) {
  const esp = [];
  ls.forEach((l, i) => l.falar.split(/\s+/).map(norm).filter(Boolean).forEach(tok => esp.push({ tok, linha: i })));
  const fal = palavras.map(w => ({ tok: norm(w.text), ini: w.start, fim: w.end })).filter(w => w.tok);
  const n = esp.length, m = fal.length;
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) D[i][0] = i;
  for (let j = 1; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (parecida(esp[i - 1].tok, fal[j - 1].tok) ? 0 : 1.5));
  const trechos = ls.map(() => ({ ini: Infinity, fim: -Infinity }));
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const casou = parecida(esp[i - 1].tok, fal[j - 1].tok);
    if (D[i][j] === D[i - 1][j - 1] + (casou ? 0 : 1.5)) {
      if (casou) { const t = trechos[esp[i - 1].linha]; t.ini = Math.min(t.ini, fal[j - 1].ini); t.fim = Math.max(t.fim, fal[j - 1].fim); }
      i--; j--;
    } else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  return trechos;
}

async function dividir(parte, mp3) {
  if (!mp3 || !fs.existsSync(mp3)) throw new Error(`Não achei o áudio: ${mp3}`);
  const ls = linhas(parte);
  if (!ls.length) throw new Error(`Parte ${parte} não existe.`);
  const total = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString());

  console.log('Transcrevendo pra achar cada fala...');
  const trechos = alinhar(ls, await transcrever(mp3));
  const faltando = ls.filter((l, i) => !isFinite(trechos[i].ini));
  if (faltando.length) throw new Error('Não achei estas falas no áudio: ' + faltando.map(l => l.mostrar).join(' | '));

  fs.mkdirSync(PASTA_AUDIO, { recursive: true });
  const arqIndice = path.join(PASTA_AUDIO, 'indice.json');
  const indice = fs.existsSync(arqIndice) ? JSON.parse(fs.readFileSync(arqIndice, 'utf8')) : {};

  ls.forEach((l, i) => {
    const prox = trechos[i + 1]?.ini ?? total;
    const ant = trechos[i - 1]?.fim ?? 0;
    const ini = Math.max(ant + 0.02, trechos[i].ini - 0.06);
    const fim = Math.min(prox - 0.02, trechos[i].fim + 0.18, total);
    const nome = 'f-' + crypto.createHash('sha1').update(l.mostrar).digest('hex').slice(0, 10) + '.mp3';
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', ini.toFixed(3), '-t', (fim - ini).toFixed(3), '-i', mp3,
      '-af', 'afade=t=in:d=0.03,areverse,afade=t=in:d=0.06,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar', '44100', '-b:a', '128k', path.join(PASTA_AUDIO, nome)]);
    indice[l.mostrar] = nome;
    console.log(`  ${String(i + 1).padStart(2)}. ${ini.toFixed(2)}s-${fim.toFixed(2)}s  ${l.mostrar}`);
  });
  fs.writeFileSync(arqIndice, JSON.stringify(indice, null, 2));
  console.log(`
Pronto: ${ls.length} falas da parte ${parte} no jogo.`);
}

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'roteiro') roteiro();
  else if (cmd === 'dividir') return dividir(a, b).catch(e => { console.error('❌', e.message); process.exit(1); });
  else console.log('Uso: node voz-site.js roteiro  |  node voz-site.js dividir <parte> <arquivo.mp3>');
} catch (e) { console.error('❌', e.message); process.exit(1); }

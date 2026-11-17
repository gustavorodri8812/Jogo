// Gera as músicas de fundo do Professor Maluco, sintetizadas do zero (sem direito autoral de ninguém).
//
//   node gerar-musica.js            -> cria as 3 faixas em publico/audio/musica/ (mp3)
//
// Cada faixa tem ~1min30 e começa/termina suave, então tocam uma atrás da outra sem susto.
// Instrumentos feitos por conta: marimba, sininho (glockenspiel), corda dedilhada, baixo
// pizzicato, bumbo, palma e chocalho. Precisa do ffmpeg instalado (já usado pela voz).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SR = 44100;
const PASTA = path.join(__dirname, 'publico', 'audio', 'musica');
const hz = m => 440 * 2 ** ((m - 69) / 12);

// ---------- sorteio fixo (a música sai igual toda vez) ----------
let semente = 1;
const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);

// ---------- instrumentos: cada um devolve as amostras de uma nota ----------
function amostras(seg, fn) {
  const n = Math.ceil(seg * SR), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i);
  return out;
}
const TAU = 2 * Math.PI;

const inst = {
  marimba: f => amostras(0.9, t =>
    Math.sin(TAU * f * t) * Math.exp(-t * 7) +
    0.32 * Math.sin(TAU * 3.99 * f * t) * Math.exp(-t * 26) +
    0.12 * Math.sin(TAU * 9.8 * f * t) * Math.exp(-t * 90)),

  sininho: f => amostras(1.6, t =>
    Math.sin(TAU * f * t) * Math.exp(-t * 2.6) +
    0.38 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t * 6) +
    0.18 * Math.sin(TAU * 5.4 * f * t) * Math.exp(-t * 13)),

  // corda dedilhada (Karplus-Strong): parece cavaquinho/violão de brinquedo
  corda: (f, dur = 1.1) => {
    const n = Math.ceil(dur * SR), out = new Float32Array(n);
    const N = Math.max(2, Math.round(SR / f)), linha = new Float32Array(N);
    for (let i = 0; i < N; i++) linha[i] = rnd() * 2 - 1;
    let p = 0;
    for (let i = 0; i < n; i++) {
      const a = linha[p], b = linha[(p + 1) % N];
      out[i] = a;
      linha[p] = 0.4985 * (a + b);
      p = (p + 1) % N;
    }
    for (let i = 0; i < 80 && i < n; i++) out[i] *= i / 80;
    return out;
  },

  baixo: (f, dur) => amostras(Math.min(dur, 0.6) + 0.08, t => {
    const env = Math.min(1, t / 0.006) * Math.exp(-t * 5) * (t > Math.min(dur, 0.6) ? Math.exp(-(t - Math.min(dur, 0.6)) * 60) : 1);
    return env * (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t) + 0.12 * Math.sin(TAU * 3 * f * t));
  }),

  bumbo: () => amostras(0.32, t => {
    const fase = TAU * (45 * t + (75 / 18) * (1 - Math.exp(-t * 18)));
    return Math.sin(fase) * Math.exp(-t * 13);
  }),

  palma: () => {
    let ant = 0;
    return amostras(0.22, t => {
      const x = rnd() * 2 - 1, y = x - ant; ant = x;
      const env = Math.exp(-t * 22) * (1 + 0.6 * (t < 0.012 ? Math.sin(t * 800) : 0));
      return y * env * 0.7;
    });
  },

  chocalho: () => {
    let ant = 0;
    return amostras(0.07, t => { const x = rnd() * 2 - 1, y = x - ant; ant = x; return y * Math.min(1, t / 0.004) * Math.exp(-t * 55) * 0.5; });
  },
};

// ---------- mixagem ----------
function novaMix(seg) {
  const n = Math.ceil(seg * SR);
  return { L: new Float32Array(n), R: new Float32Array(n), revL: new Float32Array(n), revR: new Float32Array(n) };
}
function tocar(mix, t, som, { vol = 1, pan = 0, rev = 0 } = {}) {
  const gl = Math.cos((pan + 1) * Math.PI / 4) * vol, gr = Math.sin((pan + 1) * Math.PI / 4) * vol;
  const i0 = Math.round(t * SR);
  for (let i = 0; i < som.length; i++) {
    const k = i0 + i;
    if (k < 0) continue;
    if (k >= mix.L.length) break;
    mix.L[k] += som[i] * gl; mix.R[k] += som[i] * gr;
    if (rev) { mix.revL[k] += som[i] * gl * rev; mix.revR[k] += som[i] * gr * rev; }
  }
}

// Reverb simples (Schroeder): 4 ecos que se repetem + 2 difusores, um pouco diferentes em cada lado.
function reverb(entrada, desvio) {
  const n = entrada.length, saida = new Float32Array(n);
  for (const [ms, fb] of [[29.7, 0.77], [37.1, 0.75], [41.1, 0.73], [43.7, 0.71]]) {
    const d = Math.round((ms + desvio) * SR / 1000), buf = new Float32Array(d);
    let p = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const y = buf[p];
      lp = y * 0.6 + lp * 0.4;           // escurece o eco
      buf[p] = entrada[i] + lp * fb;
      saida[i] += y * 0.25;
      p = (p + 1) % d;
    }
  }
  for (const ms of [5, 1.7]) {
    const d = Math.round((ms + desvio / 10) * SR / 1000), buf = new Float32Array(d);
    let p = 0;
    for (let i = 0; i < n; i++) {
      const b = buf[p], x = saida[i];
      const y = -0.7 * x + b;
      buf[p] = x + 0.7 * y;
      saida[i] = y;
      p = (p + 1) % d;
    }
  }
  return saida;
}

// ---------- harmonia ----------
const TIPOS = { M: [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11] };
const ESCALAS = { maior: [0, 2, 4, 5, 7, 9, 11], menor: [0, 2, 3, 5, 7, 8, 10], menorH: [0, 2, 3, 5, 7, 8, 11] };
function acorde(txt) {           // "C", "Am", "G7", "Dm7", "FM7", "E7", "Bb"
  const m = txt.match(/^([A-G])(b|#)?(m7|m|M7|7)?$/);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
  return { raiz: base, notas: TIPOS[m[3] || 'M'] };
}

// Ritmos da melodia (posições em semicolcheias dentro do compasso de 16)
const RITMOS = [
  [0, 4, 6, 8, 12],
  [0, 2, 4, 8, 10, 12],
  [0, 3, 6, 8, 11, 12, 14],
  [0, 6, 8, 12, 14],
  [0, 4, 8, 10, 12, 14],
  [0, 8, 10, 12],
];

// Melodia de 4 compassos: um motivo de 2 compassos e a resposta com o mesmo ritmo e o mesmo
// desenho (sobe/desce), ajustada aos acordes, terminando na nota principal do acorde.
function frase(faixa, acordes, ritmoSem) {
  semente = ritmoSem;
  const escala = [];
  for (let o = 0; o < 3; o++) for (const g of ESCALAS[faixa.escala]) escala.push(faixa.tom + 12 * o + g);
  const perto = (alvo, permitidas) => {
    let melhor = 0, dist = 1e9;
    escala.forEach((m, i) => { const ok = !permitidas || permitidas.includes(((m % 12) + 12) % 12); const d = Math.abs(m - alvo); if (ok && d < dist) { dist = d; melhor = i; } });
    return melhor;
  };
  const ritmo = [RITMOS[Math.floor(rnd() * RITMOS.length)], RITMOS[Math.floor(rnd() * RITMOS.length)]];
  const passos = [];
  for (const r of ritmo) for (let k = 0; k < r.length; k++) {
    const x = rnd();
    passos.push(x < 0.12 ? 0 : x < 0.62 ? (rnd() < 0.5 ? 1 : -1) : x < 0.9 ? (rnd() < 0.5 ? 2 : -2) : (rnd() < 0.5 ? 3 : -3));
  }
  const notas = [];
  const centro = faixa.tom + 12 + faixa.altura;
  for (const metade of [0, 1]) {
    let idx = perto(centro + (metade ? 2 : 0));
    let q = 0;
    for (let c = 0; c < 2; c++) {
      const comp = metade * 2 + c, ac = acorde(acordes[comp]);
      const doAcorde = ac.notas.map(n => (ac.raiz + n) % 12);
      const r = ritmo[c];
      for (let k = 0; k < r.length; k++, q++) {
        idx = Math.max(3, Math.min(escala.length - 4, idx + passos[q]));
        if (escala[idx] > centro + 9) idx -= 2;
        if (escala[idx] < centro - 7) idx += 2;
        const forte = r[k] % 8 === 0;
        if (forte) idx = perto(escala[idx], doAcorde);
        const ultima = metade === 1 && c === 1 && k === r.length - 1;
        if (ultima) idx = perto(escala[idx], [ac.raiz % 12]);
        const fim = k + 1 < r.length ? r[k + 1] : 16;
        notas.push({ compasso: comp, pos: r[k], dur: fim - r[k], midi: escala[idx] });
      }
    }
  }
  return notas;
}

// ---------- as 3 faixas ----------
const FAIXAS = [
  {
    nome: 'professor-laboratorio', bpm: 112, tom: 60, escala: 'maior', altura: 0, balanço: 0.14,
    acordes: ['C', 'Am', 'Dm7', 'G7'],
    melodia: 'marimba', resposta: 'sininho', acomp: 'corda',
    secoes: [['intro', 4], ['A', 8], ['B', 8], ['pausa', 4], ['A', 8], ['B', 8], ['fim', 4]],
  },
  {
    nome: 'professor-recreio', bpm: 126, tom: 65, escala: 'maior', altura: 0, balanço: 0.1,
    acordes: ['F', 'Dm', 'Bb', 'C7'],
    melodia: 'sininho', resposta: 'marimba', acomp: 'marimba',
    secoes: [['intro', 4], ['A', 8], ['B', 8], ['pausa', 4], ['A', 8], ['B', 8], ['fim', 4]],
  },
  {
    nome: 'professor-prova-surpresa', bpm: 100, tom: 57, escala: 'menorH', altura: 0, balanço: 0.22,
    acordes: ['Am', 'E7', 'Am', 'Dm', 'F', 'E7', 'Am', 'E7'],
    melodia: 'corda', resposta: 'marimba', acomp: 'marimba', pezinho: true,
    secoes: [['intro', 4], ['A', 8], ['B', 8], ['pausa', 4], ['A', 8], ['B', 8], ['fim', 4]],
  },
];

function gerarFaixa(faixa, numero) {
  const comp = 60 / faixa.bpm * 4, semi = comp / 16;
  const total = faixa.secoes.reduce((s, [, n]) => s + n, 0);
  const seg = total * comp + 2.5;
  const mix = novaMix(seg);
  const quando = (c, pos) => c * comp + pos * semi + (pos % 2 ? faixa.balanço * semi : 0);

  // melodias (geradas uma vez por faixa e repetidas, como num refrão)
  const progr = c => faixa.acordes[c % faixa.acordes.length];
  const blocoA = [0, 1, 2, 3].map(c => progr(c)), blocoB = [4, 5, 6, 7].map(c => progr(c));
  const melA = [...frase(faixa, blocoA, 11 + numero * 100), ...frase(faixa, blocoB, 23 + numero * 100).map(n => ({ ...n, compasso: n.compasso + 4 }))];
  const melB = [...frase(faixa, blocoA, 37 + numero * 100), ...frase(faixa, blocoB, 41 + numero * 100).map(n => ({ ...n, compasso: n.compasso + 4 }))];
  semente = 99 + numero;

  let c0 = 0;
  for (const [secao, n] of faixa.secoes) {
    for (let c = c0; c < c0 + n; c++) {
      const ac = acorde(progr(c));
      const raizBaixo = 36 + ((ac.raiz - 36 % 12 + 12) % 12) + (ac.raiz > 7 ? -12 : 0) + 12;
      const local = c - c0;
      const cheio = secao === 'A' || secao === 'B';

      // acompanhamento: acordes nos contratempos
      for (const pos of faixa.pezinho ? [2, 6, 10, 14] : [4, 12, 14]) {
        if (secao === 'fim' && local === n - 1 && pos > 0) continue;
        ac.notas.slice(0, 3).forEach((nn, k) => {
          const m = 60 + ((ac.raiz + nn) % 12) + (ac.raiz + nn >= 12 ? 0 : 0);
          tocar(mix, quando(c, pos) + k * 0.009, inst[faixa.acomp](hz(m), 0.7), { vol: faixa.acomp === 'corda' ? 0.16 : 0.11, pan: -0.35 + k * 0.1, rev: 0.25 });
        });
      }

      // baixo
      if (secao !== 'pausa' || local >= n - 1) {
        const padrao = faixa.pezinho ? [[0, 0], [4, 7], [8, 0], [12, 7]] : [[0, 0], [6, 0], [8, 7], [12, 12], [14, 7]];
        for (const [pos, int] of padrao) {
          if (secao === 'intro' && pos % 8) continue;
          tocar(mix, quando(c, pos), inst.baixo(hz(raizBaixo + int - 12), semi * 3), { vol: 0.42 });
        }
      }

      // bateria
      if (cheio) {
        for (const pos of [0, 8]) tocar(mix, quando(c, pos), inst.bumbo(), { vol: 0.5 });
        if (!faixa.pezinho || local % 2) tocar(mix, quando(c, faixa.pezinho ? 12 : 4), inst.palma(), { vol: 0.16, pan: 0.15, rev: 0.2 });
        if (!faixa.pezinho) tocar(mix, quando(c, 12), inst.palma(), { vol: 0.16, pan: 0.15, rev: 0.2 });
      }
      if (secao !== 'intro' && !(secao === 'fim' && local >= 2)) {
        for (let pos = 0; pos < 16; pos += 2) tocar(mix, quando(c, pos), inst.chocalho(), { vol: pos % 4 ? 0.09 : 0.06, pan: 0.4 });
      }

      // melodia principal (A) e a resposta, uma oitava acima (B)
      if (cheio) {
        const lista = secao === 'A' ? melA : melB;
        const voz = secao === 'A' ? faixa.melodia : faixa.resposta;
        for (const nota of lista.filter(x => x.compasso === local % 8)) {
          const m = nota.midi + (voz === 'sininho' ? 12 : 0);
          tocar(mix, quando(c, nota.pos), inst[voz](hz(m), Math.max(0.4, nota.dur * semi * 1.4)), { vol: voz === 'sininho' ? 0.2 : voz === 'corda' ? 0.3 : 0.32, pan: 0.12, rev: 0.35 });
        }
        // na volta do refrão, o sininho dobra a melodia baixinho
        if (secao === 'B') for (const nota of melA.filter(x => x.compasso === local % 8 && x.pos % 8 === 0)) {
          tocar(mix, quando(c, nota.pos), inst.sininho(hz(nota.midi + 24)), { vol: 0.06, pan: -0.2, rev: 0.4 });
        }
      }
      // pausa: só um sininho "pensando" pra respirar
      if (secao === 'pausa' && local % 2 === 0) {
        tocar(mix, quando(c, 0), inst.sininho(hz(72 + ((ac.raiz + ac.notas[2]) % 12))), { vol: 0.12, pan: -0.2, rev: 0.5 });
      }
    }
    c0 += n;
  }
  // acorde final
  const ult = acorde(faixa.acordes[0]);
  ult.notas.forEach((nn, k) => tocar(mix, total * comp + k * 0.03, inst[faixa.melodia === 'corda' ? 'corda' : 'marimba'](hz(60 + ((ult.raiz + nn) % 12)), 1.5), { vol: 0.18, rev: 0.5 }));

  // junta com o reverb, suaviza o começo/fim e evita estourar
  const rL = reverb(mix.revL, 0), rR = reverb(mix.revR, 1.1);
  const n = mix.L.length, L = new Float32Array(n), R = new Float32Array(n);
  let pico = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = Math.min(1, t / 1.2) * Math.min(1, (seg - t) / 1.6);
    L[i] = Math.tanh((mix.L[i] + rL[i] * 0.5) * 1.1) * env;
    R[i] = Math.tanh((mix.R[i] + rR[i] * 0.5) * 1.1) * env;
    pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i]));
  }
  const ganho = 0.89 / (pico || 1);
  return { L, R, ganho, seg };
}

function salvarWav(arq, { L, R, ganho }) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * ganho)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * ganho)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(arq, buf);
}

fs.mkdirSync(PASTA, { recursive: true });
FAIXAS.forEach((faixa, i) => {
  const r = gerarFaixa(faixa, i);
  const wav = path.join(PASTA, faixa.nome + '.wav'), mp3 = path.join(PASTA, faixa.nome + '.mp3');
  salvarWav(wav, r);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3]);
    fs.unlinkSync(wav);
    console.log(`${faixa.nome}.mp3  (${Math.round(r.seg)} s)`);
  } catch {
    console.log(`${faixa.nome}.wav  (${Math.round(r.seg)} s; sem ffmpeg ficou em wav)`);
  }
});

// Etapa 1 do Professor Maluco: testa se conseguimos ler o chat e os presentes de uma live do TikTok.
// Uso:  node teste-chat.js @usuario_que_esta_ao_vivo [minutos]
// Ex.:  node teste-chat.js @fulano 30
//
// Mostra cada comentário e presente que chega, reconecta sozinho se cair e, a cada minuto,
// mostra um placar. No fim, salva um resumo em logs/.

const fs = require('fs');
const path = require('path');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

// ---------- configuração ----------
const usuario = (process.argv[2] || '').replace(/^@/, '').trim();
const minutos = Number(process.argv[3] || 30);
if (!usuario) {
  console.log('Faltou o @ de quem está ao vivo. Ex.: node teste-chat.js @fulano 30');
  process.exit(1);
}

// Chave opcional do Euler Stream (cota própria). Procura EULER_API_KEY no .env subindo as pastas.
function lerChaveEuler() {
  if (process.env.EULER_API_KEY) return process.env.EULER_API_KEY;
  let pasta = __dirname;
  for (let i = 0; i < 6; i++) {
    const arq = path.join(pasta, '.env');
    if (fs.existsSync(arq)) {
      const linha = fs.readFileSync(arq, 'utf8').split(/\r?\n/).find(l => l.startsWith('EULER_API_KEY='));
      if (linha) return linha.split('=').slice(1).join('=').trim();
    }
    pasta = path.dirname(pasta);
  }
  return undefined;
}
const chaveEuler = lerChaveEuler();

// ---------- contadores ----------
const inicio = Date.now();
const placar = {
  comentarios: 0,
  presentes: 0,
  eventosPresente: 0,
  moedas: 0,
  pessoas: new Set(),
  quedas: 0,
  reconexoes: 0,
  erros: [],
  comentariosNoMinuto: 0,
  porMinuto: [],
};

// Nesta versão da biblioteca o @ vem em displayId e o texto em content.
const arroba = u => u?.uniqueId || u?.displayId || u?.idStr || '?';
const apelidoDe = u => u?.nickname || arroba(u);
let giftExemploSalvo = false;

const hora = () => new Date().toLocaleTimeString('pt-BR');
const decorrido = () => Math.round((Date.now() - inicio) / 1000);

// ---------- conexão ----------
let conexao;
let encerrando = false;

function criarConexao() {
  const c = new TikTokLiveConnection(usuario, {
    signApiKey: chaveEuler,
    // enableExtendedGiftInfo fica DESLIGADO: no Euler Stream ele exige plano pago (Business).
    processInitialData: false,    // não reprocessa mensagens antigas ao conectar
    fetchRoomInfoOnConnect: false, // a busca de dados da sala falha em algumas lives; pegamos a sala nós mesmos
  });

  c.on(WebcastEvent.CHAT, data => {
    placar.comentarios++;
    placar.comentariosNoMinuto++;
    placar.pessoas.add(arroba(data.user));
    const texto = data.content ?? data.comment ?? '';
    console.log(`[${hora()}] 💬 ${apelidoDe(data.user)} (@${arroba(data.user)}): ${texto}`);
  });

  c.on(WebcastEvent.GIFT, data => {
    if (!giftExemploSalvo) { // guarda 1 presente cru pra conferirmos os campos
      giftExemploSalvo = true;
      fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
      const semUser = { ...data, user: { nickname: data.user?.nickname, displayId: data.user?.displayId } };
      fs.writeFileSync(path.join(__dirname, 'logs', 'exemplo-presente.json'), JSON.stringify(semUser, null, 2));
    }
    placar.eventosPresente++;
    // Cada presente chega 2x: uma no começo (repeatEnd 0) e outra no fim da sequência (repeatEnd 1).
    // Contamos só a do fim, com a quantidade final.
    if (!data.repeatEnd) return;
    const qtd = data.repeatCount || 1;
    // O nome e o valor vêm em data.gift (giftDetails vem vazio sem plano pago).
    const valor = data.gift?.diamondCount || 0;
    const nome = data.gift?.name || `presente ${data.giftId}`;
    placar.presentes += qtd;
    placar.moedas += valor * qtd;
    console.log(`[${hora()}] 🎁 ${apelidoDe(data.user)} (@${arroba(data.user)}) mandou ${qtd}x ${nome} (código ${data.giftId}${valor ? `, ${valor} moedas cada` : ''})`);
  });

  c.on(WebcastEvent.STREAM_END, () => {
    console.log(`[${hora()}] ⛔ A live terminou.`);
    encerrar('a live terminou');
  });

  c.on(ControlEvent.DISCONNECTED, () => {
    if (encerrando) return;
    placar.quedas++;
    console.log(`[${hora()}] ⚠️  Conexão caiu. Tentando de novo em 5 s...`);
    setTimeout(conectar, 5000);
  });

  c.on(ControlEvent.ERROR, err => {
    const msg = (err?.exception?.message || err?.info || err?.message || String(err)).slice(0, 200);
    placar.erros.push(`${hora()} ${msg}`);
  });

  return c;
}

// A biblioteca às vezes não acha o número da sala ("Failed to retrieve Room ID").
// Então lemos direto da página pública da live: tiktok.com/@usuario/live
async function descobrirSala() {
  try {
    const r = await fetch(`https://www.tiktok.com/@${usuario}/live`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' },
    });
    const html = await r.text();
    const m = html.match(/"roomId":"(d{6,})"/);
    return m ? m[1] : undefined;
  } catch { return undefined; }
}

let primeiraVez = true;
async function conectar() {
  if (encerrando) return;
  conexao = criarConexao();
  try {
    const sala = await descobrirSala();
    const estado = await conexao.connect(sala);
    if (primeiraVez) {
      console.log(`\n✅ Conectado na live de @${usuario} (sala ${estado.roomId}).`);
      console.log(`   Teste de ${minutos} min. ${chaveEuler ? 'Usando chave própria do Euler.' : 'Usando a cota grátis do Euler (sem chave).'}`);
      console.log('   Ctrl+C encerra antes e salva o resumo.\n');
      primeiraVez = false;
    } else {
      placar.reconexoes++;
      console.log(`[${hora()}] ✅ Reconectado.`);
    }
  } catch (err) {
    const msg = (err?.message || String(err)).slice(0, 300);
    placar.erros.push(`${hora()} ${msg}`);
    if (primeiraVez) {
      console.log(`\n❌ Não consegui conectar na live de @${usuario}.`);
      console.log(`   Motivo: ${msg}`);
      console.log('   Confira se a pessoa está AO VIVO agora e se o @ está certo.');
      encerrar('falhou ao conectar', 1);
      return;
    }
    console.log(`[${hora()}] ❌ Falhou ao reconectar (${msg}). Tento de novo em 15 s...`);
    setTimeout(conectar, 15000);
  }
}

// ---------- placar por minuto ----------
const relogio = setInterval(() => {
  placar.porMinuto.push(placar.comentariosNoMinuto);
  console.log(
    `\n--- ${Math.round(decorrido() / 60)} min | ${placar.comentariosNoMinuto} comentários neste minuto | ` +
    `${placar.comentarios} no total | ${placar.pessoas.size} pessoas | ${placar.presentes} presentes | ` +
    `quedas: ${placar.quedas} ---\n`
  );
  placar.comentariosNoMinuto = 0;
}, 60_000);

const limite = setTimeout(() => encerrar('tempo do teste acabou'), minutos * 60_000);

// ---------- encerramento ----------
async function encerrar(motivo, codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  clearInterval(relogio);
  clearTimeout(limite);
  try { await conexao?.disconnect(); } catch {}

  const min = (decorrido() / 60).toFixed(1);
  const resumo = [
    `Teste do chat — @${usuario} — ${new Date().toLocaleString('pt-BR')}`,
    `Motivo do fim: ${motivo}`,
    `Duração: ${min} min`,
    `Comentários recebidos: ${placar.comentarios}`,
    `Pessoas diferentes que comentaram: ${placar.pessoas.size}`,
    `Comentários por minuto: ${placar.porMinuto.join(', ') || '-'}`,
    `Presentes: ${placar.presentes} (${placar.moedas} moedas) | eventos de presente brutos: ${placar.eventosPresente}`,
    `Quedas de conexão: ${placar.quedas} | Reconexões que deram certo: ${placar.reconexoes}`,
    `Erros (${placar.erros.length}):`,
    ...placar.erros.slice(-20).map(e => `  - ${e}`),
  ].join('\n');

  console.log('\n==================== RESUMO ====================\n' + resumo + '\n================================================');
  const pastaLogs = path.join(__dirname, 'logs');
  fs.mkdirSync(pastaLogs, { recursive: true });
  const arq = path.join(pastaLogs, `teste-chat_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${usuario}.txt`);
  fs.writeFileSync(arq, resumo + '\n', 'utf8');
  console.log(`Resumo salvo em ${arq}`);
  process.exit(codigo);
}

process.on('SIGINT', () => encerrar('encerrado com Ctrl+C'));

conectar();

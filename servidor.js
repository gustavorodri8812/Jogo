// Servidor do Professor Maluco: o cérebro do jogo.
//
// Uso:  node servidor.js            (live de verdade: rodadas de 60 a 90 s)
//       node servidor.js --rapido   (teste: rodadas de 20 s)
//
// Endereços:
//   http://localhost:3000          tela do jogo (é isso que vai no OBS: 1080 x 1920)
//   http://localhost:3000/painel   painel de controle (iniciar, pausar, simular chat)
//
// A tela e o painel recebem as mudanças ao vivo por /eventos (Server-Sent Events).
// O painel manda comandos por /api/controle e palpites de teste por /api/chat.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Partida } = require('./nucleo/partida');
const { PonteTikTok } = require('./nucleo/tiktok');

const PORTA = Number(process.env.PORTA || 3000);
const RAIZ = path.join(__dirname, 'publico');
const RAPIDO = process.argv.includes('--rapido');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const desenhos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'desenhos', 'desenhos.json'), 'utf8'));
const partida = new Partida({ config, desenhos, pastaDados: path.join(__dirname, 'dados'), rapido: RAPIDO });

// ---------------- eventos ao vivo (tela e painel) ----------------
const clientes = new Set(); // { res, painel }
function enviar(c, evento, dados) {
  c.res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
}
function transmitir(evento, dados, soPainel = false) {
  for (const c of clientes) if (!soPainel || c.painel) enviar(c, evento, typeof dados === 'function' ? dados(c) : dados);
}
const ponte = new PonteTikTok(partida);
ponte.on('estado', e => { console.log(`[tiktok] ${e.situacao}${e.mensagem ? ' - ' + e.mensagem : ''}`); transmitir('ponte', e, true); });
const estadoPara = c => (c.painel ? partida.paraPainel() : partida.paraTela());

partida.on('estado', () => transmitir('estado', estadoPara));
partida.on('acerto', a => { transmitir('acerto', a); transmitir('estado', partida.paraPainel(), true); });
partida.on('perto', a => transmitir('perto', a));
partida.on('chat', m => transmitir('chat', m, true));
partida.on('presente', p => transmitir('presente', p));
partida.on('metaVaso', m => transmitir('metaVaso', m));
setInterval(() => { for (const c of clientes) c.res.write(': ping\n\n'); }, 15000);

// ---------------- arquivos e API ----------------
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};

function lerCorpo(req) {
  return new Promise(ok => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } });
  });
}
const json = (res, dados, cod = 200) => { res.writeHead(cod, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(dados)); };

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let caminho = decodeURIComponent(url.pathname);

  if (caminho === '/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    const c = { res, painel: url.searchParams.has('painel') };
    clientes.add(c);
    enviar(c, 'estado', estadoPara(c));
    if (c.painel) enviar(c, 'ponte', ponte.estado());
    req.on('close', () => clientes.delete(c));
    return;
  }

  if (caminho === '/api/estado') return json(res, partida.paraPainel());

  if (caminho === '/api/controle' && req.method === 'POST') {
    const { acao } = await lerCorpo(req);
    const acoes = { iniciar: () => partida.iniciar(), pausar: () => partida.pausar(), retomar: () => partida.retomar(),
      encerrar: () => partida.encerrar(), 'nova-live': () => partida.novaLive() };
    if (!acoes[acao]) return json(res, { erro: 'ação desconhecida' }, 400);
    acoes[acao]();
    console.log(`[painel] ${acao}`);
    return json(res, { ok: true });
  }

  if (caminho === '/api/chat' && req.method === 'POST') {
    const m = await lerCorpo(req);
    return json(res, { resultado: partida.receberChat(m) });
  }

  if (caminho === '/api/tiktok' && req.method === 'POST') {
    const { acao, usuario } = await lerCorpo(req);
    if (acao === 'conectar') {
      if (!/^@?[\w.]{2,40}$/.test(String(usuario || '').trim())) return json(res, { erro: 'Esse @ não parece certo. Ex.: @professormaluco' }, 400);
      ponte.conectar(usuario).catch(e => console.error('[tiktok]', e.message));
    } else if (acao === 'desconectar') await ponte.desconectar();
    else return json(res, { erro: 'ação desconhecida' }, 400);
    return json(res, ponte.estado());
  }

  if (caminho === '/api/musicas') {
    let arquivos = [];
    try { arquivos = fs.readdirSync(path.join(RAIZ, 'audio', 'musica')).filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f)).sort(); } catch { /* pasta vazia */ }
    return json(res, { arquivos });
  }

  if (caminho === '/api/presente' && req.method === 'POST') {
    partida.receberPresente(await lerCorpo(req));
    return json(res, { ok: true });
  }

  if (caminho === '/api/rosas' && req.method === 'POST') {
    const { quantidade } = await lerCorpo(req);
    return json(res, { rosas: partida.receberRosas(quantidade ?? 1) });
  }

  // arquivos da pasta publico/
  if (caminho === '/')caminho = '/tela.html';
  if (caminho === '/painel') caminho = '/painel.html';
  const arquivo = path.normalize(path.join(RAIZ, caminho));
  if (!arquivo.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
  fs.readFile(arquivo, (erro, dados) => {
    if (erro) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(dados);
  });
});

servidor.listen(PORTA, () => {
  console.log(`\n🧪 Professor Maluco ${RAPIDO ? '(MODO RÁPIDO: rodadas de 20 s)' : ''}`);
  console.log(`   Tela do jogo (OBS, 1080 x 1920): http://localhost:${PORTA}`);
  console.log(`   Painel de controle:              http://localhost:${PORTA}/painel`);
  if (partida.retomada) console.log(`   ↻ Live anterior retomada (${partida.ranking.size} pessoas no ranking). Pra zerar: "Nova live" no painel.`);
  console.log('   Ctrl+C para desligar.\n');
});

import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO_DADOS = process.env.DADOS_PATH || path.join(__dirname, 'data', 'dados.json');
const PORTA = Number(process.env.PORT) || 3001;
const SENHA_ADMIN = process.env.ADMIN_PASSWORD || '';
const VALIDADE_TOKEN_MS = 8 * 60 * 60 * 1000;

// Coleções editáveis pelo admin e os campos obrigatórios de cada uma
const COLECOES = {
    itens: ['politico', 'tipo', 'texto'],
    fatos: ['politico', 'categoria', 'titulo'],
    politicos: ['id', 'nome']
};

const tokens = new Map();

async function lerDados() {
    return JSON.parse(await fs.readFile(ARQUIVO_DADOS, 'utf8'));
}

// Escrita atômica: grava num arquivo temporário e renomeia
async function salvarDados(dados) {
    const tmp = `${ARQUIVO_DADOS}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(dados, null, 2) + '\n');
    await fs.rename(tmp, ARQUIVO_DADOS);
}

// Fila simples para evitar duas escritas concorrentes no mesmo arquivo
let fila = Promise.resolve();
function comLock(fn) {
    const proxima = fila.then(fn, fn);
    fila = proxima.catch(() => {});
    return proxima;
}

function senhaConfere(senha) {
    if (!SENHA_ADMIN || typeof senha !== 'string') return false;
    const a = crypto.createHash('sha256').update(senha).digest();
    const b = crypto.createHash('sha256').update(SENHA_ADMIN).digest();
    return crypto.timingSafeEqual(a, b);
}

function exigirAdmin(req, res, next) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const expira = tokens.get(token);
    if (!expira || expira < Date.now()) {
        tokens.delete(token);
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    next();
}

function normalizarFontes(fontes) {
    if (!Array.isArray(fontes)) return [];
    return fontes
        .filter(f => f && typeof f.url === 'string' && /^https?:\/\//.test(f.url))
        .map(f => ({ titulo: String(f.titulo || f.url).slice(0, 200), url: f.url.slice(0, 500) }));
}

function validar(colecao, corpo) {
    const faltando = COLECOES[colecao].filter(c => !String(corpo[c] ?? '').trim());
    if (faltando.length) return `Campos obrigatórios: ${faltando.join(', ')}`;
    return null;
}

const app = express();
app.use(express.json({ limit: '200kb' }));

app.get('/api/dados', async (req, res) => {
    res.json(await lerDados());
});

app.post('/api/login', (req, res) => {
    if (!SENHA_ADMIN) {
        return res.status(503).json({ erro: 'Admin desativado: defina ADMIN_PASSWORD no servidor' });
    }
    if (!senhaConfere(req.body?.senha)) {
        return res.status(401).json({ erro: 'Senha incorreta' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, Date.now() + VALIDADE_TOKEN_MS);
    res.json({ token });
});

for (const colecao of Object.keys(COLECOES)) {
    app.post(`/api/${colecao}`, exigirAdmin, (req, res, next) => comLock(async () => {
        const erro = validar(colecao, req.body);
        if (erro) return res.status(400).json({ erro });
        const dados = await lerDados();
        const novo = { ...req.body, fontes: normalizarFontes(req.body.fontes) };
        if (colecao !== 'politicos') novo.id = crypto.randomUUID();
        else if (dados.politicos.some(p => p.id === novo.id)) {
            return res.status(409).json({ erro: 'Já existe um político com esse id' });
        }
        dados[colecao].push(novo);
        await salvarDados(dados);
        res.status(201).json(novo);
    }).catch(next));

    app.put(`/api/${colecao}/:id`, exigirAdmin, (req, res, next) => comLock(async () => {
        const erro = validar(colecao, { ...req.body, id: req.params.id });
        if (erro) return res.status(400).json({ erro });
        const dados = await lerDados();
        const i = dados[colecao].findIndex(x => x.id === req.params.id);
        if (i === -1) return res.status(404).json({ erro: 'Não encontrado' });
        dados[colecao][i] = { ...req.body, id: req.params.id, fontes: normalizarFontes(req.body.fontes) };
        await salvarDados(dados);
        res.json(dados[colecao][i]);
    }).catch(next));

    app.delete(`/api/${colecao}/:id`, exigirAdmin, (req, res, next) => comLock(async () => {
        const dados = await lerDados();
        if (colecao === 'politicos') {
            const emUso = [...dados.itens, ...dados.fatos].some(x => x.politico === req.params.id);
            if (emUso) return res.status(409).json({ erro: 'Remova antes os itens e fatos deste político' });
        }
        const antes = dados[colecao].length;
        dados[colecao] = dados[colecao].filter(x => x.id !== req.params.id);
        if (dados[colecao].length === antes) return res.status(404).json({ erro: 'Não encontrado' });
        await salvarDados(dados);
        res.status(204).end();
    }).catch(next));
}

// Em produção, serve o frontend já compilado
const dist = path.join(__dirname, 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api\/).*/, (req, res, next) => {
    res.sendFile(path.join(dist, 'index.html'), err => err && next());
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno' });
});

app.listen(PORTA, () => {
    console.log(`Quiz político rodando em http://localhost:${PORTA}`);
    if (!SENHA_ADMIN) console.log('Aviso: ADMIN_PASSWORD não definida — painel admin desativado.');
});

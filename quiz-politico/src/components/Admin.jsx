import { useState } from 'react';
import { login, criar, atualizar, remover } from '../api.js';
import { TIPOS } from '../quiz.js';
import { CATEGORIAS } from './Fichas.jsx';
import { RESULTADOS, TIPOS_EVENTO, formatarData } from '../linhaDoTempo.js';

const CHAVE_TOKEN = 'quiz-politico-token';

function lerToken() {
    try { return sessionStorage.getItem(CHAVE_TOKEN) || ''; } catch { return ''; }
}
function gravarToken(token) {
    try {
        if (token) sessionStorage.setItem(CHAVE_TOKEN, token);
        else sessionStorage.removeItem(CHAVE_TOKEN);
    } catch { /* armazenamento indisponível: o login vale só nesta aba */ }
}

// "Título | https://url" por linha  <->  [{ titulo, url }]
const fontesParaTexto = fontes => (fontes || []).map(f => `${f.titulo} | ${f.url}`).join('\n');
const textoParaFontes = texto => texto
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
        const i = l.lastIndexOf('|');
        return i === -1 ? { titulo: l, url: l } : { titulo: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
    });

function camposDe(colecao, politicos) {
    const opcoesPoliticos = politicos.map(p => [p.id, p.apelido]);
    if (colecao === 'itens') {
        return [
            { nome: 'politico', rotulo: 'Autor (fica oculto no quiz)', tipo: 'select', opcoes: opcoesPoliticos },
            { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: Object.entries(TIPOS) },
            { nome: 'tema', rotulo: 'Tema (ex.: Economia, Segurança)' },
            { nome: 'texto', rotulo: 'Texto anonimizado — comece com "Uma pessoa…" e não deixe pistas de quem é', tipo: 'textarea' },
            { nome: 'revelacao', rotulo: 'Contexto revelado no final (data, lei, desfecho)', tipo: 'textarea' }
        ];
    }
    if (colecao === 'fatos') {
        return [
            { nome: 'politico', rotulo: 'Político', tipo: 'select', opcoes: opcoesPoliticos },
            { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: Object.entries(CATEGORIAS) },
            { nome: 'titulo', rotulo: 'Título' },
            { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' },
            { nome: 'status', rotulo: 'Situação (para processos: indiciado, réu, condenado, arquivado…)' }
        ];
    }
    if (colecao === 'planos') {
        return [
            { nome: 'politico', rotulo: 'Político', tipo: 'select', opcoes: opcoesPoliticos },
            { nome: 'ano', rotulo: 'Ano da eleição (ex.: 2022)' },
            { nome: 'titulo', rotulo: 'Nome do plano' },
            { nome: 'resumo', rotulo: 'Resumo das principais propostas', tipo: 'textarea' }
        ];
    }
    if (colecao === 'promessas') {
        return [
            { nome: 'politico', rotulo: 'Político', tipo: 'select', opcoes: opcoesPoliticos },
            { nome: 'plano', rotulo: 'Ano do plano em que foi prometida (ex.: 2022)' },
            { nome: 'texto', rotulo: 'Promessa' },
            { nome: 'resultado', rotulo: 'Resultado', tipo: 'select', opcoes: Object.entries(RESULTADOS) },
            { nome: 'nota', rotulo: 'O que de fato aconteceu (com números)', tipo: 'textarea' }
        ];
    }
    if (colecao === 'eventos') {
        return [
            { nome: 'politico', rotulo: 'Político', tipo: 'select', opcoes: opcoesPoliticos },
            { nome: 'data', rotulo: 'Data no formato AAAA-MM (ex.: 2025-04)' },
            { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: Object.entries(TIPOS_EVENTO) },
            { nome: 'titulo', rotulo: 'Título' },
            { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' },
            { nome: 'status', rotulo: 'Situação (para escândalos: indiciado, réu, condenado, arquivado…)' }
        ];
    }
    return [
        { nome: 'id', rotulo: 'Identificador (sem espaços, ex.: tarcisio)', somenteCriacao: true },
        { nome: 'nome', rotulo: 'Nome completo' },
        { nome: 'apelido', rotulo: 'Nome curto' },
        { nome: 'partido', rotulo: 'Partido' },
        { nome: 'cor', rotulo: 'Cor no gráfico', tipo: 'color' },
        { nome: 'resumo', rotulo: 'Resumo', tipo: 'textarea' }
    ];
}

function vazio(campos) {
    const obj = { fontesTexto: '' };
    for (const c of campos) obj[c.nome] = c.tipo === 'select' ? c.opcoes[0]?.[0] ?? '' : c.tipo === 'color' ? '#64748b' : '';
    return obj;
}

function Formulario({ colecao, campos, inicial, token, aoSalvar, aoCancelar }) {
    const editando = Boolean(inicial);
    const [valores, setValores] = useState(() =>
        inicial ? { ...vazio(campos), ...inicial, fontesTexto: fontesParaTexto(inicial.fontes) } : vazio(campos)
    );
    const [erro, setErro] = useState('');
    const [salvando, setSalvando] = useState(false);

    const alterar = (nome, valor) => setValores(v => ({ ...v, [nome]: valor }));

    const enviar = async e => {
        e.preventDefault();
        const fontes = textoParaFontes(valores.fontesTexto);
        if (fontes.some(f => !/^https?:\/\//.test(f.url))) {
            setErro('Cada fonte precisa terminar com um link http(s). Formato: Título | https://…');
            return;
        }
        if (colecao !== 'politicos' && !fontes.length) {
            setErro('Adicione ao menos uma fonte.');
            return;
        }
        const { fontesTexto, ...resto } = valores;
        const corpo = { ...resto, fontes };
        setSalvando(true);
        setErro('');
        try {
            if (editando) await atualizar(colecao, inicial.id, corpo, token);
            else await criar(colecao, corpo, token);
            aoSalvar();
        } catch (err) {
            setErro(err.message);
            setSalvando(false);
        }
    };

    return (
        <form className="formulario" onSubmit={enviar}>
            <h3>{editando ? 'Editar' : 'Adicionar'}</h3>
            {campos.map(c => (
                <label key={c.nome}>
                    <span>{c.rotulo}</span>
                    {c.tipo === 'select' ? (
                        <select value={valores[c.nome]} onChange={e => alterar(c.nome, e.target.value)}>
                            {c.opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                        </select>
                    ) : c.tipo === 'textarea' ? (
                        <textarea rows={4} value={valores[c.nome] || ''} onChange={e => alterar(c.nome, e.target.value)} />
                    ) : (
                        <input
                            type={c.tipo === 'color' ? 'color' : 'text'}
                            value={valores[c.nome] || ''}
                            disabled={editando && c.somenteCriacao}
                            onChange={e => alterar(c.nome, e.target.value)}
                        />
                    )}
                </label>
            ))}
            <label>
                <span>Fontes — uma por linha, no formato: Título | https://link</span>
                <textarea rows={3} value={valores.fontesTexto} onChange={e => alterar('fontesTexto', e.target.value)} />
            </label>
            {erro && <p className="aviso erro">{erro}</p>}
            <div className="botoes-form">
                <button className="primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
                <button type="button" className="secundario" onClick={aoCancelar}>Cancelar</button>
            </div>
        </form>
    );
}

function Login({ aoEntrar }) {
    const [senha, setSenha] = useState('');
    const [erro, setErro] = useState('');

    const entrar = async e => {
        e.preventDefault();
        try {
            const { token } = await login(senha);
            aoEntrar(token);
        } catch (err) {
            setErro(err.message);
        }
    };

    return (
        <form className="formulario login" onSubmit={entrar}>
            <h1>Área do admin</h1>
            <label>
                <span>Senha</span>
                <input type="password" value={senha} onChange={e => setSenha(e.target.value)} autoFocus />
            </label>
            {erro && <p className="aviso erro">{erro}</p>}
            <button className="primario">Entrar</button>
        </form>
    );
}

const ABAS = {
    itens: 'Perguntas do quiz',
    fatos: 'Fichas (fatos)',
    planos: 'Planos de governo',
    promessas: 'Promessas',
    eventos: 'Linha do tempo',
    politicos: 'Políticos'
};

// Etiqueta secundária e texto principal de cada registro na lista do admin
function resumoDoRegistro(aba, x) {
    switch (aba) {
        case 'itens': return [TIPOS[x.tipo] || x.tipo, x.texto];
        case 'fatos': return [CATEGORIAS[x.categoria] || x.categoria, x.titulo];
        case 'planos': return [x.ano, x.titulo];
        case 'promessas': return [`${x.plano} · ${RESULTADOS[x.resultado] || x.resultado}`, x.texto];
        case 'eventos': return [`${formatarData(x.data)} · ${TIPOS_EVENTO[x.tipo] || x.tipo}`, x.titulo];
        default: return [null, x.nome];
    }
}

export default function Admin({ dados, aoAlterar }) {
    const [token, setToken] = useState(lerToken);
    const [aba, setAba] = useState('itens');
    const [editando, setEditando] = useState(null); // null | 'novo' | objeto
    const [filtro, setFiltro] = useState('');
    const [erro, setErro] = useState('');

    const sair = () => { gravarToken(''); setToken(''); };

    if (!token) return <Login aoEntrar={t => { gravarToken(t); setToken(t); }} />;

    const campos = camposDe(aba, dados.politicos);
    const nomePolitico = Object.fromEntries(dados.politicos.map(p => [p.id, p.apelido]));
    const termo = filtro.toLowerCase();
    const lista = dados[aba].filter(x =>
        (filtro === '' || JSON.stringify(x).toLowerCase().includes(termo))
    );

    const tratarErro = err => {
        if (err.status === 401) sair();
        setErro(err.message);
    };

    const apagar = async item => {
        if (!window.confirm('Remover este registro? Não dá para desfazer.')) return;
        try {
            await remover(aba, item.id, token);
            setErro('');
            aoAlterar();
        } catch (err) { tratarErro(err); }
    };

    const contagem = dados.politicos.map(p => `${p.apelido}: ${dados.itens.filter(i => i.politico === p.id).length}`).join(' · ');

    return (
        <section className="admin">
            <div className="admin-topo">
                <h1>Admin</h1>
                <button className="link" onClick={sair}>Sair</button>
            </div>
            <p className="nota">
                Perguntas por político — {contagem}. Cada rodada usa o mesmo número de perguntas por político (o menor deles),
                então manter as quantidades equilibradas aproveita melhor o banco.
            </p>

            <div className="abas">
                {Object.entries(ABAS).map(([k, r]) => (
                    <button key={k} className={k === aba ? 'ativo' : ''} onClick={() => { setAba(k); setEditando(null); setFiltro(''); }}>
                        {r} ({dados[k].length})
                    </button>
                ))}
            </div>

            {erro && <p className="aviso erro">{erro}</p>}

            {editando ? (
                <Formulario
                    key={editando === 'novo' ? 'novo' : editando.id}
                    colecao={aba}
                    campos={campos}
                    inicial={editando === 'novo' ? null : editando}
                    token={token}
                    aoSalvar={() => { setEditando(null); setErro(''); aoAlterar(); }}
                    aoCancelar={() => setEditando(null)}
                />
            ) : (
                <>
                    <div className="barra-admin">
                        <button className="primario" onClick={() => setEditando('novo')}>+ Adicionar</button>
                        <input placeholder="Filtrar…" value={filtro} onChange={e => setFiltro(e.target.value)} />
                    </div>
                    <ul className="lista-admin">
                        {lista.map(x => {
                            const [secundaria, principal] = resumoDoRegistro(aba, x);
                            return (
                            <li key={x.id}>
                                <div>
                                    <span className="etiqueta">{aba === 'politicos' ? x.partido : nomePolitico[x.politico] ?? x.politico}</span>
                                    {secundaria && <span className="etiqueta tema">{secundaria}</span>}
                                    <p>{principal}</p>
                                </div>
                                <div className="acoes">
                                    <button className="link" onClick={() => setEditando(x)}>Editar</button>
                                    <button className="link perigo" onClick={() => apagar(x)}>Remover</button>
                                </div>
                            </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
}

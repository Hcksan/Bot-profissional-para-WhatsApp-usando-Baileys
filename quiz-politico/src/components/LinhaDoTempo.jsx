import { useState } from 'react';
import Fontes from './Fontes.jsx';
import { RESULTADOS, TIPOS_EVENTO, formatarData } from '../linhaDoTempo.js';

function PlacarPromessas({ promessas }) {
    const total = promessas.length;
    if (!total) return null;
    return (
        <div className="placar-promessas">
            <div className="barra-empilhada" role="img"
                aria-label={Object.keys(RESULTADOS).map(r => `${RESULTADOS[r]}: ${promessas.filter(p => p.resultado === r).length}`).join(', ')}>
                {Object.keys(RESULTADOS).map(r => {
                    const n = promessas.filter(p => p.resultado === r).length;
                    return n ? <span key={r} className={`seg res-${r}`} style={{ flexGrow: n }} /> : null;
                })}
            </div>
            <ul className="legenda">
                {Object.entries(RESULTADOS).map(([r, rotulo]) => {
                    const n = promessas.filter(p => p.resultado === r).length;
                    return n ? <li key={r}><span className={`bolinha res-${r}`} />{rotulo}: {n}</li> : null;
                })}
            </ul>
        </div>
    );
}

function CartaoPlano({ plano, promessas }) {
    return (
        <article className="plano">
            <div className="plano-topo">
                <span className="ano">{plano.ano}</span>
                <h3>{plano.titulo}</h3>
            </div>
            <p>{plano.resumo}</p>
            <PlacarPromessas promessas={promessas} />
            {promessas.length > 0 && (
                <ul className="promessas">
                    {promessas.map(p => (
                        <li key={p.id}>
                            <details>
                                <summary>
                                    <span className={`selo res-${p.resultado}`}>{RESULTADOS[p.resultado] || p.resultado}</span>
                                    <span>{p.texto}</span>
                                </summary>
                                {p.nota && <p>{p.nota}</p>}
                                <Fontes fontes={p.fontes} />
                            </details>
                        </li>
                    ))}
                </ul>
            )}
            <Fontes fontes={plano.fontes} />
        </article>
    );
}

export default function LinhaDoTempo({ dados }) {
    const comDados = dados.politicos.filter(p =>
        dados.planos.some(x => x.politico === p.id) || dados.eventos.some(x => x.politico === p.id)
    );
    const [ativo, setAtivo] = useState(comDados[0]?.id);
    const [filtro, setFiltro] = useState('todos');

    const p = comDados.find(x => x.id === ativo);
    if (!p) return <p className="aviso">Ainda não há linha do tempo cadastrada.</p>;

    const planos = dados.planos.filter(x => x.politico === p.id).sort((a, b) => String(a.ano).localeCompare(String(b.ano)));
    const promessasDe = ano => dados.promessas.filter(x => x.politico === p.id && String(x.plano) === String(ano));
    const eventos = dados.eventos
        .filter(x => x.politico === p.id && (filtro === 'todos' || x.tipo === filtro))
        .sort((a, b) => String(a.data).localeCompare(String(b.data)));

    const porAno = eventos.reduce((acc, e) => {
        const ano = String(e.data).slice(0, 4);
        (acc[ano] ??= []).push(e);
        return acc;
    }, {});

    return (
        <section className="linha-do-tempo">
            <h1>Planos, promessas e linha do tempo</h1>
            <p className="lead">
                O que foi prometido em cada campanha, o que saiu do papel, o que ficou para trás e os escândalos de cada período.
                Toque numa promessa para ver os detalhes e as fontes.
            </p>

            {comDados.length > 1 && (
                <div className="abas" role="tablist">
                    {comDados.map(x => (
                        <button key={x.id} role="tab" aria-selected={x.id === ativo}
                            className={x.id === ativo ? 'ativo' : ''} onClick={() => setAtivo(x.id)}>
                            {x.apelido}
                        </button>
                    ))}
                </div>
            )}

            {planos.length > 0 && (
                <>
                    <h2>Os planos de governo de {p.apelido}, ano a ano</h2>
                    <div className="planos">
                        {planos.map(pl => <CartaoPlano key={pl.id} plano={pl} promessas={promessasDe(pl.ano)} />)}
                    </div>
                </>
            )}

            <h2>Linha do tempo</h2>
            <div className="filtros" role="group" aria-label="Filtrar eventos">
                <button className={filtro === 'todos' ? 'ativo' : ''} onClick={() => setFiltro('todos')}>Todos</button>
                {Object.entries(TIPOS_EVENTO).map(([t, rotulo]) => (
                    <button key={t} className={filtro === t ? 'ativo' : ''} onClick={() => setFiltro(t)}>
                        <span className={`bolinha ev-${t}`} />{rotulo}
                    </button>
                ))}
            </div>

            {eventos.length === 0 ? (
                <p className="aviso">Nenhum evento neste filtro.</p>
            ) : (
                <ol className="cronologia">
                    {Object.entries(porAno).map(([ano, lista]) => (
                        <li key={ano} className="ano-bloco">
                            <h3 className="ano-titulo">{ano}</h3>
                            <ol>
                                {lista.map(e => (
                                    <li key={e.id} className={`evento ev-${e.tipo}`}>
                                        <div className="evento-topo">
                                            <span className={`selo ev-${e.tipo}`}>{TIPOS_EVENTO[e.tipo] || e.tipo}</span>
                                            <time>{formatarData(e.data)}</time>
                                        </div>
                                        <h4>{e.titulo}</h4>
                                        {e.descricao && <p>{e.descricao}</p>}
                                        {e.status && <p className="status"><strong>Situação:</strong> {e.status}</p>}
                                        <Fontes fontes={e.fontes} />
                                    </li>
                                ))}
                            </ol>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

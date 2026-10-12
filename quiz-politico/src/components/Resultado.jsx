import { calcularResultado, RESPOSTAS, TIPOS } from '../quiz.js';
import Fontes from './Fontes.jsx';

function juntarNomes(nomes) {
    return nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`;
}

export default function Resultado({ dados, rodada, respostas, aoJogarDeNovo, aoVerFichas }) {
    const { placar, vencedores } = calcularResultado(rodada, respostas, dados.politicos);
    const porId = Object.fromEntries(dados.politicos.map(p => [p.id, p]));

    let titulo;
    if (!vencedores.length) titulo = 'Você não deu opinião em nenhuma pergunta.';
    else if (vencedores.length === placar.filter(l => l.percentual !== null).length && vencedores.length > 1) {
        titulo = 'Empate: suas respostas concordam igualmente com todos.';
    } else if (vencedores.length > 1) {
        titulo = `Empate entre ${juntarNomes(vencedores.map(v => v.politico.apelido))}`;
    } else {
        titulo = `Suas opiniões estão mais alinhadas com ${vencedores[0].politico.apelido}`;
    }

    return (
        <section className="resultado">
            <div className="destaque-resultado">
                <p className="sobretitulo">Resultado</p>
                <h1>{titulo}</h1>
                {vencedores.length === 1 && (
                    <p className="lead">
                        Você apoiou {vencedores[0].percentual}% do que {vencedores[0].politico.apelido} fez, disse ou propõe nesta rodada.
                    </p>
                )}
            </div>

            <div className="placar">
                {placar.map(l => (
                    <div className="linha-placar" key={l.politico.id}>
                        <div className="linha-placar-topo">
                            <strong>{l.politico.apelido}</strong>
                            <span>{l.percentual === null ? 'sem opinião' : `${l.percentual}%`}</span>
                        </div>
                        <div className="barra">
                            <div className="barra-cheia" style={{ width: `${l.percentual ?? 0}%`, background: l.politico.cor }} />
                        </div>
                        <p className="detalhe-placar">
                            Apoiou {l.apoiados} · Não apoiou {l.rejeitados} · Sem opinião {l.total - l.apoiados - l.rejeitados}
                        </p>
                    </div>
                ))}
            </div>

            <p className="nota">
                Isto mede concordância com uma amostra de posições, não diz em quem votar. Leia as fichas completas antes de decidir.
            </p>

            <div className="botoes-inicio">
                <button className="primario" onClick={aoVerFichas}>Ver ficha completa de cada um</button>
                <button className="secundario" onClick={aoJogarDeNovo}>Jogar de novo</button>
            </div>

            <h2>Quem disse o quê</h2>
            <ol className="revelacoes">
                {rodada.map(item => {
                    const p = porId[item.politico];
                    const resp = respostas[item.id];
                    return (
                        <li key={item.id} className="revelacao" style={{ borderLeftColor: p?.cor }}>
                            <div className="etiquetas">
                                <span className="etiqueta">{TIPOS[item.tipo] || item.tipo}</span>
                                <span className={`etiqueta resp-${resp}`}>Você: {RESPOSTAS[resp] || '—'}</span>
                            </div>
                            <p>{item.texto}</p>
                            <p className="autor"><strong>{p?.apelido ?? item.politico}</strong>{item.revelacao && <> — {item.revelacao}</>}</p>
                            <Fontes fontes={item.fontes} />
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

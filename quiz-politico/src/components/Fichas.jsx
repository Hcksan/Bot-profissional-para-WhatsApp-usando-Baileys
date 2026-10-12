import { useState } from 'react';
import Fontes from './Fontes.jsx';

export const CATEGORIAS = {
    realizacao: 'O que fez',
    polemica: 'Polêmicas, escândalos e processos',
    proposta: 'Propostas'
};

export default function Fichas({ dados }) {
    const [ativo, setAtivo] = useState(dados.politicos[0]?.id);
    const p = dados.politicos.find(x => x.id === ativo);
    if (!p) return <p className="aviso">Nenhum político cadastrado.</p>;

    const fatos = dados.fatos.filter(f => f.politico === p.id);

    return (
        <section className="fichas">
            <h1>Ficha de cada um</h1>
            <p className="lead">{dados.meta?.aviso}</p>

            <div className="abas" role="tablist">
                {dados.politicos.map(x => (
                    <button
                        key={x.id}
                        role="tab"
                        aria-selected={x.id === ativo}
                        className={x.id === ativo ? 'ativo' : ''}
                        onClick={() => setAtivo(x.id)}
                    >
                        {x.apelido}
                    </button>
                ))}
            </div>

            <div className="cabecalho-ficha" style={{ borderTopColor: p.cor }}>
                <h2>{p.nome} <span className="partido">{p.partido}</span></h2>
                <p>{p.resumo}</p>
                <Fontes fontes={p.fontes} />
            </div>

            {Object.entries(CATEGORIAS).map(([cat, rotulo]) => {
                const lista = fatos.filter(f => f.categoria === cat);
                if (!lista.length) return null;
                return (
                    <div key={cat} className="secao-ficha">
                        <h3>{rotulo}</h3>
                        {lista.map(f => (
                            <article key={f.id} className={`fato fato-${cat}`}>
                                <h4>{f.titulo}</h4>
                                {f.descricao && <p>{f.descricao}</p>}
                                {f.status && <p className="status"><strong>Situação:</strong> {f.status}</p>}
                                <Fontes fontes={f.fontes} />
                            </article>
                        ))}
                    </div>
                );
            })}
        </section>
    );
}

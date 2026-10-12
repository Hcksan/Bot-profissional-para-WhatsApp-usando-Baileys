import { useState } from 'react';
import { TIPOS, RESPOSTAS } from '../quiz.js';

export default function Quiz({ rodada, aoTerminar, aoSair }) {
    const [indice, setIndice] = useState(0);
    const [respostas, setRespostas] = useState({});

    if (!rodada.length) {
        return <p className="aviso">Nenhuma pergunta nesta rodada. <button className="link" onClick={aoSair}>Voltar</button></p>;
    }

    const item = rodada[indice];

    const responder = valor => {
        const novas = { ...respostas, [item.id]: valor };
        setRespostas(novas);
        if (indice + 1 < rodada.length) setIndice(indice + 1);
        else aoTerminar(novas);
    };

    return (
        <section className="quiz">
            <div className="progresso" aria-label={`Pergunta ${indice + 1} de ${rodada.length}`}>
                <div className="progresso-barra" style={{ width: `${(indice / rodada.length) * 100}%` }} />
            </div>
            <p className="contador">Pergunta {indice + 1} de {rodada.length}</p>

            <article className="cartao-pergunta" key={item.id}>
                <div className="etiquetas">
                    <span className="etiqueta">{TIPOS[item.tipo] || item.tipo}</span>
                    {item.tema && <span className="etiqueta tema">{item.tema}</span>}
                </div>
                <p className="texto-pergunta">{item.texto}</p>
            </article>

            <p className="pergunta-apoio">Você apoia isso?</p>
            <div className="botoes-resposta">
                <button className="resp apoio" onClick={() => responder('apoio')}>👍 {RESPOSTAS.apoio}</button>
                <button className="resp nao" onClick={() => responder('nao')}>👎 {RESPOSTAS.nao}</button>
                <button className="resp neutro" onClick={() => responder('neutro')}>{RESPOSTAS.neutro}</button>
            </div>

            <div className="navegacao-quiz">
                {indice > 0 && <button className="link" onClick={() => setIndice(indice - 1)}>← Voltar uma</button>}
                <button className="link" onClick={aoSair}>Sair</button>
            </div>
        </section>
    );
}

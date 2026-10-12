export default function Inicio({ dados, aoComecar }) {
    const contagens = dados.politicos
        .map(p => dados.itens.filter(i => i.politico === p.id).length)
        .filter(n => n > 0);
    const porPolitico = contagens.length ? Math.min(...contagens) : 0;
    const rapido = Math.min(5, porPolitico);
    const nPoliticos = contagens.length;

    return (
        <section className="inicio">
            <h1>Você concorda com quem?</h1>
            <p className="lead">
                Você vai ler falas, ações e propostas reais de políticos brasileiros, reescritas para não dar para saber
                quem é o autor. Diga se apoia ou não. No final, revelamos com quem suas opiniões mais combinam.
            </p>

            <ul className="regras">
                <li>Cada político aparece o <strong>mesmo número de vezes</strong> por rodada, em ordem aleatória.</li>
                <li>Tem coisa boa e coisa ruim de todos. Tudo com <strong>fonte</strong>, mostrada no final.</li>
                <li>"Sem opinião" não conta ponto para ninguém.</li>
            </ul>

            <div className="politicos-chips">
                {dados.politicos.map(p => <span key={p.id} className="chip">{p.apelido}</span>)}
            </div>

            {porPolitico === 0 ? (
                <p className="aviso">Ainda não há perguntas cadastradas.</p>
            ) : (
                <div className="botoes-inicio">
                    <button className="primario" onClick={() => aoComecar(rapido)}>
                        Rodada rápida · {rapido * nPoliticos} perguntas
                    </button>
                    {porPolitico > rapido && (
                        <button className="secundario" onClick={() => aoComecar(null)}>
                            Rodada completa · {porPolitico * nPoliticos} perguntas
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

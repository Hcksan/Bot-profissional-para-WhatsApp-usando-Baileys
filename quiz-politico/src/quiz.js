export const TIPOS = {
    fez: 'Fez',
    falou: 'Falou',
    defendeu: 'Defendeu',
    apoiou: 'Apoiou',
    'propõe': 'Propõe'
};

export const RESPOSTAS = {
    apoio: 'Apoio',
    nao: 'Não apoio',
    neutro: 'Sem opinião'
};

function embaralhar(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

// Sorteia o MESMO número de itens de cada político, para nenhum lado
// ter mais peso na rodada, e embaralha a ordem final.
export function montarRodada(itens, politicos, porPolitico) {
    const grupos = politicos
        .map(p => itens.filter(i => i.politico === p.id))
        .filter(g => g.length > 0);
    if (!grupos.length) return [];

    const minimo = Math.min(...grupos.map(g => g.length));
    const n = porPolitico ? Math.min(porPolitico, minimo) : minimo;
    return embaralhar(grupos.flatMap(g => embaralhar(g).slice(0, n)));
}

// Concordância = itens apoiados / itens com opinião (apoio + não apoio).
// "Sem opinião" não conta para nenhum lado.
export function calcularResultado(rodada, respostas, politicos) {
    const placar = politicos
        .map(p => {
            const doPolitico = rodada.filter(i => i.politico === p.id);
            const apoiados = doPolitico.filter(i => respostas[i.id] === 'apoio').length;
            const rejeitados = doPolitico.filter(i => respostas[i.id] === 'nao').length;
            const opinados = apoiados + rejeitados;
            return {
                politico: p,
                total: doPolitico.length,
                apoiados,
                rejeitados,
                percentual: opinados ? Math.round((apoiados / opinados) * 100) : null
            };
        })
        .filter(l => l.total > 0)
        .sort((a, b) => (b.percentual ?? -1) - (a.percentual ?? -1));

    const comNota = placar.filter(l => l.percentual !== null);
    if (!comNota.length) return { placar, vencedores: [] };
    const maior = comNota[0].percentual;
    return { placar, vencedores: comNota.filter(l => l.percentual === maior) };
}

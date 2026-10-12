export const RESULTADOS = {
    cumprida: 'Cumprida',
    parcial: 'Em parte',
    em_andamento: 'Em andamento',
    nao_cumprida: 'Não cumprida',
    proposta: 'Proposta (não testada)'
};

export const TIPOS_EVENTO = {
    feito: 'Entregue',
    pendente: 'Ficou para trás',
    escandalo: 'Escândalo / polêmica',
    marco: 'Marco',
    numeros: 'Números'
};

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// "2025-04" -> "abr/2025"; "2025" -> "2025"
export function formatarData(data) {
    const [ano, mes] = String(data).split('-');
    const m = MESES[Number(mes) - 1];
    return m ? `${m}/${ano}` : ano;
}

async function requisicao(caminho, { metodo = 'GET', corpo, token } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const resp = await fetch(`/api${caminho}`, {
        method: metodo,
        headers,
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });

    if (resp.status === 204) return null;
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const erro = new Error(dados.erro || `Erro ${resp.status}`);
        erro.status = resp.status;
        throw erro;
    }
    return dados;
}

export const carregarDados = () => requisicao('/dados');
export const login = senha => requisicao('/login', { metodo: 'POST', corpo: { senha } });
export const criar = (colecao, item, token) => requisicao(`/${colecao}`, { metodo: 'POST', corpo: item, token });
export const atualizar = (colecao, id, item, token) =>
    requisicao(`/${colecao}/${encodeURIComponent(id)}`, { metodo: 'PUT', corpo: item, token });
export const remover = (colecao, id, token) =>
    requisicao(`/${colecao}/${encodeURIComponent(id)}`, { metodo: 'DELETE', token });

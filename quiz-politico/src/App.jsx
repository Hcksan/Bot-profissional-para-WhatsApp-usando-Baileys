import { useEffect, useState } from 'react';
import { carregarDados } from './api.js';
import { montarRodada } from './quiz.js';
import Inicio from './components/Inicio.jsx';
import Quiz from './components/Quiz.jsx';
import Resultado from './components/Resultado.jsx';
import Fichas from './components/Fichas.jsx';
import Admin from './components/Admin.jsx';

function rotaAtual() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return ['fichas', 'admin'].includes(hash) ? hash : 'inicio';
}

export default function App() {
    const [dados, setDados] = useState(null);
    const [erro, setErro] = useState('');
    const [tela, setTela] = useState(rotaAtual);
    const [rodada, setRodada] = useState([]);
    const [respostas, setRespostas] = useState({});

    const recarregar = () =>
        carregarDados()
            .then(d => { setDados(d); setErro(''); })
            .catch(e => setErro(e.message));

    useEffect(() => { recarregar(); }, []);

    useEffect(() => {
        const aoMudarHash = () => setTela(rotaAtual());
        window.addEventListener('hashchange', aoMudarHash);
        return () => window.removeEventListener('hashchange', aoMudarHash);
    }, []);

    const irPara = destino => {
        window.location.hash = destino === 'inicio' ? '' : `/${destino}`;
        setTela(destino);
        window.scrollTo(0, 0);
    };

    const comecar = porPolitico => {
        setRodada(montarRodada(dados.itens, dados.politicos, porPolitico));
        setRespostas({});
        setTela('quiz');
        window.scrollTo(0, 0);
    };

    const terminar = finais => {
        setRespostas(finais);
        setTela('resultado');
        window.scrollTo(0, 0);
    };

    let conteudo;
    if (erro) conteudo = <p className="aviso erro">Não foi possível carregar os dados: {erro}</p>;
    else if (!dados) conteudo = <p className="carregando">Carregando…</p>;
    else if (tela === 'quiz') conteudo = <Quiz rodada={rodada} aoTerminar={terminar} aoSair={() => irPara('inicio')} />;
    else if (tela === 'resultado') {
        conteudo = (
            <Resultado
                dados={dados}
                rodada={rodada}
                respostas={respostas}
                aoJogarDeNovo={() => irPara('inicio')}
                aoVerFichas={() => irPara('fichas')}
            />
        );
    } else if (tela === 'fichas') conteudo = <Fichas dados={dados} />;
    else if (tela === 'admin') conteudo = <Admin dados={dados} aoAlterar={recarregar} />;
    else conteudo = <Inicio dados={dados} aoComecar={comecar} />;

    return (
        <div className="app">
            <header className="topo">
                <button className="marca" onClick={() => irPara('inicio')}>Quiz Político às Cegas</button>
                <nav>
                    <button className={tela === 'inicio' ? 'ativo' : ''} onClick={() => irPara('inicio')}>Jogar</button>
                    <button className={tela === 'fichas' ? 'ativo' : ''} onClick={() => irPara('fichas')}>Fichas</button>
                </nav>
            </header>
            <main>{conteudo}</main>
            <footer className="rodape">
                <p>
                    Ferramenta educativa, não é recomendação de voto. Todo conteúdo tem fonte; confira e tire suas conclusões.
                    {dados?.meta?.atualizadoEm && <> Dados atualizados em {new Date(dados.meta.atualizadoEm + 'T12:00').toLocaleDateString('pt-BR')}.</>}
                </p>
                <button className="link-discreto" onClick={() => irPara('admin')}>Admin</button>
            </footer>
        </div>
    );
}

# Quiz Político às Cegas

Jogo em React no qual o jogador lê falas, ações e propostas reais de políticos, reescritas sem identificar o autor, e diz se apoia ou não. No final, o jogo mostra com quem as respostas mais combinam, revela o autor de cada item e lista as fontes.

Foco inicial: **Lula x Flávio Bolsonaro x Jair Bolsonaro** (eleição de 2026).

## Como rodar

```bash
cd quiz-politico
npm install

# desenvolvimento (API na porta 3001 + Vite com hot reload)
ADMIN_PASSWORD=uma-senha-forte npm run dev

# produção
npm run build
ADMIN_PASSWORD=uma-senha-forte npm start   # http://localhost:3001
```

Sem `ADMIN_PASSWORD`, o jogo funciona normalmente e só o painel admin fica desativado.

Variáveis opcionais: `PORT` (padrão 3001) e `DADOS_PATH` (padrão `data/dados.json`).

## Como funciona a imparcialidade

- Cada rodada sorteia **o mesmo número de itens de cada político** e embaralha a ordem.
- Cada político tem itens que tendem a agradar e itens que tendem a desagradar públicos diferentes.
- O texto mostrado começa com "Uma pessoa…" e evita nomes, cargos e pistas diretas. O autor só aparece no resultado.
- A pontuação é o **percentual de concordância**: apoios ÷ (apoios + não apoios) por político. "Sem opinião" não conta.
- Todo item e todo fato da ficha tem fonte. Fontes com alinhamento político declarado (partidos, fundações partidárias, sindicatos) estão sinalizadas no título.
- Na ficha, a situação de cada processo é descrita com o termo jurídico correto (indiciado ≠ réu ≠ condenado; anulado e arquivado também aparecem).

## Painel admin

Acesse `/#/admin` (há um link discreto no rodapé) e entre com a senha. Nele dá para criar, editar e remover:

- **Perguntas do quiz**: autor (oculto no jogo), tipo (fez, falou, defendeu, apoiou, propõe), tema, texto anonimizado, contexto revelado no final e fontes.
- **Fichas**: realizações, polêmicas/processos e propostas de cada político.
- **Políticos**: para incluir outros nomes no jogo.

Fontes são digitadas uma por linha no formato `Título | https://link`.

Tudo fica salvo em `data/dados.json`. Para mudanças feitas em produção irem para o repositório, faça commit desse arquivo.

## Estrutura

```
quiz-politico/
├── server.js            # API Express + serve o build
├── data/dados.json      # políticos, perguntas e fichas (com fontes)
└── src/
    ├── App.jsx          # navegação entre telas
    ├── quiz.js          # sorteio balanceado e cálculo do resultado
    └── components/      # Inicio, Quiz, Resultado, Fichas, Admin
```

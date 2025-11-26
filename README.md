💜🩷 Sistema DITL - Agenda & Execução 💜🩷

Sistema de gestão de agenda, execução e relatórios de atividades DITL para operações de satélite.

📋 Sobre o projeto

O Sistema DITL é uma aplicação web completa para gerenciamento de tarefas operacionais em turnos, com foco em atividades de satélite. O sistema permite importar planilhas de atividades, executar tarefas com cronometragem precisa, coletar evidências e gerar relatórios detalhados em PDF.

✨ Funcionalidades

📊 Cadastro e importação
- *Importação de planilhas* (XLSX/CSV) com mapeamento inteligente de colunas
- *Visualização e filtro* de atividades carregadas
- *Validação automática* de dados importados

⚙️ Execução de turnos
- *Gerenciamento de turnos* (iniciar, pausar, reiniciar, encerrar)
- *Cronômetros individuais* por tarefa com três modos:
  - *Countdown*: contagem regressiva com tempo máximo
  - *Manual**: cronometragem progressiva livre
  - *Scheduled*: tarefas programadas por horário
- *Auto-save* a cada 5 segundos para evitar perda de dados
- *Relógio mestre* com tempo decorrido e tempo restante do turno
- *Sistema de notificações* para alertas e tarefas atrasadas
- *Coleta de evidências**: operador, observações e até 3 fotos por tarefa

📈 Relatórios
- *Relatórios unitários* por tarefa (PDF)
- *Relatório consolidado* do turno completo (PDF)
- *Geração de PDF em alta qualidade* com paginação automática
- *Download em ZIP* de todas as evidências fotográficas
- *Exportação de backup* em JSON

🛠️ Tecnologias utilizadas

Front-end
- HTML5, CSS3, JavaScript (ES6+)
- *html2canvas* - captura de elementos para PDF
- *jsPDF* - geração de relatórios PDF
- *SheetJS (XLSX)* - leitura de planilhas Excel
- *JSZip* - compactação de arquivos

Back-end
- *Node.js* com *Express*
- *MySQL* (via mysql2)
- *dotenv* - gerenciamento de variáveis de ambiente
- *CORS* - habilitação de requisições cross-origin

Arquitetura
- **REST API** com rotas organizadas
- **Persistência em banco de dados** MySQL
- **Auto-save** e recuperação de estado
- **Transações** para integridade de dados

📦 Estrutura do Projeto

```
sistema-ditl/
├── back-end/
│   ├── routes/
│   │   └── api.js          # Rotas da API REST
│   ├── .env.example        # Exemplo de configuração
│   ├── server.js           # Servidor Express
│   ├── script.sql          # Script de criação do BD
│   ├── package.json
│   └── package-lock.json
├── css/
│   └── styles.css          # Estilos da aplicação
├── js/
│   └── script.js           # Lógica principal do front-end
├── public/
│   └── image/
│       ├── Logo.png
│       └── favicon.png
├── index.html              # Página principal 
├── .gitignore
└── README.md
```

🚀 Instalação e Configuração

### Pré-requisitos
- **Node.js** (versão 18 ou superior)
- **MySQL** (versão 8 ou superior)
- Navegador web moderno (Chrome, Firefox, Edge)

### Passo 1: Clone o repositório
```bash
git clone https://github.com/seu-usuario/sistema-ditl.git
cd sistema-ditl
```

### Passo 2: Configure o banco de dados
1. Abra o MySQL e execute o script de criação:
```bash
mysql -u root -p < back-end/script.sql
```

2. Ou copie e execute manualmente os comandos do arquivo `back-end/script.sql`

### Passo 3: Configure as variáveis de ambiente
1. Navegue até a pasta `back-end`:
```bash
cd back-end
```

2. Crie um arquivo `.env` baseado no `.env.example`:
```bash
cp .env.example .env
```

3. Edite o arquivo `.env` com suas credenciais do MySQL:
```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=sua_senha_aqui
DB_NAME=sistema_ditl
```

Passo 4: Instale as dependências
```bash
npm install
```

Passo 5: Inicie o servidor
```bash
node server.js
```

O sistema estará disponível em: **http://localhost:3000**

📖 Como Usar

💠 1. Importar Atividades
1. Acesse a aba *"Cadastro / Import"*
2. Clique em *"Importar arquivo"* e selecione sua planilha XLSX/CSV
3. Confirme o mapeamento das colunas no modal
4. As atividades serão carregadas e exibidas para revisão

*Formato esperado da planilha:*
- `T + (hh:mm)` - Tempo previsto (ex: 01:30)
- `Proc. ID` - Identificador do procedimento
- `Event` - Grupo/categoria do evento
- `Event / Action` - Nome da atividade
- `Key Acceptance Criteria` - Critérios de aceitação

💠 2. Iniciar um Turno
1. Vá para a aba *"Execução"*
2. Clique em *"Iniciar turno"*
3. O sistema criará automaticamente as tarefas e iniciará o cronômetro da primeira

💠 3. Executar Tarefas
- *Pausar*: Para temporariamente o cronômetro
- *Retomar*: Continua a execução de onde parou
- *SUCESSO/FALHA*: Abre o modal para coletar evidências e finalizar

💠 4. Coletar Evidências
- Preencha o *ID do Operador* (obrigatório)
- Adicione *observações* sobre a execução (obrigatório)
- Anexe até *3 fotos* como evidência (opcional)
- Confirme para finalizar a tarefa

💠 5. Gerar Relatórios
1. Acesse a aba *"Relatórios"*
2. Selecione um turno para visualizar o relatório completo
3. Use *"Baixar PDF"* para exportar
4. Use *"Relatório final"* para gerar um PDF consolidado de todos os turnos

🔧 Funcionalidades Avançadas

⚪ Auto-Save
O sistema salva automaticamente o progresso a cada **5 segundos** durante a execução de tarefas, evitando perda de dados em caso de falhas.

⚪ Recuperação de Estado
Ao recarregar a página, o sistema recupera automaticamente:
- Turno ativo
- Progresso das tarefas
- Cronômetros em execução
- Evidências coletadas

⚪ Reiniciar tarefa
Tarefas finalizadas com *falha* podem ser reiniciadas do zero, limpando todos os dados de execução e evidências.

⚪ Notificações
- Alertas de tarefas atrasadas
- Avisos de próxima tarefa
- Confirmações de ações críticas

🎨 Interface

O sistema possui um design moderno e responsivo com:
- *Tema escuro* para reduzir fadiga visual
- *Layout em abas* para organização clara
- *Indicadores visuais* de status (cores, badges)
- *Modais* para ações importantes
- *Responsividade* para diferentes tamanhos de tela

👥 Equipe de Desenvolvimento

Desenvolvido por estudantes da *UCB (Universidade Católica de Brasília)*:
- Lia Costa (https://github.com/LiaCost)
- Lucas Paulo (https://github.com/Lucas-Paulo-Farias)
- Luiz Henrique (https://github.com/LuizHenrique777S)
- Marina Monalisa (https://github.com/MarinaMonalisa29)
- Sarah Silva (https://github.com/sah524)
- Patrícia Isabella (https://github.com/patriciaIsabella)

📄 Licença
© 2025 - Todos os direitos reservados.

*Desenvolvido com ❤️ para operações de satélite*

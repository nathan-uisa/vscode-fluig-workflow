# Fluig Workflow Manager (`vscode-fluig-workflow`)

[![VS Code](https://img.shields.io/badge/VS%20Code-1.80.0+-blue.svg)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-nathan--uisa%2Fvscode--fluig--workflow-181717.svg?logo=github)](https://github.com/nathan-uisa/vscode-fluig-workflow)

Extensao autonoma para **Visual Studio Code** que possibilita a **importacao** e **exportacao completa** de processos BPMN (`.process`) da plataforma TOTVS Fluig **sem depender do Eclipse Luna** ou de plugins legados.

---

## Por que esta extensao foi criada?

As extensoes existentes no ecossistema Fluig para VS Code possuem limitacoes criticas no gerenciamento de processos:

| Recurso | `andretimm/vscode-fluig` | `fluiggers/fluig-vscode-extension` | **`vscode-fluig-workflow`** |
| :--- | :---: | :---: | :---: |
| **Modelador Visual BPMN 2.0 (Drag & Drop)** | Nao suportado | Apenas visualizacao SVG | **Sim (Edicao visual interativa)** |
| **Exportar Processos (`.process`)** | Nao suportado | Requer Eclipse Luna + Java legado | **Sim (100% autonomo)** |
| **Importar Processos do Servidor** | Nao suportado | Nao suportado | **Sim (SOAP + REST v2)** |
| **Download de Eventos de Processo** | Nao suportado | Nao suportado | **Sim (`workflow/scripts`)** |
| **Independencia de Eclipse / Java** | Sim | Depende de runtime Eclipse Luna | **Sim (Gera ECM30 & SVG nativamente)** |
| **Gerenciador de Servidores & Sidebar** | Basico | Basico | **TreeViews dedicadas com Acoes Rapidas** |

---

## Funcionalidades

1. **Modelador BPMN 2.0 Visual e Interativo (Sem Eclipse)**
   - Edite diagramas BPMN diretamente no VS Code com paleta drag-and-drop, context pads, anotacoes e conexoes.
   - **Paleta de Cores Oficial Fluig:** Cores oficiais para Inicio (verde), Fim (vermelho), Tarefas (azul), Gateways (laranja) e Intermediarios (amarelo), com seletor de cores customizado e persistencia BPMN-in-Color.
   - **Edicao de Propriedades do Processo:** Edite a Descricao do Processo e o ID do Formulario GED/ECM (`formId`) vinculado.
   - **Gerador de Scripts de Atividades:** Clique em qualquer atividade de servico para gerar ou abrir o respectivo script JS (`<processId>.servicetask<Seq>.js`) com template Fluig pronto.
   - **Salvamento Sincronizado (`Ctrl + S`):** Atualiza simultaneamente o `.process`, o `.svg` e o `.ecm30.xml`.
   - **Exportacao Direta:** Envio de novas versoes ao servidor Fluig diretamente pelo editor.

2. **Exportacao de Processos (`.process`)**
   - Converte os diagramas BPMN `.process` para os formatos nativos exigidos pelo Fluig (`.ecm30.xml` e `.svg`).
   - Autentica via token no `TokenService` do Fluig.
   - Envia o pacote completo via SOAP `WorkflowEngineService:importProcess`.
   - Pergunta se deseja **Liberar a nova versao** imediatamente ou mante-la como rascunho.
   - Incrementa automaticamente a versao do processo.

3. **Importacao de Processos do Servidor**
   - Lista todos os processos ativos no servidor Fluig configurado.
   - Cria o diagrama `.process` no padrao BPMN 2.0 em `workflow/diagrams/<processId>.process`.
   - Gera automaticamente os arquivos auxiliares de compatibilidade (`<processId>.ecm30.xml` e `<processId>.svg`).
   - Conecta a API REST v2 (`/process-management/api/v2/processes/...`) e baixa todos os scripts de eventos cadastrados no servidor para `workflow/scripts/<processId>.<evento>.js`. Se o processo nao contiver scripts customizados, cria automaticamente templates para os principais eventos (`beforeTaskSave`, `afterTaskSave`, etc.).

4. **Gerenciador de Servidores Fluig**
   - Cadastro intuitivo de multiplos ambientes (Desenvolvimento, Homologacao, Producao).
   - Alternancia rapida do servidor ativo diretamente pela barra lateral do VS Code.

5. **Painel Lateral Dedicado (Activity Bar)**
   - Painel com o icone do Fluig na barra lateral.
   - **Servidores Fluig**: Visualizacao e gerenciamento de conexoes.
   - **Processos do Servidor**: Listagem dos fluxos disponiveis no servidor ativo com botao de importacao direta com 1 clique.

6. **Compilacao Continua (On-Save)**
   - Ao salvar um arquivo `.process`, os artefatos `<processId>.ecm30.xml` e `<processId>.svg` sao sincronizados automaticamente no projeto.

---

## Estrutura de Pastas Padrao Fluig

A extensao adota e respeita a estrutura oficial de projetos Fluig:

```
meu-projeto-fluig/
├── workflow/
│   ├── diagrams/
│   │   ├── solicitacao_compras.process
│   │   ├── solicitacao_compras.ecm30.xml   (gerado automaticamente)
│   │   └── solicitacao_compras.svg         (gerado automaticamente)
│   └── scripts/
│       ├── solicitacao_compras.beforeTaskSave.js
│       ├── solicitacao_compras.afterTaskSave.js
│       └── solicitacao_compras.calculateAgreement.js
└── forms/
```

---

## Instalacao

### Opcao 1: Download da Release no GitHub (Recomendado)

1. Acesse a pagina de Releases do repositorio:
   [GitHub Releases - vscode-fluig-workflow](https://github.com/nathan-uisa/vscode-fluig-workflow/releases/latest)
2. Faca o download do arquivo `vscode-fluig-workflow-0.1.6.vsix`.
3. No VS Code:
   - Abra a aba de **Extensoes** (`Ctrl + Shift + X`).
   - Clique no menu de tres pontinhos (`...`) no canto superior do painel de extensoes.
   - Selecione **Instalar a partir de VSIX...** (`Install from VSIX...`) e selecione o arquivo baixado.

**Ou instale via terminal em 1 comando:**
```powershell
Invoke-WebRequest -Uri "https://github.com/nathan-uisa/vscode-fluig-workflow/releases/download/v0.1.6/vscode-fluig-workflow-0.1.6.vsix" -OutFile "vscode-fluig-workflow.vsix"; code --install-extension vscode-fluig-workflow.vsix
```

### Opcao 2: A partir do Codigo Fonte

```bash
git clone https://github.com/nathan-uisa/vscode-fluig-workflow.git
cd vscode-fluig-workflow
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension vscode-fluig-workflow-0.1.6.vsix
```

### Definir como Editor Padrao para `.process`

Para garantir que o duplo clique em qualquer arquivo `.process` abra diretamente este modelador visual moderno (e nao extensao de terceiros com dependencias do Eclipse), adicione ao seu `settings.json` do VS Code:

```json
"workbench.editorAssociations": {
  "*.process": "fluigWorkflow.diagramEditor"
}
```

---

## Como Usar

### 1. Cadastrar um Servidor Fluig
1. Clique no icone do **Fluig Workflow** na barra de atividades lateral do VS Code.
2. Na secao **Servidores Fluig**, clique no botao `+` (Adicionar Servidor).
3. Preencha os dados:
   - **Nome:** Ex: `Fluig Homologacao`
   - **URL:** Ex: `https://fluig.minhaempresa.com.br`
   - **Empresa (companyId):** Ex: `1`
   - **Login e Senha:** Credenciais com permissao de importacao/exportacao de workflow.
   - **Matricula:** Codigo do colaborador (ex: `admin` ou `00123`).

### 2. Importar um Processo do Servidor
- **Opcao A (Pela arvore):** No painel **Processos do Servidor**, localize o processo desejado e clique no botao de download (**Importar Processo**).
- **Opcao B (Pelo menu de comandos):** Pressione `Ctrl + Shift + P` (ou `Cmd + Shift + P`), digite `Fluig: Importar Processo do Servidor...` e selecione na lista.

### 3. Exportar um Processo para o Servidor
1. Abra ou clique com o botao direito no arquivo `.process` desejado (em `workflow/diagrams/`).
2. Selecione **Exportar Processo para o Servidor** no menu de contexto (ou pelo atalho na barra superior do editor).
3. Escolha se deseja **Exportar e Liberar Versao** ou **Exportar sem Liberar (Rascunho)**.
4. A extensao compilara os artefatos, submetera via Web Service SOAP e notificara a versao criada no servidor.

---

## Configuracoes da Extensao (`settings.json`)

Voce pode personalizar o comportamento da extensao adicionando as seguintes chaves as suas configuracoes:

```json
{
  // Compila ecm30.xml e SVG automaticamente ao salvar um arquivo .process
  "fluigWorkflow.autoGenerateEcm30OnSave": true,

  // Libera a nova versao do processo por padrao ao exportar
  "fluigWorkflow.defaultRelease": true
}
```

---

## Desenvolvimento e Build

Para compilar e testar a extensao localmente:

```bash
# Instalar dependencias
npm install

# Compilar TypeScript
npm run compile

# Modo observacao durante desenvolvimento
npm run watch
```

Para gerar o pacote de instalacao `.vsix`:
```bash
npx @vscode/vsce package
```

E para instalar no VS Code:
```bash
code --install-extension vscode-fluig-workflow-0.1.6.vsix
```

---

## Licenca

Distribuido sob a licenca **MIT**. Consulte o arquivo [LICENSE](LICENSE) para obter mais informacoes.

Desenvolvido por [Nathan Renner](https://github.com/nathan-uisa).

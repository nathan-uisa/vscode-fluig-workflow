# Fluig Workflow Manager (`vscode-fluig-workflow`)

[![VS Code](https://img.shields.io/badge/VS%20Code-1.80.0+-blue.svg)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-nathan--uisa%2Fvscode--fluig--workflow-181717.svg?logo=github)](https://github.com/nathan-uisa/vscode-fluig-workflow)

Extensão autônoma para **Visual Studio Code** que possibilita a **importação** e **exportação completa** de processos BPMN (`.process`) da plataforma TOTVS Fluig **sem depender do Eclipse Luna** ou de plugins legados.

---

## 🎯 Por que esta extensão foi criada?

As extensões existentes no ecossistema Fluig para VS Code possuem limitações críticas no gerenciamento de processos:

| Recurso | `andretimm/vscode-fluig` | `fluiggers/fluig-vscode-extension` | **`vscode-fluig-workflow`** |
| :--- | :---: | :---: | :---: |
| **Exportar Processos (`.process`)** | ❌ Não suportado | ⚠️ Requer Eclipse Luna + Java antigo | ✅ **Sim (100% autônomo)** |
| **Importar Processos do Servidor** | ❌ Não suportado | ❌ Não suportado | ✅ **Sim (SOAP + REST v2)** |
| **Download de Eventos de Processo** | ❌ Não suportado | ❌ Não suportado | ✅ **Sim (`workflow/scripts`)** |
| **Independência de Eclipse / Java** | ✅ Sim | ❌ Depende de runtime Eclipse Luna | ✅ **Sim (Gera ECM30 & SVG nativamente)** |
| **Gerenciador de Servidores & Sidebar** | ⚠️ Básico | ⚠️ Básico | ✅ **TreeViews dedicadas com Ações Rápidas** |

---

## ✨ Funcionalidades

1. **Exportação de Processos (`.process`)**
   - Converte os diagramas BPMN `.process` para os formatos nativos exigidos pelo Fluig (`.ecm30.xml` e `.svg`).
   - Autentica via token no `TokenService` do Fluig.
   - Envia o pacote completo via SOAP `WorkflowEngineService:importProcess`.
   - Pergunta se deseja **Liberar a nova versão** imediatamente ou mantê-la como rascunho.
   - Incrementa automaticamente a versão do processo.

2. **Importação de Processos do Servidor**
   - Lista todos os processos ativos no servidor Fluig configurado.
   - Cria o diagrama `.process` no padrão BPMN 2.0 em `workflow/diagrams/<processId>.process`.
   - Gera automaticamente os arquivos auxiliares de compatibilidade (`<processId>.ecm30.xml` e `<processId>.svg`).
   - Conecta à API REST v2 (`/process-management/api/v2/processes/...`) e baixa todos os scripts de eventos cadastrados no servidor para `workflow/scripts/<processId>.<evento>.js`. Se o processo não contiver scripts customizados, cria automaticamente templates para os principais eventos (`beforeTaskSave`, `afterTaskSave`, etc.).

3. **Gerenciador de Servidores Fluig**
   - Cadastro intuitivo de múltiplos ambientes (Desenvolvimento, Homologação, Produção).
   - Alternância rápida do servidor ativo diretamente pela barra lateral do VS Code.

4. **Painel Lateral Dedicado (Activity Bar)**
   - Painel com o ícone oficial do Fluig na barra lateral.
   - **Servidores Fluig**: Visualização e gerenciamento de conexões.
   - **Processos do Servidor**: Listagem dos fluxos disponíveis no servidor ativo com botão de importação direta com 1 clique.

5. **Compilação Contínua (On-Save)**
   - Ao salvar um arquivo `.process`, os artefatos `<processId>.ecm30.xml` e `<processId>.svg` são sincronizados automaticamente no projeto.

---

## 📁 Estrutura de Pastas Padrão Fluig

A extensão adota e respeita a estrutura oficial de projetos Fluig:

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

## 🚀 Como Usar

### 1. Cadastrar um Servidor Fluig
1. Clique no ícone do **Fluig Workflow** na barra de atividades lateral do VS Code.
2. Na seção **Servidores Fluig**, clique no botão `+` (Adicionar Servidor).
3. Preencha os dados:
   - **Nome:** Ex: `Fluig Homologação`
   - **URL:** Ex: `https://fluig.minhaempresa.com.br`
   - **Empresa (companyId):** Ex: `1`
   - **Login e Senha:** Credenciais com permissão de importação/exportação de workflow.
   - **Matrícula:** Código do colaborador (ex: `admin` ou `00123`).

### 2. Importar um Processo do Servidor
- **Opção A (Pela árvore):** No painel **Processos do Servidor**, localize o processo desejado e clique no ícone de nuvem com seta para baixo (**Importar Processo**).
- **Opção B (Pelo menu de comandos):** Pressione `Ctrl + Shift + P` (ou `Cmd + Shift + P`), digite `Fluig: Importar Processo do Servidor...` e selecione na lista.

### 3. Exportar um Processo para o Servidor
1. Abra ou clique com o botão direito no arquivo `.process` desejado (em `workflow/diagrams/`).
2. Selecione **Exportar Processo para o Servidor** no menu de contexto (ou pelo atalho na barra superior do editor).
3. Escolha se deseja **Exportar e Liberar Versão** ou **Exportar sem Liberar (Rascunho)**.
4. A extensão compilará os artefatos, submeterá via Web Service SOAP e notificará a versão criada no servidor.

---

## ⚙️ Configurações da Extensão (`settings.json`)

Você pode personalizar o comportamento da extensão adicionando as seguintes chaves às suas configurações:

```json
{
  // Compila ecm30.xml e SVG automaticamente ao salvar um arquivo .process
  "fluigWorkflow.autoGenerateEcm30OnSave": true,

  // Libera a nova versão do processo por padrão ao exportar
  "fluigWorkflow.defaultRelease": true
}
```

---

## 🛠️ Desenvolvimento e Build

Para compilar e testar a extensão localmente:

```bash
# Instalar dependências
npm install

# Compilar TypeScript
npm run compile

# Modo observação durante desenvolvimento
npm run watch
```

Para gerar o pacote de instalação `.vsix`:
```bash
npx @vscode/vsce package
```

E para instalar no VS Code:
```bash
code --install-extension vscode-fluig-workflow-0.1.0.vsix
```

---

## 📄 Licença

Distribuído sob a licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para obter mais informações.

Desenvolvido por [Nathan Renner](https://github.com/nathan-uisa).

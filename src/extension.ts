import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ServerService } from './services/ServerService';
import { WorkflowSoapService } from './services/WorkflowSoapService';
import { ProcessExportService } from './services/ProcessExportService';
import { ProcessImportService } from './services/ProcessImportService';
import { Ecm30GeneratorService } from './services/Ecm30GeneratorService';
import { DiagramViewerService } from './services/DiagramViewerService';
import { FluigTypingsService } from './services/FluigTypingsService';
import { ServerTreeProvider, ServerTreeItem } from './views/ServerTreeProvider';
import { ProcessTreeProvider, ProcessTreeItem } from './views/ProcessTreeProvider';
import { ProcessCustomEditorProvider } from './providers/ProcessCustomEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Fluig Workflow');
  outputChannel.appendLine('Extensão Fluig Workflow ativada.');

  // Inicializa Serviços
  WorkflowSoapService.initialize(context);
  DiagramViewerService.initialize(context);
  FluigTypingsService.initialize(context);
  FluigTypingsService.ensureTypings().catch(() => {});
  const serverService = new ServerService(context);
  const exportService = new ProcessExportService(serverService);
  const importService = new ProcessImportService(serverService);

  // Registra Custom Editor para arquivos .process
  const customEditorRegistration = ProcessCustomEditorProvider.register(context);

  // Inicializa Provedores de TreeView
  const serverTreeProvider = new ServerTreeProvider(serverService);
  const processTreeProvider = new ProcessTreeProvider(serverService);

  vscode.window.registerTreeDataProvider('fluigWorkflowServers', serverTreeProvider);
  vscode.window.registerTreeDataProvider('fluigWorkflowProcesses', processTreeProvider);

  const refreshAllViews = () => {
    serverTreeProvider.refresh();
    processTreeProvider.refresh();
  };

  // 1. Adicionar Servidor
  const addServerCmd = vscode.commands.registerCommand('fluigWorkflow.addServer', async () => {
    const server = await serverService.promptAddServer();
    if (server) {
      refreshAllViews();
    }
  });

  // 2. Selecionar Servidor Ativo
  const selectServerCmd = vscode.commands.registerCommand('fluigWorkflow.selectServer', async () => {
    const server = await serverService.promptSelectServer();
    if (server) {
      refreshAllViews();
    }
  });

  // 3. Remover Servidor
  const removeServerCmd = vscode.commands.registerCommand('fluigWorkflow.removeServer', async (item?: ServerTreeItem) => {
    let serverId = item?.server?.id;
    let serverName = item?.server?.name;

    if (!serverId) {
      const servers = serverService.getServers();
      if (servers.length === 0) {
        vscode.window.showInformationMessage('Nenhum servidor cadastrado.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        servers.map(s => ({
          label: s.name,
          description: s.baseUrl,
          server: s
        })),
        { placeHolder: 'Selecione o servidor para remover' }
      );

      if (!picked) return;
      serverId = picked.server.id;
      serverName = picked.server.name;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Deseja realmente remover a configuração do servidor '${serverName}'?`,
      { modal: true },
      'Sim, remover'
    );

    if (confirm === 'Sim, remover') {
      await serverService.removeServer(serverId);
      vscode.window.showInformationMessage(`Servidor '${serverName}' removido.`);
      refreshAllViews();
    }
  });

  // 4. Listar / Atualizar Processos
  const listProcessesCmd = vscode.commands.registerCommand('fluigWorkflow.listProcesses', () => {
    processTreeProvider.refresh(true);
    vscode.window.showInformationMessage('Atualizando lista e versões dos processos do servidor...');
  });

  // 5. Importar Processo
  const importProcessCmd = vscode.commands.registerCommand('fluigWorkflow.importProcess', async (arg?: ProcessTreeItem | vscode.Uri | any) => {
    let processId: string | undefined;

    if (arg instanceof ProcessTreeItem) {
      processId = arg.process.processId;
    } else if (arg && typeof arg === 'object' && 'process' in arg && arg.process?.processId) {
      processId = arg.process.processId;
    } else if (typeof arg === 'string') {
      processId = arg;
    }

    await importService.importProcess(processId);
    processTreeProvider.refresh();
  });

  // 6. Exportar Processo
  const exportProcessCmd = vscode.commands.registerCommand('fluigWorkflow.exportProcess', async (uri?: vscode.Uri) => {
    await exportService.exportProcess(uri);
    processTreeProvider.refresh();
  });

  // 7. Gerar Artefatos ECM30 e SVG
  const generateEcm30Cmd = vscode.commands.registerCommand('fluigWorkflow.generateEcm30', async (uri?: vscode.Uri) => {
    let targetUri = uri;
    if (!targetUri) {
      const activeDoc = vscode.window.activeTextEditor?.document.uri;
      if (activeDoc && activeDoc.fsPath.endsWith('.process')) {
        targetUri = activeDoc;
      }
    }

    if (!targetUri || !targetUri.fsPath.endsWith('.process')) {
      vscode.window.showErrorMessage('Selecione um arquivo .process para compilar.');
      return;
    }

    try {
      const artifacts = Ecm30GeneratorService.ensureArtifacts(targetUri.fsPath, true);
      const ecmBase = path.basename(artifacts.ecm30Path);
      const svgBase = path.basename(artifacts.svgPath);
      vscode.window.showInformationMessage(`Artefatos gerados com sucesso: ${ecmBase} e ${svgBase}`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Erro ao gerar artefatos: ${error.message || error}`);
    }
  });

  // 8. Visualizar Diagrama BPMN/SVG
  const viewDiagramCmd = vscode.commands.registerCommand('fluigWorkflow.viewDiagram', async (target?: any) => {
    let targetArg = target;
    if (targetArg && typeof targetArg === 'object' && 'process' in targetArg && targetArg.process?.processId) {
      targetArg = targetArg.process.processId;
    }
    if (!targetArg) {
      const activeDoc = vscode.window.activeTextEditor?.document.uri;
      if (activeDoc && (activeDoc.fsPath.endsWith('.process') || activeDoc.fsPath.endsWith('.svg') || activeDoc.fsPath.endsWith('.ecm30.xml'))) {
        targetArg = activeDoc;
      } else {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          const diagramsDir = path.join(workspaceFolder.uri.fsPath, 'workflow', 'diagrams');
          if (fs.existsSync(diagramsDir)) {
            const files = fs.readdirSync(diagramsDir);
            const processIds = Array.from(new Set(
              files
                .filter(f => f.endsWith('.process') || f.endsWith('.svg') || f.endsWith('.ecm30.xml'))
                .map(f => f.replace(/\.(process|svg|ecm30\.xml)$/, ''))
            ));

            if (processIds.length > 0) {
              const picked = await vscode.window.showQuickPick(
                processIds.map(id => ({ label: id, description: `workflow/diagrams/${id}` })),
                { placeHolder: 'Selecione o processo para visualizar o diagrama' }
              );
              if (picked) targetArg = picked.label;
            }
          }
        }
      }
    }

    if (targetArg) {
      await DiagramViewerService.openDiagram(targetArg);
    } else {
      vscode.window.showWarningMessage('Nenhum processo selecionado para visualização.');
    }
  });

  // 8. Configurar IntelliSense e Tipagens Fluig
  const setupIntelliSenseCmd = vscode.commands.registerCommand('fluigWorkflow.setupIntelliSense', async () => {
    await FluigTypingsService.ensureTypings(undefined, true);
  });

  // Auto-geração de artefatos ao salvar arquivo .process
  const onSaveListener = vscode.workspace.onDidSaveTextDocument(document => {
    if (document.fileName.endsWith('.process')) {
      const config = vscode.workspace.getConfiguration('fluigWorkflow');
      const autoGen = config.get<boolean>('autoGenerateEcm30OnSave', true);

      if (autoGen) {
        try {
          Ecm30GeneratorService.ensureArtifacts(document.fileName, false);
          outputChannel.appendLine(`[Auto-compile] Atualizados artefatos ECM30/SVG para ${document.fileName}`);
        } catch (err: any) {
          outputChannel.appendLine(`[Auto-compile Error] ${err.message || err}`);
        }
      }
    }
  });

  context.subscriptions.push(
    outputChannel,
    customEditorRegistration,
    addServerCmd,
    selectServerCmd,
    removeServerCmd,
    listProcessesCmd,
    importProcessCmd,
    exportProcessCmd,
    generateEcm30Cmd,
    viewDiagramCmd,
    setupIntelliSenseCmd,
    onSaveListener
  );
}

export function deactivate() {}

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ServerService } from './ServerService';
import { WorkflowSoapService, SoapAttachment } from './WorkflowSoapService';
import { Ecm30GeneratorService } from './Ecm30GeneratorService';

export class ProcessExportService {
  constructor(private serverService: ServerService) {}

  public async exportProcess(uri?: vscode.Uri): Promise<void> {
    try {
      const processUri = this.resolveProcessUri(uri);
      if (!processUri) {
        vscode.window.showWarningMessage('Por favor, selecione um arquivo .process para exportar.');
        return;
      }

      const server = this.serverService.getActiveServer();
      if (!server) {
        const add = await vscode.window.showErrorMessage(
          'Nenhum servidor Fluig ativo configurado.',
          'Configurar Servidor'
        );
        if (add === 'Configurar Servidor') {
          await this.serverService.promptSelectServer();
        }
        return;
      }

      const processPath = processUri.fsPath;
      const processId = path.basename(processPath, '.process');

      // Pergunta se deseja liberar a versão
      const config = vscode.workspace.getConfiguration('fluigWorkflow');
      const defaultRelease = config.get<boolean>('defaultRelease', true);

      const releasePick = await vscode.window.showQuickPick(
        [
          {
            label: '$(check) Exportar e Liberar Versão',
            description: 'Salva o fluxo e disponibiliza para os usuários',
            release: true
          },
          {
            label: '$(edit) Exportar sem Liberar (Rascunho)',
            description: 'Salva a versão como rascunho sem liberar no Fluig',
            release: false
          }
        ],
        { placeHolder: `Exportar processo ${processId} para ${server.name}` }
      );

      if (!releasePick) {
        return;
      }

      const shouldRelease = releasePick.release;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Exportando processo ${processId} para ${server.name}...`,
          cancellable: false
        },
        async progress => {
          progress.report({ message: 'Compilando artefatos ECM30 e SVG...' });
          const artifacts = Ecm30GeneratorService.ensureArtifacts(processPath);

          const soapService = new WorkflowSoapService(server);

          progress.report({ message: 'Verificando versão existente no servidor...' });
          const currentVersion = await soapService.getProcessVersion(processId, true);
          const isNewProcess = currentVersion === 0;

          if (!isNewProcess) {
            progress.report({ message: `Criando rascunho de nova versão (atual: v${currentVersion})...` });
            await soapService.createProcessVersion(processId);
          }

          progress.report({ message: 'Enviando pacote do processo via SOAP...' });
          const attachments: SoapAttachment[] = [
            {
              fileName: path.basename(artifacts.ecm30Path),
              content: artifacts.ecm30Content,
              principal: true,
              processImage: false
            },
            {
              fileName: path.basename(artifacts.svgPath),
              content: artifacts.svgContent,
              principal: false,
              processImage: true
            }
          ];

          await soapService.importProcess(processId, attachments, isNewProcess);

          if (shouldRelease) {
            progress.report({ message: 'Liberando versão do processo...' });
            await soapService.releaseProcess(processId);
          }

          const newVersion = await soapService.getProcessVersion(processId, true);

          vscode.window.showInformationMessage(
            `Processo ${processId} exportado com sucesso para ${server.name}! (Versão: ${newVersion || currentVersion + 1})`
          );
        }
      );
    } catch (error: any) {
      vscode.window.showErrorMessage(`Falha na exportação do processo: ${error.message || error}`);
    }
  }

  private resolveProcessUri(uri?: vscode.Uri): vscode.Uri | undefined {
    if (uri && uri.fsPath.endsWith('.process')) {
      return uri;
    }
    const activeDoc = vscode.window.activeTextEditor?.document.uri;
    if (activeDoc && activeDoc.fsPath.endsWith('.process')) {
      return activeDoc;
    }
    return undefined;
  }
}

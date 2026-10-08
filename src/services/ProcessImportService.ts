import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ServerService } from './ServerService';
import { WorkflowSoapService } from './WorkflowSoapService';
import { WorkflowRestService } from './WorkflowRestService';
import { Ecm30GeneratorService } from './Ecm30GeneratorService';
import { ProcessItemSummary } from '../models/Process';

export class ProcessImportService {
  constructor(private serverService: ServerService) {}

  public async importProcess(selectedProcessId?: string): Promise<void> {
    try {
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

      let processId = selectedProcessId;
      let processDesc = '';

      if (!processId) {
        // Busca listagem de processos no servidor
        const processes = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Buscando processos disponíveis em ${server.name}...`,
            cancellable: false
          },
          async () => {
            const soapService = new WorkflowSoapService(server);
            return await soapService.getAllProcesses();
          }
        );

        if (processes.length === 0) {
          vscode.window.showWarningMessage('Nenhum processo retornado pelo servidor.');
          return;
        }

        const picked = await vscode.window.showQuickPick(
          processes.map(p => ({
            label: p.processId,
            description: p.processDescription,
            detail: `Versão: ${p.version}`,
            process: p
          })),
          { placeHolder: 'Selecione o processo que deseja importar para o projeto local' }
        );

        if (!picked) return;
        processId = picked.process.processId;
        processDesc = picked.process.processDescription;
      }

      // Valida workspace aberto
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('Abra uma pasta no VS Code antes de importar o processo.');
        return;
      }

      const rootPath = workspaceFolder.uri.fsPath;
      const diagramsDir = path.join(rootPath, 'workflow', 'diagrams');
      const scriptsDir = path.join(rootPath, 'workflow', 'scripts');

      if (!fs.existsSync(diagramsDir)) {
        fs.mkdirSync(diagramsDir, { recursive: true });
      }
      if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, { recursive: true });
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Importando processo ${processId}...`,
          cancellable: false
        },
        async progress => {
          progress.report({ message: 'Construindo estrutura do diagrama .process...' });

          const processFilePath = path.join(diagramsDir, `${processId}.process`);
          if (!fs.existsSync(processFilePath)) {
            const initialXmi = this.createDefaultProcessXmi(processId!, processDesc || processId!);
            fs.writeFileSync(processFilePath, initialXmi, 'utf-8');
          }

          // Gera artefatos ECM30 e SVG correspondentes
          progress.report({ message: 'Gerando artefatos locais...' });
          Ecm30GeneratorService.ensureArtifacts(processFilePath);

          // Tenta baixar eventos via REST
          progress.report({ message: 'Buscando scripts de eventos...' });
          const restService = new WorkflowRestService(server);
          const remoteEvents = await restService.getProcessEvents(processId!);

          let createdScripts = 0;
          if (remoteEvents.length > 0) {
            for (const ev of remoteEvents) {
              const eventFile = path.join(scriptsDir, `${processId}.${ev.eventName}.js`);
              if (!fs.existsSync(eventFile) && ev.code) {
                fs.writeFileSync(eventFile, ev.code, 'utf-8');
                createdScripts++;
              }
            }
          }

          // Se não havia eventos cadastrados, pergunta se quer criar os templates essenciais
          if (createdScripts === 0) {
            const stdEvents = WorkflowRestService.getStandardWorkflowEvents();
            for (const ev of stdEvents) {
              const eventFile = path.join(scriptsDir, `${processId}.${ev.name}.js`);
              if (!fs.existsSync(eventFile)) {
                fs.writeFileSync(eventFile, ev.template, 'utf-8');
                createdScripts++;
              }
            }
          }

          const action = await vscode.window.showInformationMessage(
            `Processo ${processId} importado com sucesso para workflow/diagrams! (${createdScripts} scripts configurados)`,
            'Abrir Diagrama'
          );

          if (action === 'Abrir Diagrama') {
            const doc = await vscode.workspace.openTextDocument(processFilePath);
            await vscode.window.showTextDocument(doc);
          }
        }
      );
    } catch (error: any) {
      vscode.window.showErrorMessage(`Erro ao importar processo: ${error.message || error}`);
    }
  }

  private createDefaultProcessXmi(processId: string, processDescription: string): string {
    return `<?xml version="1.0" encoding="ASCII"?>
<xmi:XMI xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmn2:definitions id="Definitions_1" targetNamespace="http://www.fluig.com/bpm">
    <bpmn2:process id="${processId}" name="${processDescription}" isExecutable="true">
      <bpmn2:startEvent id="startevent_1" name="Início">
        <bpmn2:outgoing>flow_1</bpmn2:outgoing>
      </bpmn2:startEvent>
      <bpmn2:userTask id="usertask_1" name="Atividade 1">
        <bpmn2:incoming>flow_1</bpmn2:incoming>
        <bpmn2:outgoing>flow_2</bpmn2:outgoing>
      </bpmn2:userTask>
      <bpmn2:endEvent id="endevent_1" name="Fim">
        <bpmn2:incoming>flow_2</bpmn2:incoming>
      </bpmn2:endEvent>
      <bpmn2:sequenceFlow id="flow_1" sourceRef="startevent_1" targetRef="usertask_1"/>
      <bpmn2:sequenceFlow id="flow_2" sourceRef="usertask_1" targetRef="endevent_1"/>
    </bpmn2:process>
  </bpmn2:definitions>
</xmi:XMI>`;
  }
}

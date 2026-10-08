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

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Importando processo ${processId}...`,
          cancellable: false
        },
        async progress => {
          const soapService = new WorkflowSoapService(server);
          const processFilePath = path.join(diagramsDir, `${processId}.process`);
          const ecm30FilePath = path.join(diagramsDir, `${processId}.ecm30.xml`);
          const svgFilePath = path.join(diagramsDir, `${processId}.svg`);

          let createdScripts = 0;
          let ecm30Xml = '';

          try {
            progress.report({ message: 'Baixando definição completa do processo (SOAP exportProcess)...' });
            ecm30Xml = await soapService.exportProcess(processId!);
          } catch (soapErr: any) {
            console.warn('Falha no exportProcess SOAP, tentando fallback básico:', soapErr.message || soapErr);
          }

          if (ecm30Xml && ecm30Xml.includes('<ProcessDefinition')) {
            // Salva o ECM30 XML real do servidor
            progress.report({ message: 'Salvando artefato ECM30 XML...' });
            fs.writeFileSync(ecm30FilePath, ecm30Xml, 'utf-8');

            // Extrai o diagrama SVG real contido em <processDiagram>
            progress.report({ message: 'Extraindo diagrama SVG real...' });
            const svgMatch = ecm30Xml.match(/<processDiagram>(.*?)<\/processDiagram>/s);
            if (svgMatch && svgMatch[1].trim()) {
              const svgContent = soapService.unescapeXml(svgMatch[1].trim());
              fs.writeFileSync(svgFilePath, svgContent, 'utf-8');
            }

            // Extrai os scripts de eventos reais contidos em <WorkflowProcessEvent>
            progress.report({ message: 'Extraindo eventos do processo...' });
            const eventRegex = /<WorkflowProcessEvent>(.*?)<\/WorkflowProcessEvent>/gs;
            let evMatch: RegExpExecArray | null;
            while ((evMatch = eventRegex.exec(ecm30Xml)) !== null) {
              const evBlock = evMatch[1];
              const idMatch = evBlock.match(/<eventId>(.*?)<\/eventId>/);
              const descMatch = evBlock.match(/<eventDescription>(.*?)<\/eventDescription>/s);
              if (idMatch && idMatch[1].trim()) {
                const eventId = idMatch[1].trim();
                const code = descMatch ? soapService.unescapeXml(descMatch[1]) : '';
                const eventFile = path.join(scriptsDir, `${processId}.${eventId}.js`);
                fs.writeFileSync(eventFile, code, 'utf-8');
                createdScripts++;
              }
            }

            // Gera o diagrama .process (XMI / BPMN) com base nos estados e links reais
            progress.report({ message: 'Gerando modelo BPMN .process...' });
            const processXmi = this.generateProcessXmiFromEcm30(processId!, ecm30Xml);
            fs.writeFileSync(processFilePath, processXmi, 'utf-8');

          } else {
            // Fallback: se não veio ECM30 completo
            progress.report({ message: 'Construindo estrutura do diagrama .process padrão...' });
            if (!fs.existsSync(processFilePath)) {
              const initialXmi = this.createDefaultProcessXmi(processId!, processDesc || processId!);
              fs.writeFileSync(processFilePath, initialXmi, 'utf-8');
            }
            Ecm30GeneratorService.ensureArtifacts(processFilePath);

            // Tenta baixar eventos via REST
            progress.report({ message: 'Buscando scripts de eventos via REST...' });
            const restService = new WorkflowRestService(server);
            const remoteEvents = await restService.getProcessEvents(processId!);

            if (remoteEvents.length > 0) {
              for (const ev of remoteEvents) {
                const eventFile = path.join(scriptsDir, `${processId}.${ev.eventName}.js`);
                if (!fs.existsSync(eventFile) && ev.code) {
                  fs.writeFileSync(eventFile, ev.code, 'utf-8');
                  createdScripts++;
                }
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

          return { processFilePath, createdScripts };
        }
      );

      // Notifica o explorer para atualizar a árvore de processos
      try {
        await vscode.commands.executeCommand('fluigWorkflow.refreshProcesses');
      } catch (cmdErr) {
        console.warn('Erro ao atualizar árvore de processos:', cmdErr);
      }

      if (result) {
        const action = await vscode.window.showInformationMessage(
          `Processo ${processId} importado com sucesso! (${result.createdScripts} scripts de eventos, diagrama BPMN e SVG salvos em workflow/)`,
          'Abrir Diagrama'
        );

        if (action === 'Abrir Diagrama') {
          await vscode.commands.executeCommand('fluigWorkflow.viewDiagram', result.processFilePath);
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Erro ao importar processo: ${error.message || error}`);
    }
  }

  /**
   * Converte a estrutura de ProcessState e ProcessLink do ECM30 XML para o formato .process (BPMN/XMI)
   */
  private generateProcessXmiFromEcm30(processId: string, ecm30Xml: string): string {
    const descMatch = ecm30Xml.match(/<processDescription>(.*?)<\/processDescription>/);
    const processDesc = descMatch ? descMatch[1] : processId;

    const states: Array<{
      seq: string;
      name: string;
      elemType: string;
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    const stateRegex = /<ProcessState>(.*?)<\/ProcessState>/gs;
    let stMatch: RegExpExecArray | null;
    while ((stMatch = stateRegex.exec(ecm30Xml)) !== null) {
      const s = stMatch[1];
      const seqMatch = s.match(/<sequence>(\d+)<\/sequence>/);
      if (!seqMatch) continue;
      const seq = seqMatch[1];
      const name = s.match(/<stateName>(.*?)<\/stateName>/)?.[1] || '';
      const bpmnType = parseInt(s.match(/<bpmnType>(\d+)<\/bpmnType>/)?.[1] || '0', 10);
      const x = parseInt(s.match(/<positionX>(\d+)<\/positionX>/)?.[1] || '100', 10);
      const y = parseInt(s.match(/<positionY>(\d+)<\/positionY>/)?.[1] || '100', 10);

      let elemType = 'task';
      let width = 106;
      let height = 85;
      let id = `task${seq}`;

      if (bpmnType === 10) {
        elemType = 'startEvent';
        id = `startevent${seq}`;
        width = 35;
        height = 35;
      } else if (bpmnType === 60) {
        elemType = 'endEvent';
        id = `endevent${seq}`;
        width = 35;
        height = 35;
      } else if (bpmnType === 120) {
        elemType = 'exclusiveGateway';
        id = `exclusivegateway${seq}`;
        width = 60;
        height = 60;
      } else if (bpmnType === 43) {
        elemType = 'intermediateCatchEvent';
        id = `intermediateevent${seq}`;
        width = 35;
        height = 35;
      } else if (bpmnType === 82) {
        elemType = 'serviceTask';
        id = `servicetask${seq}`;
        width = 106;
        height = 85;
      } else if (bpmnType === 20) {
        elemType = 'userTask';
        id = `usertask${seq}`;
        width = 106;
        height = 85;
      }

      states.push({ seq, name, elemType, id, x, y, width, height });
    }

    const seqToId: Record<string, string> = {};
    states.forEach(st => {
      seqToId[st.seq] = st.id;
    });

    const links: Array<{
      id: string;
      linkSeq: string;
      sourceRef: string;
      targetRef: string;
      name: string;
    }> = [];

    const linkRegex = /<ProcessLink>(.*?)<\/ProcessLink>/gs;
    let lkMatch: RegExpExecArray | null;
    while ((lkMatch = linkRegex.exec(ecm30Xml)) !== null) {
      const l = lkMatch[1];
      const linkSeq = l.match(/<linkSequence>(\d+)<\/linkSequence>/)?.[1];
      const fromSeq = l.match(/<initialStateSequence>(\d+)<\/initialStateSequence>/)?.[1];
      const toSeq = l.match(/<finalStateSequence>(\d+)<\/finalStateSequence>/)?.[1];
      const name = l.match(/<name>(.*?)<\/name>/)?.[1] || '';

      if (linkSeq && fromSeq && toSeq && seqToId[fromSeq] && seqToId[toSeq]) {
        links.push({
          id: `flow${linkSeq}`,
          linkSeq,
          sourceRef: seqToId[fromSeq],
          targetRef: seqToId[toSeq],
          name
        });
      }
    }

    let elementsXml = '';
    states.forEach(st => {
      elementsXml += `      <bpmn2:${st.elemType} id="${st.id}" name="${this.escapeXml(st.name)}"/>\n`;
    });

    links.forEach(lk => {
      elementsXml += `      <bpmn2:sequenceFlow id="${lk.id}" sourceRef="${lk.sourceRef}" targetRef="${lk.targetRef}" name="${this.escapeXml(lk.name)}"/>\n`;
    });

    let diShapesXml = '';
    states.forEach(st => {
      diShapesXml += `      <bpmndi:BPMNShape id="BPMNShape_${st.id}" bpmnElement="${st.id}">
        <dc:Bounds height="${st.height}.0" width="${st.width}.0" x="${st.x}.0" y="${st.y}.0"/>
      </bpmndi:BPMNShape>\n`;
    });

    links.forEach(lk => {
      diShapesXml += `      <bpmndi:BPMNEdge id="BPMNEdge_${lk.id}" bpmnElement="${lk.id}">
        <di:waypoint x="0" y="0"/>
        <di:waypoint x="0" y="0"/>
      </bpmndi:BPMNEdge>\n`;
    });

    return `<?xml version="1.0" encoding="ASCII"?>
<xmi:XMI xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmn2:definitions id="Definitions_1" targetNamespace="http://www.fluig.com/bpm">
    <bpmn2:process id="${this.escapeXml(processId)}" name="${this.escapeXml(processDesc)}" isExecutable="true">
${elementsXml}    </bpmn2:process>
    <bpmndi:BPMNDiagram id="BPMNDiagram_1" name="${this.escapeXml(processDesc)}">
      <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${this.escapeXml(processId)}">
${diShapesXml}${diShapesXml ? '' : '      '}${links.length > 0 ? '' : ''}      </bpmndi:BPMNPlane>
    </bpmndi:BPMNDiagram>
  </bpmn2:definitions>
</xmi:XMI>`;
  }

  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  private createDefaultProcessXmi(processId: string, processDescription: string): string {
    return `<?xml version="1.0" encoding="ASCII"?>
<xmi:XMI xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmn2:definitions id="Definitions_1" targetNamespace="http://www.fluig.com/bpm">
    <bpmn2:process id="${this.escapeXml(processId)}" name="${this.escapeXml(processDescription)}" isExecutable="true">
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

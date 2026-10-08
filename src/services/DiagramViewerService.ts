import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Ecm30GeneratorService } from './Ecm30GeneratorService';
import { WorkflowRestService } from './WorkflowRestService';

export class DiagramViewerService {
  private static extensionUri: vscode.Uri;
  private static activePanels: Map<string, vscode.WebviewPanel> = new Map();

  public static initialize(context: vscode.ExtensionContext): void {
    this.extensionUri = context.extensionUri;
  }

  /**
   * Abre o modelador / visualizador de diagrama para um processo específico
   */
  public static async openDiagram(target: string | vscode.Uri): Promise<void> {
    try {
      let targetPath = typeof target === 'string' ? target : target.fsPath;

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder && !path.isAbsolute(targetPath)) {
        vscode.window.showErrorMessage('Abra uma pasta no VS Code para visualizar ou manipular o processo.');
        return;
      }

      let processId = '';
      let diagramsDir = '';
      let scriptsDir = '';

      if (path.isAbsolute(targetPath)) {
        const basename = path.basename(targetPath);
        processId = basename
          .replace(/\.ecm30\.xml$/i, '')
          .replace(/\.process$/i, '')
          .replace(/\.svg$/i, '');
        diagramsDir = path.dirname(targetPath);
        const root = path.resolve(diagramsDir, '..', '..');
        scriptsDir = path.join(root, 'workflow', 'scripts');
        if (!fs.existsSync(scriptsDir)) {
          scriptsDir = path.resolve(diagramsDir, '..', 'scripts');
        }
      } else {
        processId = targetPath;
        const rootPath = workspaceFolder!.uri.fsPath;
        diagramsDir = path.join(rootPath, 'workflow', 'diagrams');
        scriptsDir = path.join(rootPath, 'workflow', 'scripts');
      }

      if (!fs.existsSync(diagramsDir)) {
        fs.mkdirSync(diagramsDir, { recursive: true });
      }
      if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, { recursive: true });
      }

      const svgPath = path.join(diagramsDir, `${processId}.svg`);
      const processPath = path.join(diagramsDir, `${processId}.process`);
      const ecm30Path = path.join(diagramsDir, `${processId}.ecm30.xml`);

      // Se não existir .process, cria modelo inicial básico
      if (!fs.existsSync(processPath)) {
        const initialProcessXml = this.createInitialProcessXmi(processId, processId);
        fs.writeFileSync(processPath, initialProcessXml, 'utf-8');
      }

      // Se o SVG não existir mas o .process existir, auto-gera artefatos
      if (!fs.existsSync(svgPath) && fs.existsSync(processPath)) {
        try {
          Ecm30GeneratorService.ensureArtifacts(processPath);
        } catch (e) {
          console.warn('Não foi possível auto-gerar SVG do .process:', e);
        }
      }

      // Verifica se já tem painel aberto para esse processo
      const existingPanel = this.activePanels.get(processId);
      if (existingPanel) {
        existingPanel.reveal(vscode.ViewColumn.Active);
        this.updatePanelContent(existingPanel, processId, diagramsDir, scriptsDir);
        return;
      }

      // Prepara os roots locais permitidos
      const localResourceRoots = [
        vscode.Uri.file(diagramsDir)
      ];
      if (this.extensionUri) {
        localResourceRoots.push(vscode.Uri.file(path.join(this.extensionUri.fsPath, 'resources')));
      }

      // Cria novo WebviewPanel
      const panel = vscode.window.createWebviewPanel(
        'fluigWorkflowDiagram',
        `Fluig BPMN: ${processId}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots
        }
      );

      this.activePanels.set(processId, panel);

      panel.onDidDispose(() => {
        this.activePanels.delete(processId);
      });

      // Configura listener de mensagens do Webview
      panel.webview.onDidReceiveMessage(async message => {
        switch (message.command) {
          case 'saveProcess': {
            try {
              const { xml, svg, processDescription, formId } = message;

              // 1. Salva o .process com formatação XMI compatível com Fluig TDS
              const wrappedProcessXml = this.wrapProcessXml(xml);
              fs.writeFileSync(processPath, wrappedProcessXml, 'utf-8');

              // 2. Salva o .svg atualizado
              if (svg) {
                fs.writeFileSync(svgPath, svg, 'utf-8');
              }

              // 3. Atualiza o .ecm30.xml
              if (fs.existsSync(ecm30Path)) {
                let ecmXml = fs.readFileSync(ecm30Path, 'utf-8');
                if (svg) {
                  const escapedSvg = this.escapeXml(svg);
                  if (ecmXml.includes('<processDiagram>')) {
                    ecmXml = ecmXml.replace(/<processDiagram>[\s\S]*?<\/processDiagram>/, `<processDiagram>${escapedSvg}</processDiagram>`);
                  }
                }
                if (processDescription) {
                  ecmXml = ecmXml.replace(/<processDescription>[\s\S]*?<\/processDescription>/, `<processDescription>${this.escapeXml(processDescription)}</processDescription>`);
                }
                if (formId !== undefined && formId !== '') {
                  ecmXml = ecmXml.replace(/<formId>[\s\S]*?<\/formId>/, `<formId>${formId}</formId>`);
                }
                fs.writeFileSync(ecm30Path, ecmXml, 'utf-8');
              } else {
                Ecm30GeneratorService.ensureArtifacts(processPath, true);
              }

              panel.webview.postMessage({ command: 'saveResult', success: true });
              vscode.window.showInformationMessage(`Processo ${processId} salvo com sucesso!`);
            } catch (saveErr: any) {
              panel.webview.postMessage({ command: 'saveResult', success: false, error: saveErr.message });
              vscode.window.showErrorMessage(`Erro ao salvar processo: ${saveErr.message || saveErr}`);
            }
            break;
          }

          case 'openScript': {
            const scriptPath = path.join(scriptsDir, message.filename);
            if (fs.existsSync(scriptPath)) {
              const doc = await vscode.workspace.openTextDocument(scriptPath);
              await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            } else {
              vscode.window.showWarningMessage(`Arquivo de script não encontrado: ${message.filename}`);
            }
            break;
          }

          case 'createServiceScript': {
            const { elementId, elementName } = message;
            const seqMatch = elementId.match(/\d+/);
            const scriptName = seqMatch ? `${processId}.servicetask${seqMatch[0]}.js` : `${processId}.${elementId}.js`;
            const scriptPath = path.join(scriptsDir, scriptName);

            if (!fs.existsSync(scriptPath)) {
              const template = `/**
 * Script de Execução da Tarefa de Serviço: ${elementName || elementId}
 * Processo: ${processId}
 *
 * @param {number} attempt Tentativa de execução da atividade
 * @param {string} message Mensagem de retorno da tentativa anterior
 */
function servicetask(attempt, message) {
  log.info("### Executando Tarefa de Serviço [${processId} - ${elementId} - ${elementName}] ###");

  try {
    // Exemplo de manipulação de campos:
    // var valor = hAPI.getCardValue("meuCampo");
    // hAPI.setCardValue("statusIntegracao", "SUCESSO");

  } catch (error) {
    log.error("Erro na tarefa de serviço: " + error);
    throw "Falha na integração: " + error;
  }
}
`;
              fs.writeFileSync(scriptPath, template, 'utf-8');
            }

            const doc = await vscode.workspace.openTextDocument(scriptPath);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            this.updatePanelContent(panel, processId, diagramsDir, scriptsDir);
            break;
          }

          case 'openFile': {
            const filePath = message.filePath;
            if (fs.existsSync(filePath)) {
              try {
                await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(filePath), 'default', vscode.ViewColumn.Beside);
              } catch {
                const doc = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
              }
            }
            break;
          }

          case 'exportProcess': {
            await vscode.commands.executeCommand('fluigWorkflow.exportProcess', vscode.Uri.file(processPath));
            break;
          }

          case 'createEventScript': {
            const stdEvents = WorkflowRestService.getStandardWorkflowEvents();
            const picked = await vscode.window.showQuickPick(
              stdEvents.map(e => ({
                label: e.name,
                description: e.description,
                template: e.template
              })),
              { placeHolder: 'Selecione o evento Fluig para criar o script' }
            );

            if (picked) {
              const newFile = path.join(scriptsDir, `${processId}.${picked.label}.js`);
              if (!fs.existsSync(newFile)) {
                fs.writeFileSync(newFile, picked.template, 'utf-8');
              }
              const doc = await vscode.workspace.openTextDocument(newFile);
              await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
              this.updatePanelContent(panel, processId, diagramsDir, scriptsDir);
            }
            break;
          }

          case 'refresh': {
            this.updatePanelContent(panel, processId, diagramsDir, scriptsDir);
            break;
          }
        }
      });

      this.updatePanelContent(panel, processId, diagramsDir, scriptsDir);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Erro ao abrir modelador de diagrama: ${error.message || error}`);
    }
  }

  /**
   * Atualiza o conteúdo HTML e os recursos do Webview
   */
  private static updatePanelContent(
    panel: vscode.WebviewPanel,
    processId: string,
    diagramsDir: string,
    scriptsDir: string
  ): void {
    const svgPath = path.join(diagramsDir, `${processId}.svg`);
    const processPath = path.join(diagramsDir, `${processId}.process`);
    const ecm30Path = path.join(diagramsDir, `${processId}.ecm30.xml`);

    // Lê SVG do servidor
    let serverSvg = '';
    if (fs.existsSync(svgPath)) {
      serverSvg = fs.readFileSync(svgPath, 'utf-8').replace(/<\?xml[^>]*\?>/i, '').trim();
    }

    // Lê BPMN XML e descompacta para formato suportado pelo bpmn-js
    let bpmnXml = '';
    if (fs.existsSync(processPath)) {
      const rawProcess = fs.readFileSync(processPath, 'utf-8');
      bpmnXml = this.unwrapProcessXml(rawProcess, processId);
    } else {
      bpmnXml = this.createInitialBpmn2Xml(processId, processId);
    }

    // Metadados do ECM30
    let processDesc = processId;
    let version = '1';
    let formId = '';
    const activities: Array<{ sequence: string; name: string; type: string; scriptFile?: string }> = [];

    if (fs.existsSync(ecm30Path)) {
      try {
        const ecmXml = fs.readFileSync(ecm30Path, 'utf-8');
        const descMatch = ecmXml.match(/<processDescription>(.*?)<\/processDescription>/);
        if (descMatch) processDesc = descMatch[1];

        const verMatch = ecmXml.match(/<version>(.*?)<\/version>/);
        if (verMatch) version = verMatch[1];

        const formMatch = ecmXml.match(/<formId>(.*?)<\/formId>/);
        if (formMatch && formMatch[1] !== '0') formId = formMatch[1];

        const stateRegex = /<ProcessState>(.*?)<\/ProcessState>/gs;
        let stMatch: RegExpExecArray | null;
        while ((stMatch = stateRegex.exec(ecmXml)) !== null) {
          const s = stMatch[1];
          const seq = s.match(/<sequence>(\d+)<\/sequence>/)?.[1] || '';
          const name = s.match(/<stateName>(.*?)<\/stateName>/)?.[1] || `Atividade ${seq}`;
          const bpmnType = parseInt(s.match(/<bpmnType>(\d+)<\/bpmnType>/)?.[1] || '0', 10);

          let typeName = 'Tarefa';
          let expectedScript = '';
          if (bpmnType === 10) typeName = 'Início';
          else if (bpmnType === 60) typeName = 'Fim';
          else if (bpmnType === 120) typeName = 'Gateway Exclusivo';
          else if (bpmnType === 82) {
            typeName = 'Tarefa de Serviço';
            expectedScript = `${processId}.servicetask${seq}.js`;
          } else if (bpmnType === 20) typeName = 'Tarefa de Usuário';
          else if (bpmnType === 43) {
            typeName = 'Evento Intermediário';
            expectedScript = `${processId}.intermediateevent${seq}.js`;
          }

          let scriptFile: string | undefined;
          if (expectedScript && fs.existsSync(path.join(scriptsDir, expectedScript))) {
            scriptFile = expectedScript;
          }

          activities.push({ sequence: seq, name, type: typeName, scriptFile });
        }
      } catch (err) {
        console.warn('Erro ao ler metadados do ECM30:', err);
      }
    }

    // Scripts na pasta scripts
    const existingScripts: Array<{ name: string; fullPath: string; size: number }> = [];
    if (fs.existsSync(scriptsDir)) {
      const files = fs.readdirSync(scriptsDir);
      for (const f of files) {
        if (f.startsWith(`${processId}.`) && f.endsWith('.js')) {
          const full = path.join(scriptsDir, f);
          const stat = fs.statSync(full);
          existingScripts.push({
            name: f,
            fullPath: full,
            size: stat.size
          });
        }
      }
    }

    // URIs dos recursos locais do bpmn-js
    const resourcesUri = this.extensionUri
      ? panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.extensionUri.fsPath, 'resources', 'bpmn')))
      : '';

    panel.webview.html = this.renderHtml(panel.webview, {
      processId,
      processDesc,
      version,
      formId,
      bpmnXml,
      serverSvg,
      activities,
      existingScripts,
      processPath: fs.existsSync(processPath) ? processPath : undefined,
      ecm30Path: fs.existsSync(ecm30Path) ? ecm30Path : undefined,
      resourcesUri: resourcesUri.toString()
    });
  }

  /**
   * Descompacta o XML do formato Eclipse XMI para BPMN 2.0 padrão do bpmn-js
   */
  private static unwrapProcessXml(processXml: string, processId: string): string {
    const defMatch = processXml.match(/<bpmn2?:definitions([\s\S]*?)<\/bpmn2?:definitions>/);
    if (!defMatch) {
      return this.createInitialBpmn2Xml(processId, processId);
    }

    let header = '<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"';

    const tagOpenMatch = defMatch[0].match(/<bpmn2?:definitions([^>]*)>/);
    if (tagOpenMatch) {
      const attrRegex = /([a-zA-Z0-9_:]+)=["']([^"']*)["']/g;
      let m: RegExpExecArray | null;
      while ((m = attrRegex.exec(tagOpenMatch[1])) !== null) {
        if (!m[1].startsWith('xmlns:')) {
          header += ` ${m[1]}="${m[2]}"`;
        }
      }
    }
    header += '>';

    let body = defMatch[0].substring(defMatch[0].indexOf('>') + 1, defMatch[0].lastIndexOf('</'));
    body = this.repairWaypoints(body);
    body = this.injectFluigColors(body);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${header}\n${body}\n</bpmn2:definitions>`;
  }

  /**
   * Retorna as cores padrão Fluig (borda e preenchimento) para um determinado tipo de elemento BPMN
   */
  public static getFluigColorsForTag(tag: string): { stroke: string; fill: string } | null {
    const t = tag.toLowerCase();
    if (t.includes('startevent')) {
      return { stroke: '#336633', fill: '#b6ffb6' };
    }
    if (t.includes('endevent')) {
      return { stroke: '#993333', fill: '#ffb6b6' };
    }
    if (t.includes('intermediate') || t.includes('boundary')) {
      return { stroke: '#999900', fill: '#ffffb6' };
    }
    if (t.includes('gateway')) {
      return { stroke: '#b25900', fill: '#ffe8b3' };
    }
    if (t.includes('task')) {
      return { stroke: '#191970', fill: '#deedfa' };
    }
    if (t.includes('subprocess') || t.includes('callactivity')) {
      return { stroke: '#191970', fill: '#f0f8ff' };
    }
    if (t.includes('participant') || t.includes('lane')) {
      return { stroke: '#555555', fill: '#ffffff' };
    }
    return null;
  }

  /**
   * Injeta atributos bioc:stroke e bioc:fill em formas BPMN que ainda não possuam cores definidas
   */
  private static injectFluigColors(body: string): string {
    const elemTypes: Record<string, string> = {};
    const elemRegex = /<bpmn2?:([a-zA-Z0-9_]+)\b([^>]*)>/g;
    let match: RegExpExecArray | null;
    while ((match = elemRegex.exec(body)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      const idMatch = attrs.match(/\bid=["']([^"']+)["']/);
      if (idMatch && tag !== 'process' && tag !== 'definitions' && tag !== 'sequenceFlow') {
        elemTypes[idMatch[1]] = tag;
      }
    }

    body = body.replace(/<bpmndi:BPMNShape\b([^>]*)>/g, (fullMatch, attrs) => {
      if (attrs.includes('bioc:stroke') || attrs.includes('bioc:fill')) {
        return fullMatch;
      }

      const elemIdMatch = attrs.match(/\bbpmnElement=["']([^"']+)["']/);
      if (!elemIdMatch) return fullMatch;

      const elemId = elemIdMatch[1];
      const elemType = elemTypes[elemId];
      if (!elemType) return fullMatch;

      const colors = this.getFluigColorsForTag(elemType);
      if (!colors) return fullMatch;

      return `<bpmndi:BPMNShape ${attrs.trim()} bioc:stroke="${colors.stroke}" bioc:fill="${colors.fill}" color:border-color="${colors.stroke}" color:background-color="${colors.fill}">`;
    });

    return body;
  }

  public static calculateWaypoints(
    source: { x: number; y: number; width: number; height: number },
    target: { x: number; y: number; width: number; height: number }
  ): Array<{ x: number; y: number }> {
    const srcCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const tgtCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };

    const dx = tgtCenter.x - srcCenter.x;
    const dy = tgtCenter.y - srcCenter.y;

    let startX: number;
    let startY: number;
    let endX: number;
    let endY: number;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) {
        startX = source.x + source.width;
        startY = srcCenter.y;
        endX = target.x;
        endY = tgtCenter.y;
      } else {
        startX = source.x;
        startY = srcCenter.y;
        endX = target.x + target.width;
        endY = tgtCenter.y;
      }
    } else {
      if (dy >= 0) {
        startX = srcCenter.x;
        startY = source.y + source.height;
        endX = tgtCenter.x;
        endY = target.y;
      } else {
        startX = srcCenter.x;
        startY = source.y;
        endX = tgtCenter.x;
        endY = target.y + target.height;
      }
    }

    const points: Array<{ x: number; y: number }> = [
      { x: Math.round(startX), y: Math.round(startY) }
    ];

    if (Math.abs(startX - endX) > 10 && Math.abs(startY - endY) > 10) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        const midX = Math.round((startX + endX) / 2);
        points.push({ x: midX, y: Math.round(startY) });
        points.push({ x: midX, y: Math.round(endY) });
      } else {
        const midY = Math.round((startY + endY) / 2);
        points.push({ x: Math.round(startX), y: midY });
        points.push({ x: Math.round(endX), y: midY });
      }
    }

    points.push({ x: Math.round(endX), y: Math.round(endY) });
    return points;
  }

  private static repairWaypoints(body: string): string {
    const shapes: Record<string, { x: number; y: number; width: number; height: number }> = {};
    const shapeRegex = /<bpmndi:BPMNShape\b([^>]*)>([\s\S]*?)<\/bpmndi:BPMNShape>/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = shapeRegex.exec(body)) !== null) {
      const shapeAttrs = sMatch[1];
      const shapeInner = sMatch[2];
      const elemId = shapeAttrs.match(/\bbpmnElement=["']([^"']+)["']/)?.[1];
      const boundsMatch = shapeInner.match(/<dc:Bounds\b([^>]*)\/?>/);
      if (elemId && boundsMatch) {
        const bAttrs = boundsMatch[1];
        const x = parseFloat(bAttrs.match(/\bx=["']([^"']+)["']/)?.[1] || '0');
        const y = parseFloat(bAttrs.match(/\by=["']([^"']+)["']/)?.[1] || '0');
        const width = parseFloat(bAttrs.match(/\bwidth=["']([^"']+)["']/)?.[1] || '100');
        const height = parseFloat(bAttrs.match(/\bheight=["']([^"']+)["']/)?.[1] || '80');
        shapes[elemId] = { x, y, width, height };
      }
    }

    const flows: Record<string, { sourceRef: string; targetRef: string }> = {};
    const flowRegex = /<bpmn2?:sequenceFlow\b([^>]*)\/?>/g;
    let fMatch: RegExpExecArray | null;
    while ((fMatch = flowRegex.exec(body)) !== null) {
      const attrs = fMatch[1];
      const flowId = attrs.match(/\bid=["']([^"']+)["']/)?.[1];
      const sourceRef = attrs.match(/\bsourceRef=["']([^"']+)["']/)?.[1];
      const targetRef = attrs.match(/\btargetRef=["']([^"']+)["']/)?.[1];
      if (flowId && sourceRef && targetRef) {
        flows[flowId] = { sourceRef, targetRef };
      }
    }

    // Corrige edges existentes com waypoints zerados ou ausentes
    body = body.replace(/<bpmndi:BPMNEdge\b([^>]*)>([\s\S]*?)<\/bpmndi:BPMNEdge>/g, (fullMatch, edgeAttrs, edgeInner) => {
      const flowId = edgeAttrs.match(/\bbpmnElement=["']([^"']+)["']/)?.[1];
      if (!flowId || !flows[flowId]) return fullMatch;

      const flow = flows[flowId];
      const srcShape = shapes[flow.sourceRef];
      const tgtShape = shapes[flow.targetRef];
      if (!srcShape || !tgtShape) return fullMatch;

      const wpMatches = Array.from(edgeInner.matchAll(/<di:waypoint\b([^>]*)\/?>/g));
      const hasValidWaypoints = wpMatches.length >= 2 && wpMatches.some(wp => {
        const x = parseFloat((wp as any)[1].match(/\bx=["']([^"']+)["']/)?.[1] || '0');
        const y = parseFloat((wp as any)[1].match(/\by=["']([^"']+)["']/)?.[1] || '0');
        return x > 0 || y > 0;
      });

      if (hasValidWaypoints) {
        return fullMatch;
      }

      const calculatedPts = this.calculateWaypoints(srcShape, tgtShape);
      const newWpXml = calculatedPts.map(p => `\n        <di:waypoint x="${p.x}" y="${p.y}"/>`).join('');
      return `<bpmndi:BPMNEdge ${edgeAttrs}>${newWpXml}\n      </bpmndi:BPMNEdge>`;
    });

    // Se houver algum fluxo sem BPMNEdge, adiciona
    for (const [flowId, flow] of Object.entries(flows)) {
      if (!body.includes(`bpmnElement="${flowId}"`)) {
        const src = shapes[flow.sourceRef];
        const tgt = shapes[flow.targetRef];
        if (src && tgt) {
          const pts = this.calculateWaypoints(src, tgt);
          const edgeXml = `      <bpmndi:BPMNEdge id="BPMNEdge_${flowId}" bpmnElement="${flowId}">
${pts.map(p => `        <di:waypoint x="${p.x}" y="${p.y}"/>`).join('\n')}
      </bpmndi:BPMNEdge>\n`;
          body = body.replace('</bpmndi:BPMNPlane>', `${edgeXml}    </bpmndi:BPMNPlane>`);
        }
      }
    }

    return body;
  }

  /**
   * Empacota o BPMN 2.0 XML no formato XMI compatível com Fluig TDS
   */
  private static wrapProcessXml(bpmnXml: string): string {
    const defMatch = bpmnXml.match(/<bpmn2?:definitions([\s\S]*?)<\/bpmn2?:definitions>/);
    if (!defMatch) {
      return bpmnXml;
    }

    const content = defMatch[0]
      .replace(/<bpmn:/g, '<bpmn2:')
      .replace(/<\/bpmn:/g, '</bpmn2:');

    return `<?xml version="1.0" encoding="ASCII"?>\n<xmi:XMI xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0">\n  ${content}\n</xmi:XMI>\n`;
  }

  private static escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private static createInitialBpmn2Xml(processId: string, processName: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" id="Definitions_1" targetNamespace="http://www.fluig.com/bpm">
  <bpmn2:process id="${processId}" name="${processName}" isExecutable="true">
    <bpmn2:startEvent id="startevent1" name="Início">
      <bpmn2:outgoing>flow1</bpmn2:outgoing>
    </bpmn2:startEvent>
    <bpmn2:userTask id="usertask2" name="Atividade Principal">
      <bpmn2:incoming>flow1</bpmn2:incoming>
      <bpmn2:outgoing>flow2</bpmn2:outgoing>
    </bpmn2:userTask>
    <bpmn2:endEvent id="endevent3" name="Fim">
      <bpmn2:incoming>flow2</bpmn2:incoming>
    </bpmn2:endEvent>
    <bpmn2:sequenceFlow id="flow1" sourceRef="startevent1" targetRef="usertask2"/>
    <bpmn2:sequenceFlow id="flow2" sourceRef="usertask2" targetRef="endevent3"/>
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1" name="${processName}">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
      <bpmndi:BPMNShape id="BPMNShape_startevent1" bpmnElement="startevent1" bioc:stroke="#336633" bioc:fill="#b6ffb6" color:border-color="#336633" color:background-color="#b6ffb6">
        <dc:Bounds height="36.0" width="36.0" x="180.0" y="160.0"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BPMNShape_usertask2" bpmnElement="usertask2" bioc:stroke="#191970" bioc:fill="#deedfa" color:border-color="#191970" color:background-color="#deedfa">
        <dc:Bounds height="80.0" width="100.0" x="280.0" y="138.0"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="BPMNShape_endevent3" bpmnElement="endevent3" bioc:stroke="#993333" bioc:fill="#ffb6b6" color:border-color="#993333" color:background-color="#ffb6b6">
        <dc:Bounds height="36.0" width="36.0" x="450.0" y="160.0"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="BPMNEdge_flow1" bpmnElement="flow1">
        <di:waypoint x="216.0" y="178.0"/>
        <di:waypoint x="280.0" y="178.0"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="BPMNEdge_flow2" bpmnElement="flow2">
        <di:waypoint x="380.0" y="178.0"/>
        <di:waypoint x="450.0" y="178.0"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn2:definitions>`;
  }

  private static createInitialProcessXmi(processId: string, processName: string): string {
    const bpmn = this.createInitialBpmn2Xml(processId, processName);
    return this.wrapProcessXml(bpmn);
  }

  private static renderHtml(
    webview: vscode.Webview,
    data: {
      processId: string;
      processDesc: string;
      version: string;
      formId: string;
      bpmnXml: string;
      serverSvg: string;
      activities: Array<{ sequence: string; name: string; type: string; scriptFile?: string }>;
      existingScripts: Array<{ name: string; fullPath: string; size: number }>;
      processPath?: string;
      ecm30Path?: string;
      resourcesUri: string;
    }
  ): string {
    const safeBpmnXml = Buffer.from(data.bpmnXml).toString('base64');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fluig BPMN: ${data.processId}</title>

  <!-- BPMN-JS Styles -->
  <link rel="stylesheet" href="${data.resourcesUri}/diagram-js.css">
  <link rel="stylesheet" href="${data.resourcesUri}/bpmn-js.css">
  <link rel="stylesheet" href="${data.resourcesUri}/bpmn-font/css/bpmn.css">

  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --sec-btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --sec-btn-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, #3c3c3c);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #555555);
      --highlight: var(--vscode-editorBracketHighlight-foreground1, #007acc);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Top Toolbar */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background-color: var(--card-bg);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      gap: 12px;
      z-index: 100;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .title {
      font-size: 15px;
      font-weight: 600;
      color: var(--fg);
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      background-color: var(--badge-bg);
      color: var(--badge-fg);
      font-weight: 500;
    }

    .badge-primary {
      background-color: var(--btn-bg);
    }

    .mode-switcher {
      display: flex;
      background: rgba(0,0,0,0.25);
      border-radius: 4px;
      padding: 2px;
      border: 1px solid var(--border);
      margin-left: 12px;
    }

    .mode-btn {
      background: transparent;
      color: var(--fg);
      border: none;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      border-radius: 3px;
      transition: background-color 0.15s;
    }

    .mode-btn.active {
      background: var(--btn-bg);
      color: var(--btn-fg);
      font-weight: 600;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    button {
      background-color: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 5px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    button:hover {
      background-color: var(--btn-hover);
    }

    button.secondary {
      background-color: var(--sec-btn-bg);
      color: var(--sec-btn-fg);
    }

    button.secondary:hover {
      background-color: #4f5358;
    }

    button.save-btn {
      background-color: #238636;
      font-weight: 600;
    }

    button.save-btn:hover {
      background-color: #2ea043;
    }

    /* Main Container */
    .main-container {
      display: flex;
      flex: 1;
      height: calc(100vh - 51px);
      overflow: hidden;
      position: relative;
    }

    /* Model Canvas Area */
    .canvas-container {
      flex: 1;
      position: relative;
      height: 100%;
      background-color: #ffffff;
      overflow: hidden;
    }

    #bpmnCanvas {
      width: 100%;
      height: 100%;
      background-color: #fafbfc;
      background-image:
        linear-gradient(to right, rgba(0, 0, 0, 0.08) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(0, 0, 0, 0.08) 1px, transparent 1px),
        linear-gradient(to right, rgba(0, 0, 0, 0.035) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(0, 0, 0, 0.035) 1px, transparent 1px);
      background-size: 100px 100px, 100px 100px, 20px 20px, 20px 20px;
      background-position: 0 0, 0 0, 0 0, 0 0;
    }

    #svgCanvas {
      width: 100%;
      height: 100%;
      display: none;
      position: relative;
      overflow: hidden;
      background: radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px);
      background-size: 20px 20px;
      cursor: grab;
      user-select: none;
    }

    #svgCanvas:active {
      cursor: grabbing;
    }

    .svg-content-box {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      padding: 20px;
      background: #ffffff;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      border-radius: 6px;
      display: inline-block;
    }

    /* Floating Zoom Controls */
    .floating-toolbar {
      position: absolute;
      bottom: 20px;
      left: 20px;
      display: flex;
      align-items: center;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px;
      gap: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      z-index: 50;
    }

    .floating-toolbar button {
      padding: 4px 8px;
      font-size: 13px;
    }

    .floating-toolbar button.active {
      background-color: var(--btn-bg);
      color: #ffffff;
    }

    .zoom-text {
      font-size: 11px;
      padding: 0 6px;
      min-width: 48px;
      text-align: center;
      color: var(--fg);
    }

    /* Right Sidebar - Properties & Scripts */
    .sidebar {
      width: 340px;
      background-color: var(--card-bg);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      flex-shrink: 0;
      z-index: 20;
    }

    .sidebar-section {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }

    .section-header {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .form-group {
      margin-bottom: 10px;
    }

    .form-group label {
      display: block;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 4px;
    }

    .form-group input, .form-group textarea {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 3px;
      padding: 6px 8px;
      font-size: 12px;
      font-family: inherit;
      outline: none;
    }

    .form-group input:focus, .form-group textarea:focus {
      border-color: var(--btn-bg);
    }

    .selected-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
    }

    .selected-card-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--fg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .selected-type {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      background: rgba(14, 99, 156, 0.25);
      color: #70c0ff;
    }

    .selected-id {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 10px;
    }

    .list-item {
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 4px;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .list-item-title {
      font-weight: 500;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .list-item-sub {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }

    .empty-state {
      padding: 12px 0;
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      text-align: center;
    }

    /* Dark Mode overrides for BPMN-JS */
    .djs-palette {
      background: var(--card-bg) !important;
      border: 1px solid var(--border) !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
      border-radius: 6px;
    }

    .djs-palette-entries {
      padding: 4px;
    }

    .djs-palette .entry {
      color: var(--fg) !important;
    }

    .djs-context-pad .entry {
      background-color: var(--card-bg) !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
      border-radius: 4px;
    }

    .toast {
      position: fixed;
      top: 60px;
      right: 20px;
      background: #238636;
      color: #fff;
      padding: 8px 16px;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      font-size: 12px;
      font-weight: 500;
      display: none;
      z-index: 1000;
      animation: fadeIn 0.2s;
    }

    .color-preset-circle {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.2);
      padding: 0;
      cursor: pointer;
      display: inline-block;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      flex-shrink: 0;
      box-sizing: border-box;
    }

    .color-preset-circle:hover {
      transform: scale(1.2);
      box-shadow: 0 0 6px rgba(255,255,255,0.5);
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div id="toast" class="toast">Alterações salvas com sucesso!</div>

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="title" id="headerTitle">${data.processDesc}</div>
      <span class="badge badge-primary">ID: ${data.processId}</span>
      <span class="badge">v${data.version}</span>

      <div class="mode-switcher">
        <button id="btnModeModeler" class="mode-btn active" onclick="switchMode('modeler')">Modelador BPMN</button>
        <button id="btnModeSvg" class="mode-btn" onclick="switchMode('svg')">Visualizar SVG</button>
      </div>
    </div>

    <div class="header-controls">
      <button class="save-btn" onclick="saveDiagram()" title="Salvar BPMN, SVG e ECM30 (Ctrl+S)">Salvar Processo</button>
      <button onclick="exportProcess()" title="Publicar diretamente no servidor Fluig">Exportar para Fluig</button>
      <button class="secondary" onclick="createEventScript()">+ Script de Evento</button>
      <button class="secondary" onclick="openTextFile('${data.processPath || ''}')">Ver .process</button>
      <button class="secondary" onclick="refresh()">Atualizar</button>
    </div>
  </div>

  <!-- Main Body -->
  <div class="main-container">
    <!-- Canvas Area -->
    <div class="canvas-container">
      <!-- BPMN Modeler Canvas -->
      <div id="bpmnCanvas"></div>

      <!-- SVG Server Canvas -->
      <div id="svgCanvas">
        <div class="svg-content-box" id="svgContentBox">
          ${data.serverSvg || '<div style="padding:40px; color:#666;">SVG do servidor não disponível</div>'}
        </div>
      </div>

      <!-- Floating Controls -->
      <div class="floating-toolbar">
        <button class="secondary" onclick="zoomIn()" title="Aproximar">+</button>
        <div class="zoom-text" id="zoomText">100%</div>
        <button class="secondary" onclick="zoomOut()" title="Afastar">-</button>
        <button class="secondary" onclick="resetZoom()" title="Resetar Zoom">100%</button>
        <button class="secondary" onclick="fitToScreen()" title="Ajustar à Tela">Ajustar</button>
        <button id="btnToggleGrid" class="secondary active" onclick="toggleGrid()" title="Alternar Grade">Grade</button>
      </div>
    </div>

    <!-- Properties Sidebar -->
    <div class="sidebar">
      <!-- Metadados do Processo -->
      <div class="sidebar-section">
        <div class="section-header">Propriedades do Processo</div>
        <div class="form-group">
          <label for="inputDesc">Descrição do Processo</label>
          <input type="text" id="inputDesc" value="${data.processDesc}" oninput="onDescChange(this.value)">
        </div>
        <div class="form-group">
          <label for="inputFormId">ID do Formulário Fluig (ECM/GED)</label>
          <input type="number" id="inputFormId" value="${data.formId}" placeholder="Ex: 489294">
        </div>
      </div>

      <!-- Elemento Selecionado -->
      <div class="sidebar-section">
        <div class="section-header">Elemento Selecionado</div>
        <div id="selectedElementContainer">
          <div class="empty-state">Clique em qualquer elemento do diagrama para inspecionar e manipular.</div>
        </div>
      </div>

      <!-- Scripts Existentes -->
      <div class="sidebar-section">
        <div class="section-header">
          <span>Scripts de Eventos (${data.existingScripts.length})</span>
          <button class="secondary" style="padding: 2px 6px; font-size: 11px;" onclick="createEventScript()">+ Novo</button>
        </div>
        <div id="scriptsList">
          ${data.existingScripts.length === 0 ? '<div class="empty-state">Nenhum script na pasta workflow/scripts</div>' : ''}
          ${data.existingScripts.map(sc => `
            <div class="list-item">
              <div>
                <div class="list-item-title">${sc.name}</div>
                <div class="list-item-sub">${(sc.size / 1024).toFixed(1)} KB</div>
              </div>
              <button class="secondary" style="font-size:11px; padding:3px 6px;" onclick="openScript('${sc.name}')">
                Abrir
              </button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Ações Rápidas -->
      <div class="sidebar-section">
        <div class="section-header">Artefatos do Projeto</div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <button class="secondary" style="justify-content: flex-start;" onclick="openTextFile('${data.processPath || ''}')">
            Código BPMN (.process)
          </button>
          <button class="secondary" style="justify-content: flex-start;" onclick="openTextFile('${data.ecm30Path || ''}')">
            Artefato ECM30 (.ecm30.xml)
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- BPMN Modeler Script -->
  <script src="${data.resourcesUri}/bpmn-modeler.production.min.js"></script>

  <script>
    const vscode = acquireVsCodeApi();

    const rawBase64 = "${safeBpmnXml}";
    const bytes = Uint8Array.from(atob(rawBase64), c => c.charCodeAt(0));
    const initialBpmnXml = new TextDecoder('utf-8').decode(bytes);

    let modeler = null;
    let currentMode = 'modeler'; // 'modeler' ou 'svg'
    let selectedElement = null;

    // SVG Pan & Zoom State
    let svgScale = 1;
    let svgTranslateX = 40;
    let svgTranslateY = 40;
    let isSvgDragging = false;
    let svgStartX = 0;
    let svgStartY = 0;

    const svgCanvas = document.getElementById('svgCanvas');
    const svgBox = document.getElementById('svgContentBox');
    const zoomText = document.getElementById('zoomText');

    // Inicialização do BPMN Modeler
    async function initModeler() {
      try {
        modeler = new BpmnJS({
          container: '#bpmnCanvas',
          keyboard: { bindTo: window }
        });

        await modeler.importXML(initialBpmnXml);

        const canvas = modeler.get('canvas');
        canvas.zoom('fit-viewport');
        updateGrid(canvas.viewbox());

        // Listener de seleção de elemento
        const eventBus = modeler.get('eventBus');

        // Sincroniza grade e indicador de zoom com navegacao do canvas
        eventBus.on('canvas.viewbox.changed', (e) => {
          if (e && e.viewbox) {
            updateGrid(e.viewbox);
            updateZoomDisplay(Math.round(e.viewbox.scale * 100));
          }
        });
        eventBus.on('selection.changed', (e) => {
          if (e.newSelection && e.newSelection.length > 0) {
            renderSelectedElement(e.newSelection[0]);
          } else {
            renderSelectedElement(null);
          }
        });

        // Listener de alteração para atualizar propriedades se mudou rótulo
        eventBus.on('element.changed', (e) => {
          if (selectedElement && selectedElement.id === e.element.id) {
            renderSelectedElement(e.element);
          }
        });

        // Auto-colorir novas formas adicionadas da paleta com a paleta oficial Fluig
        eventBus.on('commandStack.shape.create.postExecuted', (e) => {
          const shape = e.context && e.context.shape;
          if (!shape) return;
          setTimeout(() => {
            try {
              const colors = getFluigColorsForType(shape.type);
              if (colors && modeler) {
                const modeling = modeler.get('modeling');
                modeling.setColor(shape, colors);
              }
            } catch (err) {}
          }, 0);
        });

      } catch (err) {
        console.error('Falha ao inicializar BPMN Modeler:', err);
      }
    }

    initModeler();

    function renderSelectedElement(element) {
      selectedElement = element;
      const container = document.getElementById('selectedElementContainer');
      if (!element) {
        container.innerHTML = '<div class="empty-state">Clique em qualquer elemento do diagrama para inspecionar e manipular.</div>';
        return;
      }

      const bo = element.businessObject || {};
      const name = bo.name || '(Sem nome)';
      const type = element.type || 'Elemento';
      const isServiceTask = type.includes('ServiceTask');
      const isFlow = type.includes('SequenceFlow') || type.includes('Flow');
      const colors = getElementColors(element);

      let serviceBtnHtml = '';
      if (isServiceTask) {
        serviceBtnHtml = \`
          <div style="margin-top: 10px;">
            <button class="secondary" style="width:100%; justify-content:center;" onclick="createOrOpenServiceScript('\${element.id}', '\${name}')">
              Abrir / Criar Script de Serviço
            </button>
          </div>
        \`;
      }

      let colorControlsHtml = '';
      if (isFlow) {
        colorControlsHtml = \`
          <div class="form-group" style="margin-top: 12px; margin-bottom: 6px;">
            <label style="font-weight:600; margin-bottom:6px;">Cor da Linha / Fluxo</label>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
              <button type="button" class="color-preset-circle" title="Preto Padrão" onclick="setElementColor(null, '#333333')" style="background:#333333;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Azul" onclick="setElementColor(null, '#191970')" style="background:#191970;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Verde" onclick="setElementColor(null, '#336633')" style="background:#336633;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Vermelho" onclick="setElementColor(null, '#993333')" style="background:#993333;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Laranja" onclick="setElementColor(null, '#b25900')" style="background:#b25900;"></button>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <label style="margin:0; font-size:11px;">Cor personalizada:</label>
              <input type="color" id="elemStrokePicker" value="\${colors.stroke}" oninput="onCustomColorChange()" style="width:32px; height:24px; padding:0; border:1px solid var(--border); border-radius:3px; cursor:pointer; background:transparent;">
            </div>
          </div>
        \`;
      } else {
        colorControlsHtml = \`
          <div class="form-group" style="margin-top: 12px; margin-bottom: 6px;">
            <label style="font-weight:600; margin-bottom:6px;">Paleta de Cores</label>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
              <button type="button" class="color-preset-circle" title="Fluig Verde (Início)" onclick="setElementColor('#b6ffb6', '#336633')" style="background:#b6ffb6; border:2px solid #336633;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Vermelho (Fim)" onclick="setElementColor('#ffb6b6', '#993333')" style="background:#ffb6b6; border:2px solid #993333;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Azul (Tarefa)" onclick="setElementColor('#deedfa', '#191970')" style="background:#deedfa; border:2px solid #191970;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Laranja (Gateway)" onclick="setElementColor('#ffe8b3', '#b25900')" style="background:#ffe8b3; border:2px solid #b25900;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Amarelo (Intermediário)" onclick="setElementColor('#ffffb6', '#999900')" style="background:#ffffb6; border:2px solid #999900;"></button>
              <button type="button" class="color-preset-circle" title="Fluig Lilás/Roxo" onclick="setElementColor('#e8e0f5', '#5e35b1')" style="background:#e8e0f5; border:2px solid #5e35b1;"></button>
              <button type="button" class="color-preset-circle" title="Cinza Suave" onclick="setElementColor('#f0f0f0', '#555555')" style="background:#f0f0f0; border:2px solid #555555;"></button>
              <button type="button" class="color-preset-circle" title="Branco / Neutro" onclick="setElementColor('#ffffff', '#222222')" style="background:#ffffff; border:2px solid #222222;"></button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
              <div style="display:flex; align-items:center; gap:4px; font-size:11px;">
                <label style="margin:0; font-size:11px;">Fundo:</label>
                <input type="color" id="elemFillPicker" value="\${colors.fill}" oninput="onCustomColorChange()" style="width:28px; height:24px; padding:0; border:1px solid var(--border); border-radius:3px; cursor:pointer; background:transparent;">
              </div>
              <div style="display:flex; align-items:center; gap:4px; font-size:11px;">
                <label style="margin:0; font-size:11px;">Borda:</label>
                <input type="color" id="elemStrokePicker" value="\${colors.stroke}" oninput="onCustomColorChange()" style="width:28px; height:24px; padding:0; border:1px solid var(--border); border-radius:3px; cursor:pointer; background:transparent;">
              </div>
              <button type="button" class="secondary" style="font-size:11px; padding:3px 6px; margin-left:auto;" onclick="applyDefaultColorToSelected()" title="Restaurar cor padrão Fluig para este tipo">Fluig Padrão</button>
            </div>
          </div>
        \`;
      }

      container.innerHTML = \`
        <div class="selected-card">
          <div class="selected-card-title">
            <span>\${name}</span>
            <span class="selected-type">\${type.replace('bpmn:', '')}</span>
          </div>
          <div class="selected-id">ID: \${element.id}</div>
          <div class="form-group" style="margin-bottom:6px;">
            <label>Nome / Rótulo</label>
            <input type="text" value="\${name}" oninput="updateElementName(this.value)">
          </div>
          \${colorControlsHtml}
          \${serviceBtnHtml}
        </div>
      \`;
    }

    function getFluigColorsForType(type) {
      const t = (type || '').toLowerCase();
      if (t.includes('startevent')) {
        return { fill: '#b6ffb6', stroke: '#336633' };
      }
      if (t.includes('endevent')) {
        return { fill: '#ffb6b6', stroke: '#993333' };
      }
      if (t.includes('intermediate') || t.includes('boundary')) {
        return { fill: '#ffffb6', stroke: '#999900' };
      }
      if (t.includes('gateway')) {
        return { fill: '#ffe8b3', stroke: '#b25900' };
      }
      if (t.includes('task')) {
        return { fill: '#deedfa', stroke: '#191970' };
      }
      if (t.includes('subprocess') || t.includes('callactivity')) {
        return { fill: '#f0f8ff', stroke: '#191970' };
      }
      if (t.includes('participant') || t.includes('lane')) {
        return { fill: '#ffffff', stroke: '#555555' };
      }
      if (t.includes('sequenceflow')) {
        return { stroke: '#333333' };
      }
      return null;
    }

    function normalizeColorToHex(colorStr, fallbackHex) {
      if (!colorStr) return fallbackHex;
      const s = colorStr.trim();
      if (s.startsWith('#')) {
        if (s.length === 4) {
          return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
        }
        return s;
      }
      if (s.startsWith('rgb')) {
        const m = s.match(/\\d+/g);
        if (m && m.length >= 3) {
          const r = parseInt(m[0], 10).toString(16).padStart(2, '0');
          const g = parseInt(m[1], 10).toString(16).padStart(2, '0');
          const b = parseInt(m[2], 10).toString(16).padStart(2, '0');
          return '#' + r + g + b;
        }
      }
      return fallbackHex;
    }

    function getElementColors(element) {
      if (!element) return { fill: '#ffffff', stroke: '#222222' };
      const std = getFluigColorsForType(element.type);
      let fill = null;
      let stroke = null;

      const di = element.di || element.businessObject?.di;
      if (di) {
        try {
          fill = di.fill || (di.get && (di.get('bioc:fill') || di.get('color:background-color')));
          stroke = di.stroke || (di.get && (di.get('bioc:stroke') || di.get('color:border-color')));
        } catch (e) {}
      }

      if ((!fill || !stroke) && modeler) {
        try {
          const gfx = modeler.get('elementRegistry').getGraphics(element);
          if (gfx) {
            const visual = gfx.querySelector('.djs-visual > *:not(text)');
            if (visual) {
              if (!fill) fill = visual.getAttribute('fill') || visual.style.fill;
              if (!stroke) stroke = visual.getAttribute('stroke') || visual.style.stroke;
            }
          }
        } catch (e) {}
      }

      if (!fill || fill === 'none' || fill === 'transparent') {
        fill = (std && std.fill) ? std.fill : '#ffffff';
      }
      if (!stroke || stroke === 'none') {
        stroke = (std && std.stroke) ? std.stroke : '#222222';
      }

      fill = normalizeColorToHex(fill, (std && std.fill) || '#ffffff');
      stroke = normalizeColorToHex(stroke, (std && std.stroke) || '#222222');

      return { fill, stroke };
    }

    function setElementColor(fill, stroke) {
      if (!modeler) return;
      const selection = modeler.get('selection').get();
      const targets = (selection && selection.length > 0) ? selection : (selectedElement ? [selectedElement] : []);
      if (targets.length === 0) return;

      try {
        const modeling = modeler.get('modeling');
        const colorObj = {};
        if (stroke) colorObj.stroke = stroke;
        if (fill) colorObj.fill = fill;
        modeling.setColor(targets, colorObj);

        const fillInput = document.getElementById('elemFillPicker');
        const strokeInput = document.getElementById('elemStrokePicker');
        if (fillInput && fill) fillInput.value = normalizeColorToHex(fill, fillInput.value);
        if (strokeInput && stroke) strokeInput.value = normalizeColorToHex(stroke, strokeInput.value);
      } catch (err) {
        console.error('Erro ao definir cor do elemento:', err);
      }
    }

    function onCustomColorChange() {
      const fillInput = document.getElementById('elemFillPicker');
      const strokeInput = document.getElementById('elemStrokePicker');
      const fill = fillInput ? fillInput.value : null;
      const stroke = strokeInput ? strokeInput.value : null;
      setElementColor(fill, stroke);
    }

    function applyDefaultColorToSelected() {
      if (!selectedElement) return;
      const colors = getFluigColorsForType(selectedElement.type);
      if (colors) {
        setElementColor(colors.fill, colors.stroke);
      }
    }

    function applyFluigColors() {
      if (!modeler) return;
      try {
        const elementRegistry = modeler.get('elementRegistry');
        const modeling = modeler.get('modeling');
        const allElements = elementRegistry.getAll();

        let count = 0;
        allElements.forEach(elem => {
          if (elem.type === 'bpmn:Process' || elem.type === 'bpmn:Collaboration') return;
          const colors = getFluigColorsForType(elem.type);
          if (colors && colors.fill) {
            modeling.setColor(elem, colors);
            count++;
          }
        });

        const toast = document.getElementById('toast');
        toast.innerText = 'Cores Fluig aplicadas a ' + count + ' elementos!';
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2500);

        if (selectedElement) {
          renderSelectedElement(selectedElement);
        }
      } catch (err) {
        console.error('Erro ao aplicar cores Fluig:', err);
      }
    }

    function updateElementName(newName) {
      if (!selectedElement || !modeler) return;
      try {
        const modeling = modeler.get('modeling');
        modeling.updateLabel(selectedElement, newName);
      } catch (e) {
        console.warn('Erro ao atualizar nome do elemento:', e);
      }
    }

    function createOrOpenServiceScript(elementId, elementName) {
      vscode.postMessage({
        command: 'createServiceScript',
        elementId,
        elementName
      });
    }

    function onDescChange(newDesc) {
      document.getElementById('headerTitle').innerText = newDesc;
    }

    // Salvar Processo (Exporta BPMN XML e SVG do modeler)
    async function saveDiagram() {
      if (!modeler) return;
      try {
        const { xml } = await modeler.saveXML({ format: true });
        let svg = '';
        try {
          const svgResult = await modeler.saveSVG();
          svg = svgResult.svg;
          const svgBox = document.getElementById('svgContentBox');
          if (svgBox && svg) {
            svgBox.innerHTML = svg;
          }
        } catch (svgErr) {
          console.warn('Não foi possível gerar SVG:', svgErr);
        }

        const desc = document.getElementById('inputDesc').value;
        const formId = document.getElementById('inputFormId').value;

        vscode.postMessage({
          command: 'saveProcess',
          xml,
          svg,
          processDescription: desc,
          formId
        });
      } catch (err) {
        console.error('Erro ao salvar:', err);
      }
    }

    // Listener de resposta do salvamento
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'saveResult' && msg.success) {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2500);
      }
    });

    // Atalho Ctrl+S para salvar
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveDiagram();
      }
    });

    // Alternar entre Modos Modeler e SVG
    function switchMode(mode) {
      currentMode = mode;
      const bpmnCanvas = document.getElementById('bpmnCanvas');
      const svgCanvasEl = document.getElementById('svgCanvas');
      const btnModeler = document.getElementById('btnModeModeler');
      const btnSvg = document.getElementById('btnModeSvg');

      if (mode === 'modeler') {
        bpmnCanvas.style.display = 'block';
        svgCanvasEl.style.display = 'none';
        btnModeler.classList.add('active');
        btnSvg.classList.remove('active');
      } else {
        bpmnCanvas.style.display = 'none';
        svgCanvasEl.style.display = 'block';
        btnModeler.classList.remove('active');
        btnSvg.classList.add('active');
        setTimeout(fitSvgToScreen, 50);
      }
    }

    // Zoom Controls
    function zoomIn() {
      if (currentMode === 'modeler' && modeler) {
        const canvas = modeler.get('canvas');
        canvas.zoom(canvas.zoom() * 1.2);
        updateZoomDisplay(Math.round(canvas.zoom() * 100));
      } else {
        svgScale = Math.min(svgScale * 1.2, 5);
        updateSvgTransform();
      }
    }

    function zoomOut() {
      if (currentMode === 'modeler' && modeler) {
        const canvas = modeler.get('canvas');
        canvas.zoom(canvas.zoom() / 1.2);
        updateZoomDisplay(Math.round(canvas.zoom() * 100));
      } else {
        svgScale = Math.max(svgScale / 1.2, 0.2);
        updateSvgTransform();
      }
    }

    function resetZoom() {
      if (currentMode === 'modeler' && modeler) {
        const canvas = modeler.get('canvas');
        canvas.zoom(1.0);
        updateZoomDisplay(100);
      } else {
        svgScale = 1;
        svgTranslateX = 40;
        svgTranslateY = 40;
        updateSvgTransform();
      }
    }

    function fitToScreen() {
      if (currentMode === 'modeler' && modeler) {
        const canvas = modeler.get('canvas');
        canvas.zoom('fit-viewport');
        updateZoomDisplay(Math.round(canvas.zoom() * 100));
      } else {
        fitSvgToScreen();
      }
    }

    function updateZoomDisplay(val) {
      zoomText.innerText = val + '%';
    }

    function updateSvgTransform() {
      svgBox.style.transform = 'translate(' + svgTranslateX + 'px, ' + svgTranslateY + 'px) scale(' + svgScale + ')';
      updateZoomDisplay(Math.round(svgScale * 100));
    }

    let isGridVisible = true;

    function updateGrid(viewbox) {
      const el = document.getElementById('bpmnCanvas');
      if (!el) return;
      if (!isGridVisible) {
        el.style.backgroundImage = 'none';
        return;
      }

      if (!viewbox && modeler) {
        try {
          viewbox = modeler.get('canvas').viewbox();
        } catch (e) {}
      }

      if (!viewbox) return;

      const scale = viewbox.scale || 1;
      const minor = 20 * scale;
      const major = 100 * scale;
      const px = -viewbox.x * scale;
      const py = -viewbox.y * scale;

      if (scale < 0.45) {
        el.style.backgroundImage = 'linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.08) 1px, transparent 1px)';
        el.style.backgroundSize = major + 'px ' + major + 'px';
        el.style.backgroundPosition = px + 'px ' + py + 'px, ' + px + 'px ' + py + 'px';
      } else {
        el.style.backgroundImage = 'linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(to right, rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.035) 1px, transparent 1px)';
        el.style.backgroundSize = major + 'px ' + major + 'px, ' + major + 'px ' + major + 'px, ' + minor + 'px ' + minor + 'px, ' + minor + 'px ' + minor + 'px';
        el.style.backgroundPosition = px + 'px ' + py + 'px, ' + px + 'px ' + py + 'px, ' + px + 'px ' + py + 'px, ' + px + 'px ' + py + 'px';
      }
    }

    function toggleGrid() {
      isGridVisible = !isGridVisible;
      const btn = document.getElementById('btnToggleGrid');
      if (btn) {
        if (isGridVisible) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
      updateGrid();
    }

    function fitSvgToScreen() {
      const wrapWidth = svgCanvas.clientWidth - 80;
      const wrapHeight = svgCanvas.clientHeight - 80;
      const contWidth = svgBox.offsetWidth || 500;
      const contHeight = svgBox.offsetHeight || 400;

      const scaleX = wrapWidth / contWidth;
      const scaleY = wrapHeight / contHeight;
      svgScale = Math.min(scaleX, scaleY, 1.5);
      svgTranslateX = (svgCanvas.clientWidth - (contWidth * svgScale)) / 2;
      svgTranslateY = (svgCanvas.clientHeight - (contHeight * svgScale)) / 2;
      updateSvgTransform();
    }

    // Drag SVG
    svgCanvas.addEventListener('mousedown', (e) => {
      isSvgDragging = true;
      svgStartX = e.clientX - svgTranslateX;
      svgStartY = e.clientY - svgTranslateY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isSvgDragging) return;
      svgTranslateX = e.clientX - svgStartX;
      svgTranslateY = e.clientY - svgStartY;
      updateSvgTransform();
    });

    window.addEventListener('mouseup', () => {
      isSvgDragging = false;
    });

    svgCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.min(Math.max(svgScale * factor, 0.2), 5);

      const rect = svgCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      svgTranslateX = mouseX - (mouseX - svgTranslateX) * (newScale / svgScale);
      svgTranslateY = mouseY - (mouseY - svgTranslateY) * (newScale / svgScale);
      svgScale = newScale;
      updateSvgTransform();
    }, { passive: false });

    // Actions
    function openScript(filename) {
      vscode.postMessage({ command: 'openScript', filename });
    }

    function openTextFile(filePath) {
      if (filePath) {
        vscode.postMessage({ command: 'openFile', filePath });
      }
    }

    function exportProcess() {
      vscode.postMessage({ command: 'exportProcess' });
    }

    function createEventScript() {
      vscode.postMessage({ command: 'createEventScript' });
    }

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
  </script>
</body>
</html>`;
  }
}

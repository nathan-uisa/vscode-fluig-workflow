import * as fs from 'fs';
import * as path from 'path';

export interface GeneratedArtifacts {
  ecm30Path: string;
  ecm30Content: Buffer;
  svgPath: string;
  svgContent: Buffer;
}

export class Ecm30GeneratorService {
  /**
   * Garante que os artefatos .ecm30.xml e .svg existam e estejam atualizados
   */
  public static ensureArtifacts(processPath: string, force = false): GeneratedArtifacts {
    const dir = path.dirname(processPath);
    const processId = path.basename(processPath, '.process');

    const ecm30Path = path.join(dir, `${processId}.ecm30.xml`);
    const svgPath = path.join(dir, `${processId}.svg`);

    const processContent = fs.readFileSync(processPath, 'utf-8');

    let ecm30Content: Buffer;
    if (fs.existsSync(ecm30Path) && !force) {
      ecm30Content = fs.readFileSync(ecm30Path);
    } else {
      const generatedXml = this.generateEcm30FromProcess(processId, processContent);
      ecm30Content = Buffer.from(generatedXml, 'utf-8');
      fs.writeFileSync(ecm30Path, ecm30Content);
    }

    let svgContent: Buffer;
    if (fs.existsSync(svgPath) && !force) {
      svgContent = fs.readFileSync(svgPath);
    } else {
      const generatedSvg = this.generateSvgFromProcess(processId, processContent);
      svgContent = Buffer.from(generatedSvg, 'utf-8');
      fs.writeFileSync(svgPath, svgContent);
    }

    return {
      ecm30Path,
      ecm30Content,
      svgPath,
      svgContent
    };
  }

  /**
   * Converte a estrutura básica de um .process (XMI) para o formato ecm30.xml do Fluig
   */
  public static generateEcm30FromProcess(processId: string, processXmi: string): string {
    // Extrai descrição ou usa o próprio ID
    const descMatch = processXmi.match(/name="([^"]+)"/);
    const description = descMatch ? descMatch[1] : processId;

    // Extração básica de tarefas
    const tasks: Array<{ id: string; name: string; type: string }> = [];
    const taskRegex = /<(bpmn2:[a-zA-Z]+Task|bpmn2:startEvent|bpmn2:endEvent)\s+id="([^"]+)"(?:\s+name="([^"]*)")?/g;
    let match: RegExpExecArray | null;
    let seq = 1;

    while ((match = taskRegex.exec(processXmi)) !== null) {
      const type = match[1].replace('bpmn2:', '');
      const id = match[2];
      const name = match[3] || `Tarefa ${seq}`;
      tasks.push({ id, name, type });
      seq++;
    }

    // Se não encontrou nenhuma no regex simples, cria as tarefas padrões (Início e Fim)
    if (tasks.length === 0) {
      tasks.push({ id: 'startevent1', name: 'Início', type: 'startEvent' });
      tasks.push({ id: 'usertask1', name: 'Atividade Principal', type: 'userTask' });
      tasks.push({ id: 'endevent1', name: 'Fim', type: 'endEvent' });
    }

    let taskItems = '';
    tasks.forEach((t, i) => {
      const taskSeq = (i + 1) * 2;
      const taskType = t.type === 'startEvent' ? 0 : t.type === 'endEvent' ? 2 : 1;
      taskItems += `
  <item class="com.datasul.technology.webdesk.workflow.model.Task">
    <sequence>${taskSeq}</sequence>
    <taskName>${this.escapeXml(t.name)}</taskName>
    <taskType>${taskType}</taskType>
    <processId>${this.escapeXml(processId)}</processId>
    <version>1</version>
  </item>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<list>
  <item class="com.datasul.technology.webdesk.workflow.model.ProcessDefinition">
    <processId>${this.escapeXml(processId)}</processId>
    <processDescription>${this.escapeXml(description)}</processDescription>
    <active>true</active>
    <version>1</version>
    <serverVersion>1.8.2</serverVersion>
  </item>
  ${taskItems}
</list>`;
  }

  /**
   * Gera um SVG limpo para visualização do fluxo no servidor
   */
  public static generateSvgFromProcess(processId: string, processXmi: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#555"/>
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff" />
  <g transform="translate(60, 150)">
    <!-- Start Event -->
    <circle cx="20" cy="30" r="20" fill="#c8e6c9" stroke="#2e7d32" stroke-width="2" />
    <text x="20" y="35" font-family="sans-serif" font-size="11" text-anchor="middle" fill="#1b5e20">Início</text>
    
    <!-- Line 1 -->
    <line x1="40" y1="30" x2="160" y2="30" stroke="#555" stroke-width="2" marker-end="url(#arrow)" />
    
    <!-- User Task -->
    <rect x="160" y="0" width="160" height="60" rx="8" fill="#e3f2fd" stroke="#1565c0" stroke-width="2" />
    <text x="240" y="35" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#0d47a1">Atividade</text>
    
    <!-- Line 2 -->
    <line x1="320" y1="30" x2="440" y2="30" stroke="#555" stroke-width="2" marker-end="url(#arrow)" />
    
    <!-- End Event -->
    <circle cx="460" cy="30" r="20" fill="#ffcdd2" stroke="#c62828" stroke-width="3" />
    <text x="460" y="35" font-family="sans-serif" font-size="11" text-anchor="middle" fill="#b71c1c">Fim</text>
  </g>
  <text x="20" y="30" font-family="sans-serif" font-size="14" font-weight="bold" fill="#333">${this.escapeXml(processId)}</text>
</svg>`;
  }

  private static escapeXml(unsafe: string): string {
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
}

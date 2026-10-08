import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Ecm30GeneratorService } from './Ecm30GeneratorService';
import { WorkflowRestService } from './WorkflowRestService';

export class DiagramViewerService {
  private static activePanels: Map<string, vscode.WebviewPanel> = new Map();

  /**
   * Abre o visualizador de diagrama para um processo específico
   */
  public static async openDiagram(target: string | vscode.Uri): Promise<void> {
    try {
      let targetPath = typeof target === 'string' ? target : target.fsPath;

      // Se foi passado apenas o ID do processo
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder && !path.isAbsolute(targetPath)) {
        vscode.window.showErrorMessage('Abra uma pasta no VS Code para visualizar o diagrama.');
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

      const svgPath = path.join(diagramsDir, `${processId}.svg`);
      const processPath = path.join(diagramsDir, `${processId}.process`);
      const ecm30Path = path.join(diagramsDir, `${processId}.ecm30.xml`);

      // Se o SVG não existir mas o .process existir, tenta gerar
      if (!fs.existsSync(svgPath) && fs.existsSync(processPath)) {
        try {
          Ecm30GeneratorService.ensureArtifacts(processPath);
        } catch (e) {
          console.warn('Não foi possível auto-gerar SVG do .process:', e);
        }
      }

      // Se ainda não existir SVG nem .process nem ecm30
      if (!fs.existsSync(svgPath) && !fs.existsSync(processPath) && !fs.existsSync(ecm30Path)) {
        vscode.window.showErrorMessage(
          `Nenhum artefato encontrado para o processo '${processId}' na pasta workflow/diagrams.`
        );
        return;
      }

      // Verifica se já tem painel aberto para esse processo
      const existingPanel = this.activePanels.get(processId);
      if (existingPanel) {
        existingPanel.reveal(vscode.ViewColumn.Active);
        this.updatePanelContent(existingPanel, processId, diagramsDir, scriptsDir);
        return;
      }

      // Cria novo WebviewPanel
      const panel = vscode.window.createWebviewPanel(
        'fluigWorkflowDiagram',
        `Diagrama: ${processId}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(diagramsDir)]
        }
      );

      this.activePanels.set(processId, panel);

      panel.onDidDispose(() => {
        this.activePanels.delete(processId);
      });

      // Configura listener de mensagens do Webview
      panel.webview.onDidReceiveMessage(async message => {
        switch (message.command) {
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

          case 'openFile': {
            const filePath = message.filePath;
            if (fs.existsSync(filePath)) {
              // Abre explicitamente como editor de texto para evitar erros de plugins de terceiros
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

          case 'createScript': {
            const stdEvents = WorkflowRestService.getStandardWorkflowEvents();
            const picked = await vscode.window.showQuickPick(
              stdEvents.map(e => ({
                label: e.name,
                description: e.description,
                template: e.template
              })),
              { placeHolder: 'Selecione o evento para criar o script' }
            );

            if (picked) {
              if (!fs.existsSync(scriptsDir)) {
                fs.mkdirSync(scriptsDir, { recursive: true });
              }
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
      vscode.window.showErrorMessage(`Erro ao abrir visualizador de diagrama: ${error.message || error}`);
    }
  }

  /**
   * Atualiza o HTML e os dados do Webview
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

    let svgContent = '';
    if (fs.existsSync(svgPath)) {
      svgContent = fs.readFileSync(svgPath, 'utf-8');
      // Remove declaração <?xml...?> se presente para embutir no HTML
      svgContent = svgContent.replace(/<\?xml[^>]*\?>/i, '').trim();
    } else {
      svgContent = `<div style="padding: 40px; text-align: center; color: var(--vscode-descriptionForeground);">
        <p>Diagrama SVG não encontrado em workflow/diagrams/${processId}.svg.</p>
        <p>Salve o arquivo .process para compilar o SVG automaticamente.</p>
      </div>`;
    }

    // Lê metadados do ECM30 se disponível
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

        // Extrai estados
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
        console.warn('Erro ao extrair metadados do ECM30:', err);
      }
    }

    // Busca scripts existentes na pasta scripts
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

    panel.webview.html = this.renderHtml({
      processId,
      processDesc,
      version,
      formId,
      svgContent,
      activities,
      existingScripts,
      processPath: fs.existsSync(processPath) ? processPath : undefined,
      ecm30Path: fs.existsSync(ecm30Path) ? ecm30Path : undefined
    });
  }

  private static renderHtml(data: {
    processId: string;
    processDesc: string;
    version: string;
    formId: string;
    svgContent: string;
    activities: Array<{ sequence: string; name: string; type: string; scriptFile?: string }>;
    existingScripts: Array<{ name: string; fullPath: string; size: number }>;
    processPath?: string;
    ecm30Path?: string;
  }): string {
    const activitiesJson = JSON.stringify(data.activities);
    const scriptsJson = JSON.stringify(data.existingScripts);

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagrama: ${data.processId}</title>
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

    /* Toolbar Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background-color: var(--card-bg);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      gap: 12px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
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

    .header-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    button {
      background-color: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background-color 0.15s;
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

    /* Main Container */
    .main-container {
      display: flex;
      flex: 1;
      height: calc(100vh - 51px);
      overflow: hidden;
      position: relative;
    }

    /* Canvas Area */
    .canvas-wrapper {
      flex: 1;
      position: relative;
      overflow: hidden;
      background: radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px);
      background-size: 20px 20px;
      cursor: grab;
      user-select: none;
    }

    .canvas-wrapper:active {
      cursor: grabbing;
    }

    .canvas-content {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      transition: transform 0.05s ease-out;
      background-color: #ffffff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: inline-block;
    }

    /* SVG Diagram Styling inside White Background */
    .canvas-content svg {
      display: block;
      max-width: none;
      max-height: none;
    }

    /* Floating Zoom Controls */
    .zoom-toolbar {
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
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      z-index: 10;
    }

    .zoom-toolbar button {
      padding: 4px 8px;
      font-size: 13px;
    }

    .zoom-display {
      font-size: 11px;
      padding: 0 6px;
      min-width: 48px;
      text-align: center;
      color: var(--fg);
    }

    /* Sidebar Area */
    .sidebar {
      width: 320px;
      background-color: var(--card-bg);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      flex-shrink: 0;
    }

    .sidebar-section {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 80px 1fr;
      row-gap: 6px;
      font-size: 12px;
    }

    .info-label {
      color: var(--vscode-descriptionForeground, #888);
    }

    .info-value {
      font-weight: 500;
      color: var(--fg);
      word-break: break-all;
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

    .tag-task {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      background-color: rgba(0, 122, 204, 0.2);
      color: #70c0ff;
    }

    .tag-service {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      background-color: rgba(218, 112, 214, 0.2);
      color: #da70d6;
    }

    .empty-state {
      padding: 12px 0;
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      text-align: center;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="title">${data.processDesc}</div>
      <span class="badge badge-primary">ID: ${data.processId}</span>
      <span class="badge">v${data.version}</span>
      ${data.formId ? `<span class="badge">Formulário: #${data.formId}</span>` : ''}
    </div>

    <div class="header-controls">
      <button onclick="exportProcess()">▲ Exportar para o Fluig</button>
      <button class="secondary" onclick="createScript()">+ Script de Evento</button>
      <button class="secondary" onclick="openTextFile('${data.processPath || ''}')">Ver .process</button>
      <button class="secondary" onclick="openTextFile('${data.ecm30Path || ''}')">Ver .ecm30.xml</button>
      <button class="secondary" onclick="refresh()">↻</button>
    </div>
  </div>

  <!-- Main Body -->
  <div class="main-container">
    <!-- SVG Canvas -->
    <div class="canvas-wrapper" id="canvasWrapper">
      <div class="canvas-content" id="canvasContent">
        ${data.svgContent}
      </div>

      <!-- Zoom Toolbar -->
      <div class="zoom-toolbar">
        <button class="secondary" onclick="zoomIn()" title="Aproximar">+</button>
        <div class="zoom-display" id="zoomDisplay">100%</div>
        <button class="secondary" onclick="zoomOut()" title="Afastar">-</button>
        <button class="secondary" onclick="resetZoom()" title="Resetar Zoom">100%</button>
        <button class="secondary" onclick="fitToScreen()" title="Ajustar à Tela">Ajustar</button>
      </div>
    </div>

    <!-- Right Sidebar -->
    <div class="sidebar">
      <!-- Metadados -->
      <div class="sidebar-section">
        <div class="section-title">Informações do Processo</div>
        <div class="info-grid">
          <div class="info-label">ID:</div>
          <div class="info-value">${data.processId}</div>
          <div class="info-label">Descrição:</div>
          <div class="info-value">${data.processDesc}</div>
          <div class="info-label">Versão:</div>
          <div class="info-value">${data.version}</div>
          ${data.formId ? `
            <div class="info-label">Form ID:</div>
            <div class="info-value">${data.formId}</div>
          ` : ''}
        </div>
      </div>

      <!-- Atividades -->
      <div class="sidebar-section">
        <div class="section-title">
          <span>Atividades (${data.activities.length})</span>
        </div>
        <div id="activitiesList">
          ${data.activities.length === 0 ? '<div class="empty-state">Nenhuma atividade mapeada</div>' : ''}
          ${data.activities.map(act => `
            <div class="list-item">
              <div>
                <div class="list-item-title">
                  <span class="${act.type.includes('Serviço') ? 'tag-service' : 'tag-task'}">#${act.sequence}</span>
                  <span>${act.name}</span>
                </div>
                <div class="list-item-sub">${act.type}</div>
              </div>
              ${act.scriptFile ? `
                <button class="secondary" style="font-size:11px; padding:3px 6px;" onclick="openScript('${act.scriptFile}')" title="Abrir script ${act.scriptFile}">
                  {} JS
                </button>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Scripts Existentes -->
      <div class="sidebar-section">
        <div class="section-title">
          <span>Scripts de Eventos (${data.existingScripts.length})</span>
          <button class="secondary" style="padding: 2px 6px; font-size: 11px;" onclick="createScript()">+ Novo</button>
        </div>
        <div id="scriptsList">
          ${data.existingScripts.length === 0 ? '<div class="empty-state">Nenhum script na pasta workflow/scripts</div>' : ''}
          ${data.existingScripts.map(sc => `
            <div class="list-item">
              <div>
                <div class="list-item-title">📄 ${sc.name}</div>
                <div class="list-item-sub">${(sc.size / 1024).toFixed(1)} KB</div>
              </div>
              <button class="secondary" style="font-size:11px; padding:3px 6px;" onclick="openScript('${sc.name}')">
                Abrir
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Canvas Pan & Zoom State
    let scale = 1;
    let translateX = 40;
    let translateY = 40;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const wrapper = document.getElementById('canvasWrapper');
    const content = document.getElementById('canvasContent');
    const zoomDisplay = document.getElementById('zoomDisplay');

    function updateTransform() {
      content.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
      zoomDisplay.innerText = \`\${Math.round(scale * 100)}%\`;
    }

    function zoomIn() {
      scale = Math.min(scale * 1.2, 5);
      updateTransform();
    }

    function zoomOut() {
      scale = Math.max(scale / 1.2, 0.2);
      updateTransform();
    }

    function resetZoom() {
      scale = 1;
      translateX = 40;
      translateY = 40;
      updateTransform();
    }

    function fitToScreen() {
      const wrapWidth = wrapper.clientWidth - 80;
      const wrapHeight = wrapper.clientHeight - 80;
      const contWidth = content.offsetWidth || 500;
      const contHeight = content.offsetHeight || 400;

      const scaleX = wrapWidth / contWidth;
      const scaleY = wrapHeight / contHeight;
      scale = Math.min(scaleX, scaleY, 1.5);
      translateX = (wrapper.clientWidth - (contWidth * scale)) / 2;
      translateY = (wrapper.clientHeight - (contHeight * scale)) / 2;
      updateTransform();
    }

    // Mouse drag pan
    wrapper.addEventListener('mousedown', (e) => {
      if (e.target.closest('.zoom-toolbar')) return;
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
      updateTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Mouse wheel zoom
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.min(Math.max(scale * zoomFactor, 0.2), 5);

      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      translateX = mouseX - (mouseX - translateX) * (newScale / scale);
      translateY = mouseY - (mouseY - translateY) * (newScale / scale);
      scale = newScale;

      updateTransform();
    }, { passive: false });

    // Initial positioning
    setTimeout(fitToScreen, 100);

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

    function createScript() {
      vscode.postMessage({ command: 'createScript' });
    }

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
  </script>
</body>
</html>`;
  }
}

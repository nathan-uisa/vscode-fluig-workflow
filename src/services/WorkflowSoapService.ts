import * as vscode from 'vscode';
import { FluigServer } from '../models/Server';
import { ProcessItemSummary } from '../models/Process';

export interface SoapAttachment {
  fileName: string;
  content: Buffer;
  principal: boolean;
  processImage: boolean;
}

export class WorkflowSoapService {
  private static versionCache: Map<string, number> = new Map();
  private static storage?: vscode.Memento;

  public static initialize(context: vscode.ExtensionContext): void {
    this.storage = context.globalState;
    const stored = context.globalState.get<Record<string, number>>('fluig_process_versions');
    if (stored) {
      for (const [k, v] of Object.entries(stored)) {
        this.versionCache.set(k, v);
      }
    }
  }

  public static persistCache(): void {
    if (this.storage) {
      const obj: Record<string, number> = {};
      for (const [k, v] of this.versionCache.entries()) {
        obj[k] = v;
      }
      this.storage.update('fluig_process_versions', obj);
    }
  }

  public static getCacheKey(server: FluigServer, processId: string): string {
    return `${server.baseUrl}|${server.companyId}|${processId}`;
  }

  public static getCachedVersion(server: FluigServer, processId: string): number | undefined {
    return this.versionCache.get(this.getCacheKey(server, processId));
  }

  public static setCachedVersion(server: FluigServer, processId: string, version: number): void {
    if (version > 0) {
      this.versionCache.set(this.getCacheKey(server, processId), version);
    }
  }

  public static hasCachedVersion(server: FluigServer, processId: string): boolean {
    return this.versionCache.has(this.getCacheKey(server, processId));
  }

  public static clearCache(server?: FluigServer): void {
    if (!server) {
      this.versionCache.clear();
    } else {
      const prefix = `${server.baseUrl}|${server.companyId}|`;
      for (const key of Array.from(this.versionCache.keys())) {
        if (key.startsWith(prefix)) {
          this.versionCache.delete(key);
        }
      }
    }
    this.persistCache();
  }

  constructor(private server: FluigServer) {}

  private async callSoap(
    servicePath: string,
    action: string,
    bodyXml: string
  ): Promise<string> {
    const url = `${this.server.baseUrl}${servicePath}`;
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://ws.workflow.webdesk.technology.datasul.com/" xmlns:tok="http://ws.dm.webdesk.technology.datasul.com/">
  <soapenv:Header/>
  <soapenv:Body>
    ${bodyXml}
  </soapenv:Body>
</soapenv:Envelope>`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': action
      },
      body: envelope,
      signal: AbortSignal.timeout(30000)
    });

    const responseText = await response.text();
    if (!response.ok && !responseText.includes('<soap:Fault>') && !responseText.includes('<soapenv:Fault>')) {
      throw new Error(`Falha HTTP ${response.status} ao chamar SOAP ${action}: ${response.statusText}`);
    }

    if (responseText.includes('<soap:Fault>') || responseText.includes('<soapenv:Fault>')) {
      const match = responseText.match(/<faultstring>(.*?)<\/faultstring>/s);
      const errorMsg = match ? match[1].trim() : 'Erro SOAP retornado pelo Fluig';
      throw new Error(`Erro SOAP [${action}]: ${errorMsg}`);
    }

    return responseText;
  }

  /**
   * Obtém token de autenticação via TokenService
   */
  public async getToken(): Promise<string> {
    const login = this.server.username;
    const password = this.server.password || '';

    // Se o login for email, utiliza getTokenEmail prioritariamente
    if (login.includes('@')) {
      try {
        const emailBody = `<tok:getTokenEmail>
          <companyId>${this.server.companyId}</companyId>
          <email>${this.escapeXml(login)}</email>
          <password>${this.escapeXml(password)}</password>
        </tok:getTokenEmail>`;
        const emailRes = await this.callSoap('/webdesk/TokenService', 'getTokenEmail', emailBody);
        const match = emailRes.match(/<result>(.*?)<\/result>/s);
        if (match && match[1].trim() && !match[1].includes('UT010031')) {
          return match[1].trim();
        }
      } catch {
        // Fallback para getToken padrão
      }
    }

    const body = `<tok:getToken>
      <login>${this.escapeXml(login)}</login>
      <password>${this.escapeXml(password)}</password>
    </tok:getToken>`;

    const response = await this.callSoap('/webdesk/TokenService', 'getToken', body);
    const match = response.match(/<result>(.*?)<\/result>/s);
    if (!match || !match[1].trim()) {
      throw new Error('Falha ao autenticar: TokenService não retornou um token válido.');
    }

    const token = match[1].trim();
    if (token.includes('UT010031') || token.includes('invalido')) {
      throw new Error('Credenciais de acesso ao Fluig inválidas (UT010031: Login failed).');
    }
    return token;
  }

  /**
   * Lista todos os processos disponíveis para exportação/importação
   */
  public async getAllProcesses(options?: {
    resolveVersions?: boolean;
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  }): Promise<ProcessItemSummary[]> {
    const token = await this.getToken();
    const body = `<ws:getAllProcessAvailableToExport>
      <username>${this.escapeXml(token)}</username>
      <password></password>
      <companyId>${this.server.companyId}</companyId>
    </ws:getAllProcessAvailableToExport>`;

    const xml = await this.callSoap('/webdesk/WorkflowEngineService', 'getAllProcessAvailableToExport', body);
    const items = this.parseProcessList(xml);

    // Aplica versões já salvas no cache
    for (const item of items) {
      const cached = WorkflowSoapService.getCachedVersion(this.server, item.processId);
      if (cached !== undefined && cached > 0) {
        item.version = cached;
      }
    }

    if (options?.resolveVersions) {
      const ids = items.map(p => p.processId);
      const versionsMap = await this.getProcessVersionsBatch(ids, options.concurrency ?? 25, options.onProgress);
      for (const item of items) {
        const v = versionsMap.get(item.processId);
        if (v !== undefined && v > 0) {
          item.version = v;
        }
      }
    }

    return items;
  }

  /**
   * Retorna a versão atual do processo cadastrado
   */
  public async getProcessVersion(processId: string, bypassCache = false): Promise<number> {
    if (!bypassCache) {
      const cached = WorkflowSoapService.getCachedVersion(this.server, processId);
      if (cached !== undefined && cached > 0) {
        return cached;
      }
    }

    const token = await this.getToken();
    const body = `<ws:getWorkFlowProcessVersion>
      <username>${this.escapeXml(token)}</username>
      <password></password>
      <companyId>${this.server.companyId}</companyId>
      <processId>${this.escapeXml(processId)}</processId>
    </ws:getWorkFlowProcessVersion>`;

    try {
      const xml = await this.callSoap('/webdesk/WorkflowEngineService', 'getWorkFlowProcessVersion', body);
      const match = xml.match(/<result>(.*?)<\/result>/s);
      if (match) {
        const v = parseInt(match[1].trim(), 10);
        const resolved = isNaN(v) ? 0 : v;
        if (resolved > 0) {
          WorkflowSoapService.setCachedVersion(this.server, processId, resolved);
          WorkflowSoapService.persistCache();
        }
        return resolved;
      }
    } catch {
      return 0;
    }
    return 0;
  }

  /**
   * Busca as versões de múltiplos processos em paralelo com limite de concorrência
   */
  public async getProcessVersionsBatch(
    processIds: string[],
    concurrency = 25,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>();
    const uncachedIds: string[] = [];

    for (const id of processIds) {
      const cached = WorkflowSoapService.getCachedVersion(this.server, id);
      if (cached !== undefined && cached > 0) {
        results.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    }

    if (uncachedIds.length === 0) {
      onProgress?.(processIds.length, processIds.length);
      return results;
    }

    const token = await this.getToken();
    let completed = processIds.length - uncachedIds.length;
    onProgress?.(completed, processIds.length);

    for (let i = 0; i < uncachedIds.length; i += concurrency) {
      const chunk = uncachedIds.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async processId => {
          try {
            const body = `<ws:getWorkFlowProcessVersion>
              <username>${this.escapeXml(token)}</username>
              <password></password>
              <companyId>${this.server.companyId}</companyId>
              <processId>${this.escapeXml(processId)}</processId>
            </ws:getWorkFlowProcessVersion>`;
            const xml = await this.callSoap('/webdesk/WorkflowEngineService', 'getWorkFlowProcessVersion', body);
            const match = xml.match(/<result>(.*?)<\/result>/s);
            const v = match ? parseInt(match[1].trim(), 10) || 1 : 1;
            results.set(processId, v);
            WorkflowSoapService.setCachedVersion(this.server, processId, v);
          } catch {
            results.set(processId, 1);
          } finally {
            completed++;
          }
        })
      );
      WorkflowSoapService.persistCache();
      onProgress?.(completed, processIds.length);
    }

    return results;
  }

  /**
   * Cria uma nova versão de trabalho (draft) do processo
   */
  public async createProcessVersion(processId: string): Promise<boolean> {
    const token = await this.getToken();
    const body = `<ws:createWorkFlowProcessVersion>
      <username>${this.escapeXml(token)}</username>
      <password></password>
      <companyId>${this.server.companyId}</companyId>
      <processId>${this.escapeXml(processId)}</processId>
    </ws:createWorkFlowProcessVersion>`;

    try {
      const xml = await this.callSoap('/webdesk/WorkflowEngineService', 'createWorkFlowProcessVersion', body);
      if (xml.includes('Processo nao encontrado') || xml.includes('PROCESS_NOT_FOUND')) {
        return false;
      }
      return true;
    } catch (err: any) {
      if (err.message && (err.message.includes('Processo') || err.message.includes('not found') || err.message.includes('não encontrado'))) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Importa (envia) o processo para o servidor Fluig com os artefatos ECM30 e SVG
   */
  public async importProcess(
    processId: string,
    attachments: SoapAttachment[],
    isNewProcess: boolean
  ): Promise<string> {
    const token = await this.getToken();

    const attachmentItemsXml = attachments.map((att, index) => `
      <item>
        <attachmentSeq>${index + 1}</attachmentSeq>
        <fileName>${this.escapeXml(att.fileName)}</fileName>
        <fileContent>${att.content.toString('base64')}</fileContent>
        <principal>${att.principal}</principal>
        <processImage>${att.processImage}</processImage>
      </item>
    `).join('\n');

    const body = `<ws:importProcess>
      <username>${this.escapeXml(token)}</username>
      <password></password>
      <companyId>${this.server.companyId}</companyId>
      <processId>${this.escapeXml(processId)}</processId>
      <colleagueId>${this.escapeXml(this.server.userCode)}</colleagueId>
      <newProcess>${isNewProcess}</newProcess>
      <overWrite>true</overWrite>
      <attachments>
        ${attachmentItemsXml}
      </attachments>
    </ws:importProcess>`;

    const response = await this.callSoap('/webdesk/WorkflowEngineService', 'importProcess', body);
    if (response.includes('<faultstring>') || response.includes('ERRO')) {
      throw new Error(`Falha ao importar processo ${processId}: ${response}`);
    }
    return response;
  }

  /**
   * Libera a nova versão do processo no Fluig
   */
  public async releaseProcess(processId: string): Promise<boolean> {
    const token = await this.getToken();
    const body = `<ws:releaseProcess>
      <username>${this.escapeXml(token)}</username>
      <password></password>
      <companyId>${this.server.companyId}</companyId>
      <processId>${this.escapeXml(processId)}</processId>
    </ws:releaseProcess>`;

    const response = await this.callSoap('/webdesk/WorkflowEngineService', 'releaseProcess', body);
    return !response.includes('<faultstring>');
  }

  /**
   * Exporta (baixa) a definição completa do processo do Fluig em formato ECM30 XML
   */
  public async exportProcess(processId: string): Promise<string> {
    const token = await this.getToken();
    const body = `<ws:exportProcess>
      <username>${this.escapeXml(token)}</username>
      <password></password>
      <companyId>${this.server.companyId}</companyId>
      <processId>${this.escapeXml(processId)}</processId>
    </ws:exportProcess>`;

    const xml = await this.callSoap('/webdesk/WorkflowEngineService', 'exportProcess', body);
    const match = xml.match(/<result>(.*?)<\/result>/s);
    if (!match || !match[1].trim()) {
      throw new Error(`Processo ${processId} não foi encontrado ou não retornou dados no servidor Fluig.`);
    }

    // Desescapa entidades XML retornadas dentro da tag <result>
    return this.unescapeXml(match[1].trim());
  }

  public escapeXml(unsafe: string): string {
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

  public unescapeXml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  private parseProcessList(xml: string): ProcessItemSummary[] {
    const items: ProcessItemSummary[] = [];
    const itemRegex = /<item>(.*?)<\/item>/gs;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[1];
      const idMatch = content.match(/<processId>(.*?)<\/processId>/);
      const descMatch = content.match(/<processDescription>(.*?)<\/processDescription>/);
      const versionMatch = content.match(/<version>(.*?)<\/version>/);
      const activeMatch = content.match(/<active>(.*?)<\/active>/);

      if (idMatch) {
        const pId = idMatch[1].trim();
        const cached = WorkflowSoapService.getCachedVersion(this.server, pId);
        const parsedVer = versionMatch ? parseInt(versionMatch[1].trim(), 10) : 0;
        const isActive = activeMatch ? activeMatch[1].trim().toLowerCase() === 'true' : true;

        items.push({
          processId: pId,
          processDescription: descMatch ? descMatch[1].trim() : pId,
          version: (cached && cached > 0) ? cached : (parsedVer > 0 ? parsedVer : 0),
          active: isActive
        });
      }
    }

    return items.sort((a, b) => a.processId.localeCompare(b.processId));
  }
}

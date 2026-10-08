import { FluigServer } from '../models/Server';
import { ProcessItemSummary } from '../models/Process';

export interface SoapAttachment {
  fileName: string;
  content: Buffer;
  principal: boolean;
  processImage: boolean;
}

export class WorkflowSoapService {
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
  public async getAllProcesses(): Promise<ProcessItemSummary[]> {
    const token = await this.getToken();
    const body = `<ws:getAllProcessAvailableToExport>
      <username>${this.escapeXml(token)}</username>
      <password></password>
      <companyId>${this.server.companyId}</companyId>
    </ws:getAllProcessAvailableToExport>`;

    const xml = await this.callSoap('/webdesk/WorkflowEngineService', 'getAllProcessAvailableToExport', body);
    return this.parseProcessList(xml);
  }

  /**
   * Retorna a versão atual do processo cadastrado
   */
  public async getProcessVersion(processId: string): Promise<number> {
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
        return isNaN(v) ? 0 : v;
      }
    } catch {
      return 0;
    }
    return 0;
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

      if (idMatch) {
        items.push({
          processId: idMatch[1].trim(),
          processDescription: descMatch ? descMatch[1].trim() : idMatch[1].trim(),
          version: versionMatch ? parseInt(versionMatch[1].trim(), 10) || 1 : 1,
          active: true
        });
      }
    }

    return items.sort((a, b) => a.processId.localeCompare(b.processId));
  }
}

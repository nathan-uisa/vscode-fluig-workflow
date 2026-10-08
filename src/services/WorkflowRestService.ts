import { FluigServer } from '../models/Server';
import { ProcessDetail, ProcessEventItem } from '../models/Process';

export class WorkflowRestService {
  constructor(private server: FluigServer) {}

  private getAuthHeader(): Record<string, string> {
    const creds = Buffer.from(`${this.server.username}:${this.server.password || ''}`).toString('base64');
    return {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Obtém detalhes do processo via API REST v2 do Fluig
   */
  public async getProcessDetails(processId: string): Promise<ProcessDetail | null> {
    const url = `${this.server.baseUrl}/process-management/api/v2/processes/${encodeURIComponent(processId)}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeader()
      });

      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      return {
        processId: data.processId || processId,
        processDescription: data.processDescription || data.description || processId,
        version: data.version || 1,
        formId: data.formId,
        formVersion: data.formVersion
      };
    } catch {
      return null;
    }
  }

  /**
   * Busca os eventos de script de um processo específico
   */
  public async getProcessEvents(processId: string): Promise<ProcessEventItem[]> {
    const url = `${this.server.baseUrl}/process-management/api/v2/processes/${encodeURIComponent(processId)}/events`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeader()
      });

      if (!response.ok) {
        return [];
      }

      const data: any = await response.json();
      const items = data.items || data;
      if (!Array.isArray(items)) {
        return [];
      }

      return items.map((item: any) => ({
        eventId: item.eventId || item.id || item.name,
        eventName: item.eventName || item.name,
        eventDescription: item.description,
        code: item.code || item.content || item.script || ''
      }));
    } catch {
      return [];
    }
  }

  /**
   * Lista padrão dos principais eventos de processo do Fluig
   */
  public static getStandardWorkflowEvents(): Array<{ name: string; description: string; template: string }> {
    return [
      {
        name: 'beforeTaskSave',
        description: 'Executado antes de salvar a movimentação da tarefa',
        template: `function beforeTaskSave(colleagueId, nextSequenceId, userList){\n    log.info("### Executando beforeTaskSave...");\n}`
      },
      {
        name: 'afterTaskSave',
        description: 'Executado após salvar a movimentação da tarefa',
        template: `function afterTaskSave(colleagueId, nextSequenceId, userList){\n    log.info("### Executando afterTaskSave...");\n}`
      },
      {
        name: 'beforeCancelProcess',
        description: 'Executado antes do cancelamento do processo',
        template: `function beforeCancelProcess(colleagueId, processId){\n    log.info("### Executando beforeCancelProcess...");\n}`
      },
      {
        name: 'afterProcessCreate',
        description: 'Executado após a criação da instância do processo',
        template: `function afterProcessCreate(processId){\n    log.info("### Processo criado: " + processId);\n}`
      },
      {
        name: 'checkWorkflowTaskCondition',
        description: 'Validação de condições de transições automáticas',
        template: `function checkWorkflowTaskCondition(taskSequenceId, conditionNumber){\n    return true;\n}`
      }
    ];
  }
}

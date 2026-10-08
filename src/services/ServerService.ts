import * as vscode from 'vscode';
import { FluigServer } from '../models/Server';

export class ServerService {
  private static readonly STORAGE_KEY = 'fluigWorkflow.servers';
  private static readonly ACTIVE_SERVER_KEY = 'fluigWorkflow.activeServerId';

  constructor(private context: vscode.ExtensionContext) {}

  public getServers(): FluigServer[] {
    return this.context.globalState.get<FluigServer[]>(ServerService.STORAGE_KEY, []);
  }

  public async saveServer(server: FluigServer): Promise<void> {
    const servers = this.getServers();
    const index = servers.findIndex(s => s.id === server.id);
    if (index >= 0) {
      servers[index] = server;
    } else {
      servers.push(server);
    }
    await this.context.globalState.update(ServerService.STORAGE_KEY, servers);

    if (servers.length === 1 || server.isDefault) {
      await this.setActiveServer(server.id);
    }
  }

  public async removeServer(id: string): Promise<void> {
    const servers = this.getServers().filter(s => s.id !== id);
    await this.context.globalState.update(ServerService.STORAGE_KEY, servers);

    const activeId = this.getActiveServerId();
    if (activeId === id) {
      const nextActive = servers[0]?.id || null;
      await this.context.globalState.update(ServerService.ACTIVE_SERVER_KEY, nextActive);
    }
  }

  public getActiveServerId(): string | null {
    return this.context.globalState.get<string | null>(ServerService.ACTIVE_SERVER_KEY, null);
  }

  public async setActiveServer(id: string): Promise<void> {
    await this.context.globalState.update(ServerService.ACTIVE_SERVER_KEY, id);
  }

  public getActiveServer(): FluigServer | undefined {
    const servers = this.getServers();
    const activeId = this.getActiveServerId();
    if (activeId) {
      const found = servers.find(s => s.id === activeId);
      if (found) {
        return found;
      }
    }
    return servers.find(s => s.isDefault) || servers[0];
  }

  public async promptAddServer(): Promise<FluigServer | undefined> {
    const name = await vscode.window.showInputBox({
      prompt: 'Nome de identificação do Servidor (ex: Fluig Desenvolvimento / Produção)',
      validateInput: v => (v ? null : 'Nome é obrigatório')
    });
    if (!name) return;

    const baseUrl = await vscode.window.showInputBox({
      prompt: 'URL Base do Servidor Fluig (ex: https://fluig.empresa.com.br ou http://192.168.1.10:8080)',
      validateInput: v => {
        try {
          const url = new URL(v);
          if (!['http:', 'https:'].includes(url.protocol)) return 'Deve ser http ou https';
          return null;
        } catch {
          return 'URL inválida';
        }
      }
    });
    if (!baseUrl) return;

    const companyIdStr = await vscode.window.showInputBox({
      prompt: 'Código da Empresa (companyId, ex: 1)',
      value: '1',
      validateInput: v => (/^\d+$/.test(v) && parseInt(v) > 0 ? null : 'Deve ser um número inteiro positivo')
    });
    if (!companyIdStr) return;

    const username = await vscode.window.showInputBox({
      prompt: 'Login do Usuário',
      validateInput: v => (v ? null : 'Login é obrigatório')
    });
    if (!username) return;

    const password = await vscode.window.showInputBox({
      prompt: 'Senha do Usuário',
      password: true,
      validateInput: v => (v ? null : 'Senha é obrigatória')
    });
    if (!password) return;

    const userCode = await vscode.window.showInputBox({
      prompt: 'Matrícula/Código do Colaborador (userCode / colleagueId)',
      value: username,
      validateInput: v => (v ? null : 'Código do colaborador é obrigatório')
    });
    if (!userCode) return;

    const server: FluigServer = {
      id: Buffer.from(`${baseUrl}_${companyIdStr}_${Date.now()}`).toString('base64'),
      name,
      baseUrl: baseUrl.replace(/\/$/, ''),
      companyId: parseInt(companyIdStr),
      username,
      password,
      userCode
    };

    await this.saveServer(server);
    vscode.window.showInformationMessage(`Servidor Fluig '${name}' cadastrado com sucesso!`);
    return server;
  }

  public async promptSelectServer(): Promise<FluigServer | undefined> {
    const servers = this.getServers();
    if (servers.length === 0) {
      const add = await vscode.window.showWarningMessage('Nenhum servidor Fluig cadastrado.', 'Adicionar Servidor');
      if (add === 'Adicionar Servidor') {
        return this.promptAddServer();
      }
      return undefined;
    }

    const activeId = this.getActiveServerId();
    const items = servers.map(s => ({
      label: s.name,
      description: `${s.baseUrl} (Empresa: ${s.companyId})`,
      detail: s.id === activeId ? '★ Ativo' : '',
      server: s
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Selecione o servidor Fluig ativo'
    });

    if (picked) {
      await this.setActiveServer(picked.server.id);
      vscode.window.showInformationMessage(`Servidor ativo definido: ${picked.server.name}`);
      return picked.server;
    }
    return undefined;
  }
}

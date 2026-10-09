import * as vscode from 'vscode';
import { ServerService } from '../services/ServerService';
import { WorkflowSoapService } from '../services/WorkflowSoapService';
import { ProcessItemSummary } from '../models/Process';

export class ProcessTreeItem extends vscode.TreeItem {
  constructor(public readonly process: ProcessItemSummary) {
    super(process.processId, vscode.TreeItemCollapsibleState.None);
    const versionText = (process.version && process.version > 0) ? `v${process.version}` : 'v...';
    const statusText = process.active === false ? ' (Inativo)' : '';
    this.description = `${versionText} - ${process.processDescription || ''}${statusText}`;
    this.tooltip = `ID: ${process.processId}\nDescrição: ${process.processDescription}\nVersão: ${(process.version && process.version > 0) ? process.version : 'Consultando servidor...'}\nStatus: ${process.active === false ? 'Inativo' : 'Ativo'}`;
    this.iconPath = new vscode.ThemeIcon(process.active === false ? 'circle-slash' : 'git-pull-request');
    this.contextValue = 'processItem';
  }
}

export class ProcessTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private cachedProcesses: ProcessItemSummary[] = [];
  private isLoading = false;
  private isResolvingVersions = false;

  constructor(private serverService: ServerService) {}

  public refresh(clearCache = false): void {
    if (clearCache) {
      const activeServer = this.serverService.getActiveServer();
      if (activeServer) {
        WorkflowSoapService.clearCache(activeServer);
      }
    }
    this.cachedProcesses = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const activeServer = this.serverService.getActiveServer();
    if (!activeServer) {
      const emptyItem = new vscode.TreeItem('Nenhum servidor ativo selecionado', vscode.TreeItemCollapsibleState.None);
      emptyItem.description = 'Clique para selecionar';
      emptyItem.iconPath = new vscode.ThemeIcon('info');
      emptyItem.command = {
        command: 'fluigWorkflow.selectServer',
        title: 'Selecionar Servidor Ativo'
      };
      return [emptyItem];
    }

    if (this.cachedProcesses.length > 0) {
      return this.cachedProcesses.map(p => new ProcessTreeItem(p));
    }

    try {
      this.isLoading = true;
      const soapService = new WorkflowSoapService(activeServer);
      this.cachedProcesses = await soapService.getAllProcesses();
      this.isLoading = false;

      if (this.cachedProcesses.length === 0) {
        const noProcessesItem = new vscode.TreeItem('Nenhum processo encontrado no servidor', vscode.TreeItemCollapsibleState.None);
        noProcessesItem.iconPath = new vscode.ThemeIcon('info');
        return [noProcessesItem];
      }

      this.resolvePendingVersions(soapService, activeServer);

      return this.cachedProcesses.map(p => new ProcessTreeItem(p));
    } catch (error: any) {
      this.isLoading = false;
      const errorItem = new vscode.TreeItem('Erro ao carregar processos', vscode.TreeItemCollapsibleState.None);
      errorItem.description = error.message || String(error);
      errorItem.iconPath = new vscode.ThemeIcon('error');
      errorItem.tooltip = `Falha na comunicação com ${activeServer.baseUrl}: ${error.message || error}`;
      return [errorItem];
    }
  }

  private resolvePendingVersions(soapService: WorkflowSoapService, server: any): void {
    if (this.isResolvingVersions) {
      return;
    }

    const pending = this.cachedProcesses.filter(p => !p.version || p.version === 0);
    if (pending.length === 0) {
      return;
    }

    this.isResolvingVersions = true;

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Fluig: Consultando versões dos processos...'
      },
      async () => {
        const pendingIds = pending.map(p => p.processId);
        await soapService.getProcessVersionsBatch(
          pendingIds,
          25,
          () => {
            for (const p of this.cachedProcesses) {
              const cachedVer = WorkflowSoapService.getCachedVersion(server, p.processId);
              if (cachedVer !== undefined && cachedVer > 0) {
                p.version = cachedVer;
              }
            }
            this._onDidChangeTreeData.fire();
          }
        );
      }
    ).then(
      () => {
        this.isResolvingVersions = false;
        for (const p of this.cachedProcesses) {
          const cachedVer = WorkflowSoapService.getCachedVersion(server, p.processId);
          if (cachedVer !== undefined && cachedVer > 0) {
            p.version = cachedVer;
          }
        }
        this._onDidChangeTreeData.fire();
      },
      () => {
        this.isResolvingVersions = false;
      }
    );
  }
}

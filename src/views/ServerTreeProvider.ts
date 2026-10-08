import * as vscode from 'vscode';
import { ServerService } from '../services/ServerService';
import { FluigServer } from '../models/Server';

export class ServerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly server: FluigServer,
    public readonly isActive: boolean
  ) {
    super(server.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${server.baseUrl} (Empresa: ${server.companyId})`;
    this.tooltip = `Usuário: ${server.username} | ${server.baseUrl}`;
    this.iconPath = new vscode.ThemeIcon(isActive ? 'check' : 'server');
    this.contextValue = 'serverItem';
  }
}

export class ServerTreeProvider implements vscode.TreeDataProvider<ServerTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ServerTreeItem | undefined | void> = new vscode.EventEmitter<ServerTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ServerTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private serverService: ServerService) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ServerTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ServerTreeItem): Thenable<ServerTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }
    const servers = this.serverService.getServers();
    const activeId = this.serverService.getActiveServerId();

    return Promise.resolve(
      servers.map(s => new ServerTreeItem(s, s.id === activeId))
    );
  }
}

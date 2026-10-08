import * as vscode from 'vscode';
import { DiagramViewerService } from '../services/DiagramViewerService';

export class ProcessCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'fluigWorkflow.diagramEditor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ProcessCustomEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      ProcessCustomEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
          enableFindWidget: false
        },
        supportsMultipleEditorsPerDocument: false
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    await DiagramViewerService.attachWebview(webviewPanel, document.uri, document);
  }
}

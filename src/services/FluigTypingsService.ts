import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class FluigTypingsService {
  private static extensionUri: vscode.Uri;

  public static initialize(context: vscode.ExtensionContext): void {
    this.extensionUri = context.extensionUri;
  }

  /**
   * Garante a instalacao das tipagens fluig.d.ts e jsconfig.json no workspace
   */
  public static async ensureTypings(targetFolder?: string, notify = false): Promise<boolean> {
    try {
      let scriptsDir: string | undefined = targetFolder;

      if (!scriptsDir) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          if (notify) {
            vscode.window.showWarningMessage('Abra uma pasta no VS Code para configurar o IntelliSense do Fluig.');
          }
          return false;
        }

        const root = workspaceFolder.uri.fsPath;
        const candidateScripts = path.join(root, 'workflow', 'scripts');
        if (fs.existsSync(candidateScripts)) {
          scriptsDir = candidateScripts;
        } else if (fs.existsSync(path.join(root, 'workflow'))) {
          scriptsDir = candidateScripts;
          fs.mkdirSync(scriptsDir, { recursive: true });
        } else {
          scriptsDir = root;
        }
      }

      if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, { recursive: true });
      }

      // Origem do arquivo de definicoes
      const sourceTypingsPath = path.join(this.extensionUri.fsPath, 'resources', 'typings', 'fluig.d.ts');
      if (!fs.existsSync(sourceTypingsPath)) {
        console.warn('Arquivo fonte de tipagens fluig.d.ts nao encontrado em:', sourceTypingsPath);
        return false;
      }

      const destTypingsPath = path.join(scriptsDir, 'fluig.d.ts');
      const sourceContent = fs.readFileSync(sourceTypingsPath, 'utf-8');

      let updatedTypings = false;
      if (!fs.existsSync(destTypingsPath) || fs.readFileSync(destTypingsPath, 'utf-8') !== sourceContent) {
        fs.writeFileSync(destTypingsPath, sourceContent, 'utf-8');
        updatedTypings = true;
      }

      // Garante jsconfig.json para reconhecimento imediato pelo VS Code
      const jsconfigPath = path.join(scriptsDir, 'jsconfig.json');
      let createdJsConfig = false;
      if (!fs.existsSync(jsconfigPath)) {
        const jsconfigContent = JSON.stringify(
          {
            compilerOptions: {
              target: 'ES6',
              module: 'commonjs',
              allowJs: true,
              checkJs: false,
              noEmit: true
            },
            include: [
              '**/*.js',
              'fluig.d.ts'
            ]
          },
          null,
          2
        );
        fs.writeFileSync(jsconfigPath, jsconfigContent, 'utf-8');
        createdJsConfig = true;
      }

      if (notify) {
        vscode.window.showInformationMessage(
          `IntelliSense Fluig configurado em: ${path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', scriptsDir)}`
        );
      }

      return updatedTypings || createdJsConfig;
    } catch (err: any) {
      console.error('Erro ao configurar tipagens Fluig:', err);
      if (notify) {
        vscode.window.showErrorMessage(`Falha ao configurar tipagens Fluig: ${err.message || err}`);
      }
      return false;
    }
  }
}

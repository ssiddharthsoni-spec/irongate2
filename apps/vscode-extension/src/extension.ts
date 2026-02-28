/**
 * Iron Gate VS Code Extension — Priority 8
 *
 * Protects sensitive data in AI coding assistants (Copilot, Cursor, etc.)
 * Uses the same shared detection core as the Chrome extension.
 * Sends events to the same /v1/events/batch API endpoint.
 */

import * as vscode from 'vscode';
import { Scanner } from './scanner';
import { ApiClient } from './api-client';
import { SidebarProvider } from './sidebar-provider';
import { LmInterceptor } from './lm-interceptor';

let scanner: Scanner;
let apiClient: ApiClient;
let heartbeatInterval: NodeJS.Timeout | undefined;
let activeDecorationType: vscode.TextEditorDecorationType | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('irongate');
  const enabled = config.get<boolean>('enabled', true);

  if (!enabled) {
    vscode.window.showInformationMessage('Iron Gate is disabled. Enable in settings to activate.');
    return;
  }

  // Initialize core modules
  scanner = new Scanner();
  apiClient = new ApiClient({
    apiKey: config.get<string>('apiKey', ''),
    firmId: config.get<string>('firmId', ''),
    baseUrl: config.get<string>('apiBaseUrl', 'https://irongate-api.onrender.com'),
  });

  // Register sidebar webview
  const sidebarProvider = new SidebarProvider(context.extensionUri, scanner, apiClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('irongate.sidebar', sidebarProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('irongate.scanFile', () => scanCurrentFile()),
    vscode.commands.registerCommand('irongate.toggleMode', () => toggleMode()),
    vscode.commands.registerCommand('irongate.showSidebar', () => {
      vscode.commands.executeCommand('irongate.sidebar.focus');
    }),
    vscode.commands.registerCommand('irongate.configure', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'irongate');
    })
  );

  // Register Language Model API middleware (Priority 8.2)
  const lmInterceptor = new LmInterceptor(scanner, apiClient);
  context.subscriptions.push(lmInterceptor);

  // Start heartbeat (every 5 minutes)
  heartbeatInterval = setInterval(() => {
    apiClient.sendHeartbeat('irongate-vscode', config.get<string>('mode', 'audit'));
  }, 5 * 60 * 1000);

  // Initial heartbeat
  apiClient.sendHeartbeat('irongate-vscode', config.get<string>('mode', 'audit'));

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('irongate')) {
        const newConfig = vscode.workspace.getConfiguration('irongate');
        apiClient.updateConfig({
          apiKey: newConfig.get<string>('apiKey', ''),
          firmId: newConfig.get<string>('firmId', ''),
          baseUrl: newConfig.get<string>('apiBaseUrl', 'https://irongate-api.onrender.com'),
        });
      }
    })
  );

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(shield) Iron Gate';
  statusBar.tooltip = 'Iron Gate AI Data Protection';
  statusBar.command = 'irongate.showSidebar';
  statusBar.show();
  context.subscriptions.push(statusBar);

  vscode.window.showInformationMessage('Iron Gate activated — AI interactions are now protected.');
}

export function deactivate(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
}

async function scanCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No file is currently open.');
    return;
  }

  const text = editor.document.getText();
  const result = scanner.scan(text);

  if (result.entities.length === 0) {
    vscode.window.showInformationMessage('No sensitive entities detected in this file.');
    return;
  }

  // Dispose previous decorations to prevent leak
  if (activeDecorationType) {
    activeDecorationType.dispose();
  }
  activeDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 100, 100, 0.2)',
    border: '1px solid rgba(255, 100, 100, 0.4)',
    borderRadius: '3px',
  });

  const decorations = result.entities.map((entity) => {
    const startPos = editor.document.positionAt(entity.start);
    const endPos = editor.document.positionAt(entity.end);
    return {
      range: new vscode.Range(startPos, endPos),
      hoverMessage: `**${entity.type}** (confidence: ${Math.round(entity.confidence * 100)}%)`,
    };
  });

  editor.setDecorations(activeDecorationType, decorations);

  vscode.window.showInformationMessage(
    `Iron Gate: Found ${result.entities.length} sensitive entities (Score: ${result.score}/${result.level})`
  );

  // Send event to API
  apiClient.sendEvent({
    aiToolId: 'vscode-scan',
    promptHash: await hashText(text),
    promptLength: text.length,
    sensitivityScore: result.score,
    sensitivityLevel: result.level,
    entities: result.entities.map((e) => ({
      type: e.type,
      length: e.text.length,
      confidence: e.confidence,
    })),
    action: 'audit',
    captureMethod: 'manual-scan',
  });
}

function toggleMode(): void {
  const config = vscode.workspace.getConfiguration('irongate');
  const currentMode = config.get<string>('mode', 'audit');
  const newMode = currentMode === 'audit' ? 'proxy' : 'audit';
  config.update('mode', newMode, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Iron Gate mode changed to: ${newMode}`);
}

async function hashText(text: string): Promise<string> {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

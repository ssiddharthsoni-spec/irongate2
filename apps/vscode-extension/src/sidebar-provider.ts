/**
 * VS Code Sidebar Webview — Priority 8.4
 *
 * Activity bar panel (shield icon) showing detection activity,
 * entity counts, risk score, and mode toggle.
 */

import * as vscode from 'vscode';
import { Scanner } from './scanner';
import { ApiClient } from './api-client';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private scanner: Scanner;
  private apiClient: ApiClient;

  constructor(
    private readonly extensionUri: vscode.Uri,
    scanner: Scanner,
    apiClient: ApiClient
  ) {
    this.scanner = scanner;
    this.apiClient = apiClient;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'scanFile':
          vscode.commands.executeCommand('irongate.scanFile');
          break;
        case 'toggleMode':
          vscode.commands.executeCommand('irongate.toggleMode');
          break;
        case 'openSettings':
          vscode.commands.executeCommand('irongate.configure');
          break;
      }
    });
  }

  private getHtml(): string {
    const config = vscode.workspace.getConfiguration('irongate');
    const mode = config.get<string>('mode', 'audit');
    const firmId = config.get<string>('firmId', '');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 12px;
      margin: 0;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .header h2 { margin: 0; font-size: 14px; }
    .shield { font-size: 20px; }
    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      margin-bottom: 16px;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #22c55e;
    }
    .section {
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 12px;
    }
    .stat-value { font-weight: 600; }
    .mode-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .mode-audit { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .mode-proxy { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
    button {
      width: 100%;
      padding: 8px;
      margin-bottom: 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .empty {
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="shield">🛡️</span>
    <h2>Iron Gate</h2>
  </div>

  <div class="status">
    <div class="dot"></div>
    <span>Active — AI interactions protected</span>
  </div>

  <div class="section">
    <div class="section-title">Configuration</div>
    <div class="stat">
      <span>Mode</span>
      <span class="mode-badge mode-${mode}">${mode}</span>
    </div>
    <div class="stat">
      <span>Firm</span>
      <span class="stat-value">${firmId || 'Not configured'}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Quick Actions</div>
    <button onclick="scanFile()">Scan Current File</button>
    <button class="secondary" onclick="toggleMode()">Toggle Mode</button>
    <button class="secondary" onclick="openSettings()">Settings</button>
  </div>

  <div class="section">
    <div class="section-title">Recent Activity</div>
    <div class="empty">
      <p>No detections yet this session.</p>
      <p>Open an AI assistant to start monitoring.</p>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function scanFile() { vscode.postMessage({ type: 'scanFile' }); }
    function toggleMode() { vscode.postMessage({ type: 'toggleMode' }); }
    function openSettings() { vscode.postMessage({ type: 'openSettings' }); }
  </script>
</body>
</html>`;
  }
}

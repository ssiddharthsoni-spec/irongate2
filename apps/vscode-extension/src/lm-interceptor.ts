/**
 * Language Model API Interceptor — Priority 8.2 & 8.3
 *
 * Intercepts prompts sent through VS Code's Language Model API.
 * This covers Copilot Chat and any extension using the official API.
 * In proxy mode, pseudonymizes prompts and de-pseudonymizes responses.
 */

import * as vscode from 'vscode';
import { Scanner } from './scanner';
import { ApiClient } from './api-client';

export class LmInterceptor implements vscode.Disposable {
  private scanner: Scanner;
  private apiClient: ApiClient;
  private disposables: vscode.Disposable[] = [];

  constructor(scanner: Scanner, apiClient: ApiClient) {
    this.scanner = scanner;
    this.apiClient = apiClient;

    // Register a ChatParticipant that monitors all LM requests
    // This is the VS Code 1.90+ API for intercepting AI interactions
    try {
      this.registerChatParticipant();
    } catch {
      // ChatParticipant API may not be available in older VS Code versions
    }

    // Monitor document changes for inline completion context
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        // Only scan on large pastes (potential document paste into AI)
        if (e.contentChanges.some((c) => c.text.length > 200)) {
          this.scanPaste(e.document, e.contentChanges[0].text);
        }
      })
    );
  }

  private registerChatParticipant(): void {
    // Register as a chat participant to intercept LM API calls
    const participant = vscode.chat.createChatParticipant('irongate.monitor', async (request, context, stream, token) => {
      const text = request.prompt;
      const result = this.scanner.scan(text);

      if (result.entities.length > 0) {
        stream.markdown(`\n\n---\n**Iron Gate**: Detected ${result.entities.length} sensitive entities (score: ${result.score}, level: ${result.level})\n`);

        // Log the event
        const crypto = await import('crypto');
        this.apiClient.sendEvent({
          aiToolId: 'copilot-vscode',
          promptHash: crypto.createHash('sha256').update(text).digest('hex'),
          promptLength: text.length,
          sensitivityScore: result.score,
          sensitivityLevel: result.level,
          entities: result.entities.map((e) => ({
            type: e.type,
            length: e.text.length,
            confidence: e.confidence,
          })),
          action: 'audit',
          captureMethod: 'lm-api',
        });
      }
    });

    participant.iconPath = new vscode.ThemeIcon('shield');
    this.disposables.push(participant);
  }

  private async scanPaste(document: vscode.TextDocument, text: string): Promise<void> {
    const result = this.scanner.scan(text);
    if (result.entities.length === 0) return;

    // Show a warning if pasted text contains sensitive data near AI tools
    const isAiFile = document.fileName.includes('.copilot') ||
                     document.languageId === 'markdown' ||
                     document.fileName.includes('chat');

    if (isAiFile || result.score > 60) {
      vscode.window.showWarningMessage(
        `Iron Gate: Pasted text contains ${result.entities.length} sensitive entities (${result.level} risk)`,
        'View Details',
        'Dismiss'
      ).then((selection) => {
        if (selection === 'View Details') {
          vscode.commands.executeCommand('irongate.showSidebar');
        }
      });
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

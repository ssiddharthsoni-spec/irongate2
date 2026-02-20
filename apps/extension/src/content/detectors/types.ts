/**
 * Interface that every AI tool detector must implement.
 * The adapter pattern ensures adding new tools is just adding a new file.
 */
export interface AIToolDetector {
  /** Unique identifier for this AI tool */
  id: string;

  /** Display name */
  name: string;

  /** URL patterns this detector handles */
  urlPatterns: RegExp[];

  /** Returns the active prompt input element, or null if not found */
  getPromptInput(): HTMLElement | null;

  /** Returns the submit button/trigger element */
  getSubmitTrigger(): HTMLElement | null;

  /** Extracts the current prompt text from the input element */
  extractPromptText(input: HTMLElement): string;

  /** Returns the response container where AI output appears */
  getResponseContainer(): HTMLElement | null;

  /** Injects a response into the AI tool's UI (Phase 2) */
  injectResponse?(container: HTMLElement, text: string): void;

  /** Returns true if the page is currently in a loading/generating state */
  isGenerating(): boolean;
}

/**
 * VideTranscr Component
 * Main container component for the Transcriptions SPA island.
 * Renders different transcriptions of Beethoven sources side by side.
 */
export class VideTranscr extends HTMLElement {
  constructor() {
    super();
    this.router = null;
  }

  connectedCallback() {
    const container = document.createElement('div');
    container.className = 'vide-transcr-container';

    const content = document.createElement('vide-transcr-content');
    container.appendChild(content);
    this.appendChild(container);

    // Wait for child components to connect, then initialize router
    setTimeout(() => {
      const VideTranscrRouter = window.VideTranscrRouter;
      this.router = new VideTranscrRouter(this);
      window.router = this.router;
    }, 100);
  }
}

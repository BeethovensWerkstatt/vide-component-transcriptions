/**
 * VideTranscr - Transcriptions Web Component
 *
 * A reusable web component for rendering different transcriptions side by side.
 * Single-page application (SPA) with History API routing.
 *
 * Requirements: Web server (does not work with file:// protocol)
 *
 * Usage:
 *   <link rel="stylesheet" href="vide-component-transcriptions/dist/vide-transcr.css">
 *   <vide-transcr></vide-transcr>
 *   <script type="module" src="vide-component-transcriptions/dist/index.js"></script>
 */

import { VideTranscr } from './vide-transcr.js'
import { VideTranscrContent } from './vide-transcr-content.js'
import { VideTranscrRouter } from './vide-transcr-router.js'
import { VideTranscrPanels } from './vide-transcr-panels.js'

// Load OpenSeadragon as a plain (non-module) script so it attaches to window.OpenSeadragon.
// Using a dynamic script tag keeps the import order deterministic for ES modules.
if (!window.OpenSeadragon) {
  const script = document.createElement('script')
  script.src = new URL('./vendor/openseadragon/openseadragon.min.js', import.meta.url).href
  document.head.appendChild(script)
}

// Make VideTranscrRouter globally accessible for programmatic navigation
window.VideTranscrRouter = VideTranscrRouter

// Register Custom Elements
// Only register if not already defined (prevents errors on hot reload)
if (!customElements.get('vide-transcr')) {
  customElements.define('vide-transcr', VideTranscr)
}
if (!customElements.get('vide-transcr-content')) {
  customElements.define('vide-transcr-content', VideTranscrContent)
}
if (!customElements.get('vide-transcr-panels')) {
  customElements.define('vide-transcr-panels', VideTranscrPanels)
}

console.log('[VideTranscr] Component loaded successfully')

// Export for programmatic usage
export { VideTranscr, VideTranscrContent, VideTranscrPanels, VideTranscrRouter }

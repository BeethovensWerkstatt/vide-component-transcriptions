/**
 * VideTranscr Component
 * Main container component for the Transcriptions SPA island.
 * Renders different transcriptions of Beethoven sources side by side.
 */
export class VideTranscr extends HTMLElement {
  constructor () {
    super()
    this.router = null
    this._config = null
    this._initialized = false
  }

  get config () {
    return this._config
  }

  set config (value) {
    this._config = value
  }

  connectedCallback () {
    if (this._initialized) return
    this._initialized = true

    const container = document.createElement('div')
    container.className = 'vide-transcr-container'

    const content = document.createElement('vide-transcr-content')
    container.appendChild(content)
    this.appendChild(container)

    this.initializeRouter()
  }

  async initializeRouter () {
    try {
      const config = await this.resolveConfig()
      const VideTranscrRouter = window.VideTranscrRouter
      this.router = new VideTranscrRouter(this, config)
      window.router = this.router
    } catch (err) {
      console.error('[VideTranscr] Failed to initialize router', err)
    }
  }

  async resolveConfig () {
    const config = {}

    const configSrc = this.getAttribute('config-src')
    if (configSrc) {
      try {
        const response = await fetch(configSrc)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`)
        }

        const remoteConfig = await response.json()
        this.mergeConfig(config, remoteConfig)
      } catch (err) {
        console.error(`[VideTranscr] Failed to load config from ${configSrc}`, err)
      }
    }

    const inlineConfig = this.getAttribute('config')
    if (inlineConfig) {
      try {
        this.mergeConfig(config, JSON.parse(inlineConfig))
      } catch (err) {
        console.error('[VideTranscr] Invalid config attribute JSON', err)
      }
    }

    const apiBase = this.getAttribute('api-base')
    if (apiBase) {
      config.apiBase = apiBase
    }

    const documents = this.getAttribute('documents')
    if (documents) {
      try {
        const parsedDocuments = JSON.parse(documents)
        this.mergeConfig(config, { documents: parsedDocuments })
      } catch (err) {
        console.error('[VideTranscr] Invalid documents attribute JSON', err)
      }
    }

    if (this._config && typeof this._config === 'object' && !Array.isArray(this._config)) {
      this.mergeConfig(config, this._config)
    }

    return config
  }

  mergeConfig (target, source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return target

    if (source.apiBase) {
      target.apiBase = source.apiBase
    }

    if (source.documents && typeof source.documents === 'object' && !Array.isArray(source.documents)) {
      target.documents = {
        ...(target.documents || {}),
        ...source.documents
      }
    }

    return target
  }
}

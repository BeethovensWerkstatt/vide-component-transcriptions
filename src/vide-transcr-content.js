/**
 * VideTranscrContent Component
 * Content container for the Transcriptions viewer.
 * Holds the synoptic transcription panels.
 */
export class VideTranscrContent extends HTMLElement {
  connectedCallback () {
    const wrapper = document.createElement('div')
    wrapper.className = 'transcr-content-wrapper'
    this.appendChild(wrapper)
  }

  /**
   * Set the HTML content of the view
   * @param {string} html - HTML content to display
   */
  setContent (html) {
    const wrapper = this.querySelector('.transcr-content-wrapper')
    if (wrapper) {
      wrapper.innerHTML = html
    }
  }

  /**
   * Get the content wrapper element
   * @returns {HTMLElement}
   */
  getWrapper () {
    return this.querySelector('.transcr-content-wrapper')
  }
}

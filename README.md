# vide-component-transcriptions
A VideApp component for rendering different transcriptions side by side. 

## Configuration

The root component accepts configuration in three ways:

- `el.config = { apiBase, documents }` before the element is attached
- `<vide-transcr api-base="..." documents='{"NK":"/overview.json"}'></vide-transcr>`
- `<vide-transcr config-src="/vide-component-transcriptions/config.json"></vide-transcr>`

`documents` may use absolute URLs or paths relative to `apiBase`.

The facsimile component follows the same external configuration contract (`api-base` + `documents`) for consistency across both web components.

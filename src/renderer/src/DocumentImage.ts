import { Image } from '@tiptap/extension-image'

/** Resolve display URLs without changing the Markdown stored in image attrs. */
export function documentImage(revision: number) {
  return Image.extend({
    addNodeView() {
      return ({ node }) => {
        const image = document.createElement('img')
        let current = node
        let request = 0
        const render = async () => {
          const id = ++request
          const { src, alt, title } = current.attrs
          image.alt = alt ?? ''
          image.title = title ?? ''
          image.removeAttribute('src')
          const url =
            /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,/i.test(src)
              ? src
              : await window.hibi
                  .readDocumentImage(src, revision)
                  .catch(() => null)
          if (id !== request) return
          if (url) image.src = url
          else
            image.title =
              'image unavailable — check its path; save the note before using a relative path'
        }
        void render()
        return {
          dom: image,
          update(next) {
            if (next.type !== current.type) return false
            const changed =
              JSON.stringify(next.attrs) !== JSON.stringify(current.attrs)
            current = next
            if (changed) void render()
            return true
          },
          ignoreMutation: () => true,
          destroy() {
            request += 1
          },
        }
      }
    },
  }).configure({ allowBase64: true })
}

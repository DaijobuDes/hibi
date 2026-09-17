import { Image } from '@tiptap/extension-image'
import { attachmentMarkdown } from '../../shared/media'

/** Resolve display URLs without changing the Markdown stored in image attrs. */
export function documentImage(revision: number) {
  return Image.extend({
    renderMarkdown: (node) =>
      attachmentMarkdown([
        {
          url: node.attrs?.src ?? '',
          alt: node.attrs?.alt ?? '',
          title: node.attrs?.title ?? '',
        },
      ]),
    addNodeView() {
      return ({ node }) => {
        const container = document.createElement('span')
        container.className = 'document-media'
        container.contentEditable = 'false'
        let media: HTMLImageElement | HTMLVideoElement =
          document.createElement('img')
        container.append(media)
        let current = node
        let request = 0
        const render = async () => {
          const id = ++request
          const { src, alt, title } = current.attrs
          media.removeAttribute('src')
          const result =
            /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,/i.test(src)
              ? { url: src, kind: 'image' }
              : await window.hibi
                  .readDocumentMedia(src, revision)
                  .catch(() => null)
          if (id !== request) return
          media = document.createElement(
            result?.kind === 'video' ? 'video' : 'img',
          )
          media.title = title ?? ''
          if (media instanceof HTMLVideoElement) {
            media.controls = true
            media.preload = 'metadata'
            media.setAttribute('aria-label', alt || 'video attachment')
          } else media.alt = alt ?? ''
          container.replaceChildren(media)
          if (result) media.src = result.url
          else
            media.title =
              'media unavailable — check its path; save the note before using a relative path'
        }
        void render()
        return {
          dom: container,
          stopEvent: (event) =>
            event.target instanceof Element && !!event.target.closest('video'),
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
            if (media instanceof HTMLVideoElement) media.pause()
          },
        }
      }
    },
  }).configure({ allowBase64: true })
}

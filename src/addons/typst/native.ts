import type { NativeAddon } from '../api'
import { compileTypst, stopCompiler } from './compiler'

export default {
  id: 'typst',
  stop: stopCompiler,
  queries: { compile: (input, context) => compileTypst(input, context) },
  methods: {
    create: (_input, context) =>
      context.document.create(
        'untitled.typ',
        '= untitled\n\nstart writing here.\n',
      ),
    async pdf(input, context) {
      const result = await compileTypst(
        { ...(input as object), pdf: true },
        context,
      )
      if (!result.pdf)
        throw new Error(
          result.diagnostics.map((error) => error.message).join('\n') ||
            'typst compilation failed.',
        )
      return context.exportFile(
        result.pdf,
        context.document.get().name.replace(/\.[^.]+$/, '') + '.pdf',
        'pdf',
      )
    },
  },
} satisfies NativeAddon

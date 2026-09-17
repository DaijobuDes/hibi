import type { Plugin } from 'vite'

export function startupBundle(): Plugin {
  return {
    name: 'startup-bundle-report',
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: 'startup-bundle.json',
        source: JSON.stringify(
          Object.values(bundle).flatMap((file) =>
            file.type === 'chunk'
              ? [
                  {
                    file: file.fileName,
                    entry: file.isEntry,
                    bytes: Buffer.byteLength(file.code),
                    imports: file.imports,
                    dynamicImports: file.dynamicImports,
                    modules: Object.keys(file.modules).map((name) =>
                      name.replace(`${process.cwd()}/`, ''),
                    ),
                  },
                ]
              : [],
          ),
        ),
      })
    },
  }
}

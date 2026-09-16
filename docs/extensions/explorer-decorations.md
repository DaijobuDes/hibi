# explorer decorations

extensions register workspace badges and colors through `context.workspace.registerDecorations({ id, provide })`. this keeps source-control logic in its addon while the shared sidebar renders the same rows, selection, menus, and accessibility metadata.

```typescript
const remove = context.workspace.registerDecorations({
  id: 'status',
  async provide(workspace) {
    const result = await context.native.query<{
      workspaceId: string
      files: { path: string }[]
    } | null>('status')
    if (!result || result.workspaceId !== workspace.id) return []
    return result.files.map(file => ({
      path: file.path,
      badge: 'M',
      label: 'modified on disk',
      color: 'status-warning',
    }))
  },
})
```

`path` is workspace-relative, with `/` separators. an empty path decorates the workspace heading. `label` supplies the tooltip and accessible description; optional `badge` supplies a short visible marker and `color` names a semantic theme token. colors apply to names/icons, including selected rows. badges do not alter accessible file names or replace unsaved-edit dots. providers return a full replacement set and explicitly include any parent-folder decorations. if multiple providers decorate one path, the last registered provider wins.

the host debounces workspace changes and refreshes on window focus. each provider runs one request at a time; results from older workspace generations or disposed providers are discarded. `WorkspaceState.id` is an opaque folder identity supplied by current hosts; do not compare folder display names to identify workspaces. unregistering or stopping the addon removes its decorations. status updates do not expand collapsed folders or move keyboard focus.

## background native reads

trusted built-in native addons may export optional `queries` alongside `methods`. `context.native.query(method, input?)` only calls explicitly exported queries from the same enabled addon. queries bypass the file-operation lock and must not mutate documents/repositories or show dialogs. mutations continue to use `native.invoke`. sideloaded renderer extensions cannot add native code.

capture `context.workspace.id()` before starting a query and return it with the result so callers can check folder identity after asynchronous work. queries may overlap saves or folder changes: do not assume the current workspace stays fixed for their entire duration.

see [workspace types](../reference/workspace-api.md), [addon api](../reference/addon-api.md), and [sidebar api](../reference/sidebar-api.md).

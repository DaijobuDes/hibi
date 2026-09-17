export type GitFile = {
  path: string
  original?: string
  index: string
  worktree: string
}
export type GitState = {
  branch: string
  branches: string[]
  files: GitFile[]
  ahead: number
  behind: number
}
export type GitStatus = { state: GitState | null; notice: string }

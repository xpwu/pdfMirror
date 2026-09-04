
import fs from "node:fs"
import path from "node:path"

import { app } from "electron"
import { is } from "@electron-toolkit/utils"

import { WorkspaceConfig, WorkspaceState } from "../../shared/types"


// 工作区的数据库文件。
//
// 这是本项目的「数据库」：人可读的 JSON 格式，
// 与服务的配置（端口、窗口尺寸等）完全分离。
const DB_FILE = "workspaces.json"


// DBPath 数据库文件的绝对路径。
//
// 区分两类数据：
//   应用配置（工作区列表、偏好）  → 应用数据目录
//   业务数据（原文 / 译文 / 中间记忆） → 用户指定的工作区目录
// 业务数据不进应用目录，否则备份与迁移会很麻烦。
//
// 开发模式下改用项目根下的 .dev-data/，
// 避免测试数据散落到系统目录，删掉项目即可清理干净。
export function DBPath(): string {
  if (is.dev) {
    return path.join(process.cwd(), ".dev-data", DB_FILE)
  }

  return path.join(app.getPath("userData"), DB_FILE)
}


// LoadWorkspaces 从数据库文件载入工作区配置。
//
// 文件不存在时返回空列表，不创建文件 ——
// 工作区由用户手动在数据库文件中添加。
export function LoadWorkspaces(): WorkspaceConfig[] {
  const p = DBPath()

  if (!fs.existsSync(p)) {
    return []
  }

  const content = fs.readFileSync(p, "utf-8")

  return JSON.parse(content) as WorkspaceConfig[]
}


// SaveWorkspaces 把工作区配置写回数据库文件。
//
// .dev-data 属于应用数据目录而非工作区，故自动创建。
// 工作区目录本身仍遵循铁律 L2，绝不自动创建。
export function SaveWorkspaces(list: WorkspaceConfig[]): void {
  const p = DBPath()

  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(list, null, 2), "utf-8")
}


// Validate 懒校验单个工作区。
//
// 只在「点击工作区」时调用，不在启动时批量检查。
// 中文根缺失时只做标记，绝不创建（铁律 L2）。
export function Validate(cfg: WorkspaceConfig): WorkspaceState {
  const state = new WorkspaceState()

  state.Config = cfg
  state.Name = WorkspaceName(cfg.SourceRoot)
  state.SourceExists = fs.existsSync(cfg.SourceRoot)
  state.TranslatedExists = fs.existsSync(cfg.TranslatedRoot)

  return state
}


// WorkspaceName 由英文根路径推导显示名。
//
// 取末两段倒序，避免完整路径过长。
// 完整路径仍保留在 Config.SourceRoot 中，UI 可在 hover 时展示。
export function WorkspaceName(sourceRoot: string): string {
  const parts = path.resolve(sourceRoot)
    .split(path.sep)
    .filter((p) => p !== "")

  return parts.slice(-2).reverse().join(" / ")
}

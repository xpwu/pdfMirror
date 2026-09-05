import fs from "node:fs"
import path from "node:path"

import { app } from "electron"
import { is } from "@electron-toolkit/utils"

import {
	WorkspaceConfig,
	WorkspaceState
} from "../../shared/types"


const DB_FILE = "workspaces.json"

// 中文根的默认后缀：/path/to/source -> /path/to/source_cn
const DEFAULT_CN_SUFFIX = "_cn"


// DBPath 数据库文件的绝对路径。
//
// 应用配置（工作区列表）放应用数据目录；
// 业务数据（原文 / 译文 / 图片）放用户指定的工作区目录。
// 开发模式下改用项目根下的 .dev-data/，避免污染系统目录。
export function DBPath(): string {
	if (is.dev) {
		return path.join(process.cwd(), ".dev-data", DB_FILE)
	}

	return path.join(app.getPath("userData"), DB_FILE)
}


// ResolveTranslatedRoot 求取中文根。
//
// 规则：配置优先；未配置时按默认规则推导 ——
// 去掉英文根结尾的斜杠后补 "_cn"。
//
// 只负责求路径，不检查是否存在。
// 存在性校验在 Validate 中做，两者职责分开：
// 前端需要拿到这个路径去展示「请在磁盘上创建 xxx」的提示。
export function ResolveTranslatedRoot(cfg: WorkspaceConfig): string {
	if (cfg.TranslatedRoot.trim() !== "") {
		return cfg.TranslatedRoot.trim()
	}

	// 去掉结尾的斜杠，否则会推导出 /path/to/source/_cn
	const src = cfg.SourceRoot.replace(/\/+$/, "")

	return src === "" ? "" : src + DEFAULT_CN_SUFFIX
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

	state.TranslatedRoot = ResolveTranslatedRoot(cfg)
	state.TranslatedExists =
		state.TranslatedRoot !== "" && fs.existsSync(state.TranslatedRoot)

	return state
}


// WorkspaceName 由英文根路径推导显示名。
//
// 取末两段倒序，避免完整路径过长。
export function WorkspaceName(sourceRoot: string): string {
	const parts = path
		.resolve(sourceRoot)
		.split(path.sep)
		.filter((p) => p !== "")

	return parts.slice(-2).reverse().join(" / ")
}

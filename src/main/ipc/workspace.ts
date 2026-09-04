import { ipcMain } from "electron"

import { CH } from "../../shared/channels"
import { IPCResult, TreeNode, WorkspaceState } from "../../shared/types"
import { PathGuard } from "../service/pathGuard"
import { ScanTree } from "../service/tree"
import { LoadWorkspaces, Validate } from "../service/workspace"


// Register 注册工作区相关的 IPC handler。
//
// handler 只做三件事：调 service、包成 IPCResult、返回。
// 业务逻辑一律留在 service 里，保持这里足够薄。
export function Register(guard: PathGuard): void {
	// 工作区列表（含中文根懒校验结果）
	ipcMain.handle(CH.WorkspaceList, (): IPCResult<WorkspaceState[]> => {
		const configs = LoadWorkspaces()

		guard.Load(configs)

		const states: WorkspaceState[] = []
		for (const cfg of configs) {
			states.push(Validate(cfg))
		}

		return [states, null]
	})

	// 英文根目录树
	//
	// 入参用 SourceRoot —— 它本身就是工作区的唯一 id。
	//
	// 注意：中文根缺失不影响返回。缺译文不等于不能看原文，
	// 此时树照常返回，只是 HasTranslated 全为 false。
	ipcMain.handle(
		CH.WorkspaceTree,
		(_event, sourceRoot: string): IPCResult<TreeNode[]> => {
			if (typeof sourceRoot !== "string" || sourceRoot === "") {
				return [[], "入参 SourceRoot 非法"]
			}

			const configs = LoadWorkspaces()
			guard.Load(configs)

			const cfg = configs.find((c) => c.SourceRoot === sourceRoot)
			if (cfg === undefined) {
				return [[], `工作区不存在: ${sourceRoot}`]
			}

			const nodes = ScanTree(cfg)
			if (nodes === null) {
				return [[], `英文根不存在: ${cfg.SourceRoot}`]
			}

			return [nodes, null]
		}
	)
}

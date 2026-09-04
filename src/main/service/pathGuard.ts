import fs from "node:fs"
import path from "node:path"

import { WorkspaceConfig } from "../../shared/types"


// PathGuard 是本项目的安全边界，铁律 L1 / L2 / L3 全部落在这里。
//
// L1 英文根目录只读：任何写入请求指向英文根，一律拒绝
// L2 中文根缺失只报错，绝不自动创建
// L3 只允许写入中文根目录下的子文件夹
//
// 所有跨进程的文件访问（无论读还是写）都必须先过这里。
export class PathGuard {
	private workspaces: WorkspaceConfig[] = []


	// Load 载入工作区配置。配置变更后需重新调用。
	Load(workspaces: WorkspaceConfig[]): void {
		this.workspaces = workspaces
	}


	// Check 校验绝对路径是否落在某个已配置的工作区内（英文根或中文根均可）。
	// 返回 null 表示通过，否则返回人类可读的错误原因。
	Check(absPath: string): string | null {
		if (absPath === "") {
			return "路径为空"
		}

		const norm = this.realpath(absPath)

		for (const ws of this.workspaces) {
			if (this.underRoot(norm, ws.SourceRoot)) return null
			if (this.underRoot(norm, ws.TranslatedRoot)) return null
		}

		return `路径不在任何已配置的工作区内: ${norm}`
	}


	// EnsureWritable 校验路径可写。
	//
	// 只有落在中文根下才允许写入；英文根一律拒绝（铁律 L1）。
	// 返回 null 表示通过。
	EnsureWritable(absPath: string): string | null {
		if (absPath === "") {
			return "路径为空"
		}

		const norm = this.realpath(absPath)

		for (const ws of this.workspaces) {
			if (this.underRoot(norm, ws.SourceRoot)) {
				return `英文根只读，禁止写入: ${norm}`
			}
			if (this.underRoot(norm, ws.TranslatedRoot)) {
				return null
			}
		}

		return `路径不在任何已配置的工作区内: ${norm}`
	}


	// realpath 解析真实路径，消除 ../ 与符号链接。
	//
	// 符号链接是目录穿越的经典绕过手段，必须解析后再比对。
	// 文件尚不存在时（比如准备新建译文）realpathSync 会抛错，
	// 此时退回规范化路径即可 —— 父目录的合法性已由 underRoot 保证。
	private realpath(p: string): string {
		try {
			return fs.realpathSync(p)
		} catch {
			return path.resolve(p)
		}
	}


	// underRoot 判断 child 是否在 root 之下（或就是 root 本身）。
	private underRoot(child: string, root: string): boolean {
		if (root === "") {
			return false
		}

		const r = this.realpath(root)

		if (child === r) {
			return true
		}

		// 必须补上分隔符后再比较前缀。
		// 否则 /data/root_other 会被误判为 /data/root 的子路径。
		const prefix = r.endsWith(path.sep) ? r : r + path.sep
		return child.startsWith(prefix)
	}
}

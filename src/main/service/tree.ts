import fs from "node:fs"
import path from "node:path"

import { TreeNode, WorkspaceConfig } from "../../shared/types"
import { ResolveTranslatedRoot } from "./workspace"


const SKIP_DIRS = new Set(["_workspace", "_cache"])
const PAPER_EXT = ".pdf"

// 译文文件名：paper_{suffix}.md（§3.3）
const TRANS_PREFIX = "paper_"
const TRANS_EXT = ".md"


// ScanTree 扫描英文根，返回其直接子节点。
//
// 全程只读（铁律 L1）：只调 readdirSync 与 existsSync，不做任何写入。
// 返回 null 表示英文根不存在。
export function ScanTree(ws: WorkspaceConfig): TreeNode[] | null {
	if (!fs.existsSync(ws.SourceRoot)) {
		return null
	}

	const translatedRoot = ResolveTranslatedRoot(ws)
	const children = scan(ws, translatedRoot, ws.SourceRoot, "")

	sortNodes(children)

	return children
}


function scan(
	ws: WorkspaceConfig,
	translatedRoot: string,
	absDir: string,
	rel: string
): TreeNode[] {
	const entries = fs.readdirSync(absDir, { withFileTypes: true })
	const nodes: TreeNode[] = []

	for (const entry of entries) {
		const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`

		// 只跟随真实目录。符号链接 isDirectory() 为 false，
		// 不会被递归，天然避免符号链接环导致的无限递归。
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue

			const dir = new TreeNode()
			dir.Name = entry.name
			dir.Rel = childRel
			dir.IsDir = true
			dir.Children = scan(
				ws,
				translatedRoot,
				path.join(absDir, entry.name),
				childRel
			)

			nodes.push(dir)
			continue
		}

		if (!entry.isFile()) continue
		if (path.extname(entry.name).toLowerCase() !== PAPER_EXT) continue

		const file = new TreeNode()
		file.Name = entry.name
		file.Rel = childRel
		file.IsDir = false
		file.HasTranslated =
			translatedRoot !== "" &&
			hasTranslated(translatedRoot, childRel)

		nodes.push(file)
	}

	sortNodes(nodes)

	return nodes
}


// hasTranslated 判定是否已有译文。
//
// 目录镜像规则（§3.2）：source/foo.pdf <-> translated/foo/
// 判定依据是「目录内存在至少一个 paper_*.md」，
// 而非「目录存在」—— 翻译中途失败时目录里可能只有 _cache。
function hasTranslated(translatedRoot: string, rel: string): boolean {
	const ext = path.extname(rel)
	const dirRel = rel.slice(0, rel.length - ext.length)

	return FirstTranslationFile(
		path.join(translatedRoot, dirRel)
	) !== null
}


// FirstTranslationFile 返回目录内第一个译文文件名，没有则 null。
function FirstTranslationFile(dir: string): string | null {
	try {
		for (const name of fs.readdirSync(dir)) {
			if (!name.startsWith(TRANS_PREFIX)) continue
			if (path.extname(name).toLowerCase() !== TRANS_EXT) continue
			if (name === TRANS_PREFIX + TRANS_EXT) continue // 空 suffix 不算
			return name
		}
	} catch {
		return null
	}

	return null
}


function sortNodes(nodes: TreeNode[]): void {
	nodes.sort((a, b) => {
		if (a.IsDir !== b.IsDir) return a.IsDir ? -1 : 1
		return a.Name.localeCompare(b.Name, "zh-Hans-CN", { numeric: true })
	})
}

import fs from "node:fs"
import path from "node:path"

import { TreeNode, WorkspaceConfig } from "../../shared/types"


// 不进目录树的中间产物目录。
//
// _workspace 是工作区级（术语库、索引等）
// _cache 是文章级（解析缓存、翻译状态、备份）
const SKIP_DIRS = new Set(["_workspace", "_cache"])

// 只把 PDF 视作论文
const PAPER_EXT = ".pdf"


// ScanTree 扫描英文根，返回其直接子节点。
//
// 英文根本身不出现在结果里 —— 它是容器，前端不需要展示。
//
// 全程只读（铁律 L1）：只调 readdirSync 与 existsSync，不做任何写入。
// 返回 null 表示英文根不存在。
export function ScanTree(ws: WorkspaceConfig): TreeNode[] | null {
	if (!fs.existsSync(ws.SourceRoot)) {
		return null
	}

	const children = scan(ws, ws.SourceRoot, "")

	sortNodes(children)

	return children
}


// scan 递归扫描一个目录。
//
// rel 为该目录相对英文根的路径，英文根本身 rel 为 ""。
function scan(ws: WorkspaceConfig, absDir: string, rel: string): TreeNode[] {
	const entries = fs.readdirSync(absDir, { withFileTypes: true })
	const nodes: TreeNode[] = []

	for (const entry of entries) {
		const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`

		// 只跟随真实目录。
		// 符号链接的 isDirectory() 为 false，因此不会被递归，
		// 天然避免了符号链接环导致的无限递归。
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) {
				continue
			}

			const dir = new TreeNode()
			dir.Name = entry.name
			dir.Rel = childRel
			dir.IsDir = true
			dir.Children = scan(ws, path.join(absDir, entry.name), childRel)

			nodes.push(dir)
			continue
		}

		if (!entry.isFile()) {
			continue
		}

		if (path.extname(entry.name).toLowerCase() !== PAPER_EXT) {
			continue
		}

		const file = new TreeNode()
		file.Name = entry.name
		file.Rel = childRel
		file.IsDir = false
		file.HasTranslated = hasTranslated(ws, childRel)

		nodes.push(file)
	}

	sortNodes(nodes)

	return nodes
}


// hasTranslated 判定某篇论文是否已有译文。
//
// 目录镜像规则：source/foo.pdf <-> translated/foo/
// 即 Rel 去掉扩展名后，在中文根下对应的目录。
function hasTranslated(ws: WorkspaceConfig, rel: string): boolean {
	const ext = path.extname(rel)
	const dirRel = rel.slice(0, rel.length - ext.length)

	return fs.existsSync(path.join(ws.TranslatedRoot, dirRel))
}


// sortNodes 目录在前、文件在后，同类按名称排序。
function sortNodes(nodes: TreeNode[]): void {
	nodes.sort((a, b) => {
		if (a.IsDir !== b.IsDir) {
			return a.IsDir ? -1 : 1
		}

		return a.Name.localeCompare(b.Name, "zh-Hans-CN", { numeric: true })
	})
}

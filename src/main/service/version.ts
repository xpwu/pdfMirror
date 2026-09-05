import fs from "node:fs"
import path from "node:path"

import { PaperVersion, WorkspaceConfig } from "../../shared/types"
import { ResolveTranslatedRoot } from "./workspace"


const TRANS_PREFIX = "paper_"
const TRANS_EXT = ".md"


// ScanVersions 扫描某篇论文的所有译文版本。
//
// rel 是论文相对英文根的路径（如 "nlp/bert.pdf"），
// 对应中文根下的目录为 rel 去掉扩展名。
//
// 只读，不做任何写入。目录不存在返回空列表（而非错误）——
// 「没有译文」是正常状态，不是错误。
export function ScanVersions(
	ws: WorkspaceConfig,
	rel: string
): PaperVersion[] {
	const translatedRoot = ResolveTranslatedRoot(ws)
	if (translatedRoot === "") return []

	const ext = path.extname(rel)
	const dirRel = rel.slice(0, rel.length - ext.length)
	const dir = path.join(translatedRoot, dirRel)

	let names: string[]
	try {
		names = fs.readdirSync(dir)
	} catch {
		return []
	}

	const list: PaperVersion[] = []

	for (const name of names) {
		if (!name.startsWith(TRANS_PREFIX)) continue
		if (path.extname(name).toLowerCase() !== TRANS_EXT) continue

		const suffix = name.slice(TRANS_PREFIX.length, -TRANS_EXT.length)
		if (suffix === "") continue // paper_.md 不是有效版本

		const full = path.join(dir, name)

		let mtime = 0
		try {
			mtime = fs.statSync(full).mtimeMs
		} catch {
			// 取不到时间就按 0 处理，仍能正常列出
		}

		const v = new PaperVersion()
		v.Model = suffix
		v.FileName = name
		// MdRelPath 相对中文根，前端据此构造展示信息
		v.MdRelPath = dirRel === "" ? name : `${dirRel}/${name}`
		v.ModifiedAt = mtime

		list.push(v)
	}

	// 最近修改的在前：默认选中第一条（§6.3 偏好优先 -> created_at 最新，
	// 偏好本轮未做，直接用最新）
	list.sort((a, b) => b.ModifiedAt - a.ModifiedAt)

	return list
}


// TranslationAbsPath 求某版本译文的绝对路径。
export function TranslationAbsPath(
	ws: WorkspaceConfig,
	rel: string,
	fileName: string
): string {
	const translatedRoot = ResolveTranslatedRoot(ws)
	const ext = path.extname(rel)
	const dirRel = rel.slice(0, rel.length - ext.length)

	return path.join(translatedRoot, dirRel, fileName)
}

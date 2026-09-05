import { ClassArray, Json } from "ts-json"

import { GetPaper, Paper as DBPaper, SetPaper } from "@/db/paper"

import { PaperVersion } from "../../../shared/types"


// PaperVersions 拉取某篇论文的所有译文版本。
//
// 只列版本，不读内容 —— 内容由 LoadTranslation 按需读取。
export async function PaperVersions(
	sourceRoot: string,
	rel: string
): Promise<Error | null> {
	const [ret, err] = await window.api.PaperVersions(sourceRoot, rel)
	if (err !== null) return new Error(err)

	const p = new DBPaper()
	p.Rel = rel
	p.Versions = normalize(ret)
	p.CurModel = ""
	p.Content = ""
	p.MdAbsPath = ""

	SetPaper(p)

	return null
}


// LoadTranslation 读取某个版本的译文内容。
//
// absPath 由调用方给出（主进程 PathGuard 会校验）。
export async function LoadTranslation(
	absPath: string,
	model: string
): Promise<Error | null> {
	const [bytes, err] = await window.api.ReadFile(absPath)
	if (err !== null) return new Error(err)

	const text = new TextDecoder("utf-8").decode(bytes)

	const p = GetPaper()
	p.CurModel = model
	p.Content = text
	p.MdAbsPath = absPath
	SetPaper(p)

	return null
}


// normalize 把 IPC 返回的普通对象转成 PaperVersion 实例。
//
// 结构化克隆会让 class 实例退化成普通对象，
// 用 ts-json 还原，保证类型行为一致。
function normalize(list: PaperVersion[] | null | undefined): PaperVersion[] {
	const out = new ClassArray(PaperVersion) as PaperVersion[]

	for (const v of list ?? []) {
		if (v instanceof PaperVersion) {
			out.push(v)
			continue
		}

		const t = new PaperVersion()
		t.Model = v?.Model ?? ""
		t.MdRelPath = v?.MdRelPath ?? ""
		t.FileName = v?.FileName ?? ""
		t.ModifiedAt = v?.ModifiedAt ?? 0
		out.push(t)
	}

	return out
}

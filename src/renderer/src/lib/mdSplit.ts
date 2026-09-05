// 译文按页切分。
//
// 切页标记（§4.2）：<!-- page: N -->
// 兼容标记内有无空格。

export interface MdPage {
	Page: number
	Content: string
}

export interface SplitResult {
	Pages: MdPage[]

	// 译文中出现的最大页码。用于与 PDF 页数比对，
	// 判断译文是否超出原文。
	MaxPage: number

	// 是否含任何切页标记。
	//
	// false 表示整篇译文没有分页信息 —— 无法与原文对齐，
	// 前端进入不联动模式并提示用户。
	HasMarkers: boolean
}


// 正则：匹配 <!-- page: N -->，N 前后空白可选
const MARK_RE = /<!--\s*page:\s*(\d+)\s*-->/gi


// SplitPages 把译文按切页标记切成页。
//
// 三条规则：
//   1. 第一个标记之前的内容归入第 1 页 —— PDF 第一页本就含标题与摘要，
//      归到第 1 页才对得上
//   2. 缺失的页留空 —— 页码必须严格对齐，否则锚点全乱。
//      宁可右侧空一块，也不能让页码错位
//   3. 完全没有标记时整篇作为第 1 页 —— AI 不可能搞定一切，
//      先按最可能的情况展示，由前端据此提示用户
export function SplitPages(md: string): SplitResult {
	const empty: MdPage[] = []

	if (md.trim() === "") {
		return { Pages: empty, MaxPage: 0, HasMarkers: false }
	}

	// 收集所有标记的位置与页码
	const marks: { index: number; end: number; page: number }[] = []

	MARK_RE.lastIndex = 0
	let m: RegExpExecArray | null

	while ((m = MARK_RE.exec(md)) !== null) {
		marks.push({
			index: m.index,
			end: m.index + m[0].length,
			page: Number(m[1])
		})
	}

	if (marks.length === 0) {
		return {
			Pages: [{ Page: 1, Content: md }],
			MaxPage: 1,
			HasMarkers: false
		}
	}

	// 第一段：第一个标记之前的内容
	const pages: MdPage[] = []
	const head = md.slice(0, marks[0].index)

	if (head.trim() !== "") {
		pages.push({ Page: 1, Content: head })
	}

	for (let i = 0; i < marks.length; i++) {
		const start = marks[i].end
		const stop = i + 1 < marks.length ? marks[i + 1].index : md.length
		const body = md.slice(start, stop)

		if (body.trim() === "") continue

		pages.push({ Page: marks[i].page, Content: body })
	}

	// 按页码排序，并填补缺失的页。
	//
	// 缺失页留空串：前端渲染为空 section，
	// 既保住页码对齐，也让用户一眼看到译文缺了哪几页。
	pages.sort((a, b) => a.Page - b.Page)

	const maxPage = pages.reduce((m, p) => (p.Page > m ? p.Page : m), 0)

	const filled: MdPage[] = []
	const seen = new Set<number>()

	for (const p of pages) {
		// 重复页码（标记写错）：后者拼接，不覆盖
		if (seen.has(p.Page)) {
			filled[filled.length - 1].Content += "\n\n" + p.Content
			continue
		}

		// 补空页
		while (filled.length + 1 < p.Page) {
			filled.push({ Page: filled.length + 1, Content: "" })
		}

		filled.push(p)
		seen.add(p.Page)
	}

	return { Pages: filled, MaxPage: maxPage, HasMarkers: true }
}

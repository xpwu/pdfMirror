// canvas 位图内存的自记账。
//
// 为什么需要它：
// 位图内存既不在 JS 堆里（performance.memory 统计不到），
// 也无法通过 Electron 的进程指标可靠拿到 ——
// 各平台单位不一致，且释放后内存会留在 Chromium 的分配器池子里
// 复用、不还给操作系统，因此 RSS 天然下不来，
// 用它判断有没有泄漏本身就是错的。
//
// 改为自己记账：渲染一页时记下该页位图字节，销毁时减去。
// 这个数字精确回答「当前有多少页的位图还活着」，
// 是判断切换后内存是否回到单篇水平的直接依据。
const sizes = new Map<number, number>()

let total = 0


// TrackPage 记录一页的位图字节。
//
// 若该页已有记录则先扣掉旧值 —— 保证重复调用不会累加。
export function TrackPage(page: number, bytes: number): void {
	const prev = sizes.get(page)
	if (prev !== undefined) {
		total -= prev
	}

	sizes.set(page, bytes)
	total += bytes
}


// UntrackPage 移除一页的记录。
export function UntrackPage(page: number): void {
	const prev = sizes.get(page)
	if (prev === undefined) return

	sizes.delete(page)
	total -= prev
}


// UntrackAll 清空所有记录。切换文档、改变缩放、卸载时调用。
export function UntrackAll(): void {
	sizes.clear()
	total = 0
}


// BitmapBytes 当前活着的位图总字节数。
export function BitmapBytes(): number {
	return total < 0 ? 0 : total
}


// BitmapPages 当前记了多少页。
//
// 应与页面上真实的 canvas 数量一致。
// 两者不等说明记账与实际渲染脱节（漏记或漏减）。
export function BitmapPages(): number {
	return sizes.size
}

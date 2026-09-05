import * as pdfjs from "pdfjs-dist"


// pdf.js 的 worker 必须用 Worker，否则解析会阻塞渲染进程主线程。
//
// 用 new URL(..., import.meta.url) 而不是硬编码路径：
// 交给打包器处理，开发期与打包后都能定位到 worker 文件。
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"pdfjs-dist/build/pdf.worker.min.mjs",
	import.meta.url
).toString()


// 解析超时（毫秒）。
//
// 正常论文远快于此。设置超时是为了在出现异常时给出明确反馈，
// 而不是永远停在「加载中」。
const OPEN_TIMEOUT_MS = 20000


// pdf.js 的 worker 是全局单例：所有文档共用同一个 worker 线程。
//
// 切换论文时若并发执行「销毁旧文档」与「打开新文档」，
// 旧文档的 destroy 会终止 worker 中属于它的任务，
// 而新文档的解析任务若正在同一 worker 中排队，可能被一并取消 ——
// 结果是新文档的 promise 既不 resolve 也不 reject，界面卡在加载中。
//
// 解决办法是把所有文档操作串到一条 promise 链上：
// 任一时刻只有一个操作在跑，且前一步（含 destroy）彻底结束后，
// 才开始下一步。这样 worker 上永不出现任务交错。
let chain: Promise<unknown> = Promise.resolve()

// 当前打开的文档，由加载器独占管理生命周期。
// 组件侧不要自行 destroy，否则会与串行化冲突。
let current: pdfjs.PDFDocumentProxy | null = null


// enqueue 把操作接到链的尾部。
//
// 用 chain.then(fn, fn) 而不是 chain.then(fn)：
// 无论前一步成功还是失败，后续操作都要继续。
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
	const p = chain.then(fn, fn)

	// 链的后续不因某次失败而中断
	chain = p.then(
		() => undefined,
		() => undefined
	)

	return p
}


// withTimeout 给 promise 加超时，避免无限等待。
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(msg)), ms)

		p.then(
			(v) => {
				clearTimeout(timer)
				resolve(v)
			},
			(e) => {
				clearTimeout(timer)
				reject(e)
			}
		)
	})
}


// destroyDoc 销毁文档，兼容不同版本的 pdf.js。
//
// 各版本的销毁方法名不一致：新版为 destroy()，旧版只有 cleanup()，
// 部分版本的类型定义还可能漏掉 destroy 的声明。
// 这里做运行时探测而非依赖类型声明，避免版本差异导致编译失败。
async function destroyDoc(d: pdfjs.PDFDocumentProxy): Promise<void> {
	const anyD = d as unknown as {
		destroy?: () => Promise<void> | void
		cleanup?: () => Promise<void> | void
	}

	try {
		if (typeof anyD.destroy === "function") {
			await anyD.destroy()
			return
		}

		if (typeof anyD.cleanup === "function") {
			await anyD.cleanup()
		}
	} catch {
		// 销毁失败不阻塞后续加载
	}
}


// OpenDocument 打开一份 PDF。
//
// 会先彻底销毁上一份文档，再打开新的 —— 全程串行，无并发。
export function OpenDocument(
	bytes: Uint8Array
): Promise<pdfjs.PDFDocumentProxy> {
	return enqueue(async () => {
		if (current !== null) {
			await destroyDoc(current)
			current = null
		}

		const task = pdfjs.getDocument({ data: bytes })

		const doc = await withTimeout(
			task.promise,
			OPEN_TIMEOUT_MS,
			"解析 PDF 超时（20 秒）"
		)

		current = doc

		return doc
	})
}


// CloseDocument 关闭当前文档，应用退出或确实不再需要时调用。
export function CloseDocument(): Promise<void> {
	return enqueue(async () => {
		if (current === null) return

		await destroyDoc(current)
		current = null
	})
}

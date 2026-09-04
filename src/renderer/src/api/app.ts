// GC 触发 V8 垃圾回收，返回是否可用。
//
// 需要主进程以 --js-flags=--expose-gc 启动。
export function GC(): boolean {
	return window.api.GC()
}

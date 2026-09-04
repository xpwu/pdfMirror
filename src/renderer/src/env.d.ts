/// <reference types="vite/client" />

import type { API } from "../../preload"


// 声明由 preload 注入的全局对象，让渲染进程获得完整类型。
declare global {
	interface Window {
		api: API
	}
}

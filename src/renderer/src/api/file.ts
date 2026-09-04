import { IPCResult } from "../../../shared/types"


// ReadFile 读取工作区内的文件字节。
//
// 只做输入校验与错误包装，真正的路径安全由主进程 PathGuard 负责。
export async function ReadFile(absPath: string): Promise<IPCResult<Uint8Array>> {
	if (absPath === "") {
		return [new Uint8Array(), "路径为空"]
	}

	return window.api.ReadFile(absPath)
}

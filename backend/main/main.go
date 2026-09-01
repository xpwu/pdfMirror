package main

import (
	"github.com/xpwu/go-cmd/arg"
	"github.com/xpwu/go-cmd/cmd"
	"github.com/xpwu/go-stream/push"
	"github.com/xpwu/go-stream/websocket"
	"github.com/xpwu/go-tinyserver/http"
	"github.com/xpwu/pdfMirror/api"
)

func main() {
	cmd.RegisterKeepAliveCmd(cmd.DefaultCmdName, "start server", func(args *arg.Arg) {
		arg.HookReadConfigTo(args)
		args.ParseAndRunHook()

		api.Add()
		http.Start()

		push.Start()
		websocket.Start()
	})

	cmd.Run()
}

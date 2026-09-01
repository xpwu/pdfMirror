package configs

import "github.com/xpwu/go-config/configs"

type config struct {
	OllamaAddr string
}

var Conf = &config{}

func init() {
	configs.Unmarshal(Conf)
}

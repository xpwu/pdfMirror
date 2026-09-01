package api

import (
	"context"
	log2 "github.com/xpwu/go-log/log"
	"github.com/xpwu/pdfMirror/configs"
)

type model struct {
	Name string `json:"name"`
	Size string `json:"size"`
}

type modelsRes struct {
	Models []model `json:"models"`
	Ollama string  `json:"ollama"`
}

func (s *suite) APIModels(ctx context.Context, req *Empty) *modelsRes {
	ctx, log := log2.WithCtx(ctx)
	log.Debug("xxxx")

	// todo  read models from ollama

	return &modelsRes{
		Models: []model{},
		Ollama: configs.Conf.OllamaAddr,
	}
}

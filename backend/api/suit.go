package api

import "github.com/xpwu/go-tinyserver/api"

type suite struct {
	api.PostJsonSetUpper
	api.PostJsonTearDowner
	api.RootURIMapper
}

type Empty struct{}

func Add() {
	api.Add(func() api.Suite {
		return &suite{}
	})
}

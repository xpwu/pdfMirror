package api

import "context"

type healthRes struct {
	OK      bool   `json:"ok"`
	Version string `json:"version"`
	Backend string `json:"backend"`
}

func (s *suite) APIHealth(ctx context.Context, req *Empty) *healthRes {

	return &healthRes{
		OK:      true,
		Version: "0.1.0",
		Backend: "xxxx",
	}
}

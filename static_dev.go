//go:build !prod

package main

import (
	"net/http/httputil"
	"net/url"

	"github.com/go-chi/chi/v5"
)

func frontend(r chi.Router) error {
	target, err := url.Parse("http://127.0.0.1:3000")
	if err != nil {
		return err
	}

	proxy := httputil.NewSingleHostReverseProxy(target)

	r.Handle("/*", proxy)

	return nil
}

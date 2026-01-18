//go:build !prod

package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"

	"github.com/go-chi/chi/v5"
)

func frontend(r chi.Router) error {
	target, _ := url.Parse("http://localhost:3000")

	proxy := httputil.NewSingleHostReverseProxy(target)

	director := proxy.Director

	proxy.Director = func(req *http.Request) {
		director(req)

		req.Host = target.Host
	}

	r.Handle("/*", proxy)

	return nil
}

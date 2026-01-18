//go:build !prod

package main

import (
	"net/http"
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

	director := proxy.Director

	proxy.Director = func(req *http.Request) {
		director(req)

		req.Host = target.Host
	}

	r.Handle("/*", proxy)

	return nil
}

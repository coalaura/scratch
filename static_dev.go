//go:build !prod

package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

func frontend() http.Handler {
	target, _ := url.Parse("http://localhost:3000")
	proxy := httputil.NewSingleHostReverseProxy(target)

	log.Println("Proxying frontend requests to Rsbuild (:3000)")

	return proxy
}

//go:build prod

package main

import (
	"net/http"
)

func frontend() http.Handler {
	return http.FileServer(http.Dir("./public"))
}

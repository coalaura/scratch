//go:build prod

package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

//go:embed static/dist
var distFS embed.FS

func frontend(r chi.Router) error {
	sub, err := fs.Sub(distFS, "static/dist")
	if err != nil {
		return err
	}

	fileServer := http.FileServer(http.FS(sub))

	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		if strings.Contains(path, ".") {
			fileServer.ServeHTTP(w, r)

			return
		}

		r.URL.Path = "/"

		fileServer.ServeHTTP(w, r)
	})

	return nil
}

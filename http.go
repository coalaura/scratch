package main

import (
	"encoding/json"
	"net/http"
)

func abort(w http.ResponseWriter, code int, err string) {
	w.Header().Add("Content-Type", "application/json")
	w.WriteHeader(code)

	if err == "" {
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"error": err,
	})
}

func okay(w http.ResponseWriter, data any) {
	w.Header().Add("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	if data == nil {
		return
	}

	json.NewEncoder(w).Encode(data)
}

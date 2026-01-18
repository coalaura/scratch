package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

type Scratch struct {
	ID        int64    `json:"id"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Tags      []string `json:"tags"`
	UpdatedAt int64    `json:"updated_at"`
	CreatedAt int64    `json:"created_at"`
}

func (sc *Scratch) SetTags(tags string) {
	sc.Tags = nil

	for tag := range strings.SplitSeq(tags, ",") {
		tag = strings.TrimSpace(tag)

		if tag == "" {
			continue
		}

		sc.Tags = append(sc.Tags, tag)
	}
}

func HandleList(w http.ResponseWriter, r *http.Request) {
	scratches, err := database.FindAll(r.Context())
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to list")

		log.Warnf("failed to find all: %v\n", err)

		return
	}

	okay(w, scratches)
}

func HandleCreate(w http.ResponseWriter, r *http.Request) {
	var scratch Scratch

	err := json.NewDecoder(r.Body).Decode(&scratch)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	err = database.Create(&scratch)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to create")

		log.Warnf("failed to create: %v\n", err)

		return
	}

	okay(w, map[string]int64{
		"id": scratch.ID,
	})
}

func HandleUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if id == "" {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	var scratch Scratch

	err := json.NewDecoder(r.Body).Decode(&scratch)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	err = database.Update(id, &scratch)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to update")

		log.Warnf("failed to update: %v\n", err)

		return
	}

	okay(w, nil)
}

func HandleDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if id == "" {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	err := database.Delete(id)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to delete")

		log.Warnf("failed to delete: %v\n", err)

		return
	}

	okay(w, nil)
}

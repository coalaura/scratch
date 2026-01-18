package main

import (
	"encoding/json"
	"net/http"
	"strconv"
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

type ScratchUpdateRequest struct {
	Title *string   `json:"title"`
	Body  *string   `json:"body"`
	Tags  *[]string `json:"tags"`
}

func (sc *Scratch) SetTags(tags string) {
	sc.Tags = sc.Tags[:0]

	for tag := range strings.SplitSeq(tags, ",") {
		tag = strings.TrimSpace(tag)

		if tag != "" {
			sc.Tags = append(sc.Tags, tag)
		}
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

func HandleGet(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	scratch, err := database.Find(r.Context(), id)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to get")

		log.Warnf("failed to get: %v\n", err)

		return
	}

	if scratch == nil {
		abort(w, http.StatusNotFound, "")

		return
	}

	okay(w, scratch)
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
	id, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	var req ScratchUpdateRequest

	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	err = database.Update(id, &req)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to update")

		log.Warnf("failed to update: %v\n", err)

		return
	}

	okay(w, nil)
}

func HandleDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r, "id")
	if !ok {
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

func parseID(r *http.Request, name string) (int64, bool) {
	raw := chi.URLParam(r, name)
	if raw == "" {
		return 0, false
	}

	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}

	return id, true
}

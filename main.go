package main

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/coalaura/plain"
	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/chi/v5"
)

var Version = "dev"

var (
	config   *Config
	database *Database

	log = plain.New(plain.WithDate(plain.RFC3339Local))
)

func main() {
	var err error

	log.Println("Loading config...")

	config, err = LoadConfig()
	log.MustFail(err)

	log.Println("Connecting to database...")

	database, err = ConnectToDatabase()
	log.MustFail(err)

	defer database.Close()

	log.Println("Preparing router...")
	r := chi.NewRouter()

	r.Use(middleware.Recoverer)
	r.Use(log.Middleware())

	err = frontend(r)
	log.MustFail(err)

	r.Get("/-/verify", HandleVerify)

	r.Group(func(gr chi.Router) {
		gr.Use(authenticate)

		gr.Get("/-/notes", HandleList)

		gr.Post("/-/note", HandleCreate)
		gr.Get("/-/note/{id}", HandleGet)
		gr.Put("/-/note/{id}", HandleUpdate)
		gr.Delete("/-/note/{id}", HandleDelete)
	})

	addr := config.Addr()

	server := &http.Server{
		Addr:    addr,
		Handler: r,
	}

	go func() {
		log.Printf("Listening at http://localhost%s/\n", addr)

		err = server.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Warnln(err)
		}
	}()

	log.WaitForInterrupt(false)

	log.Warnln("Shutting down...")

	shutdown, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	server.Shutdown(shutdown)
}

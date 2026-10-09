package main

import (
	"embed"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

//go:embed migrations/*.sql
var migrations embed.FS

type answer struct {
	status int
	body   any
}

var (
	notFound  = answer{http.StatusNotFound, map[string]string{"error": "not found"}}
	forbidden = answer{http.StatusForbidden, map[string]string{"error": "forbidden"}}
)

// A handler of a request of a user, on the database
type handler func(r *http.Request, db *gorm.DB, userID int64) (answer, error)

type server struct{ db *gorm.DB }

func main() {
	db, err := gorm.Open(postgres.Open(os.Getenv("DATABASE_URL")), &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)})
	if err != nil {
		log.Fatal(err)
	}
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		migrate(db)
		return
	}
	s := server{db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) })
	mux.Handle("GET /projects", s.route(projects))
	mux.Handle("GET /documents", s.route(listDocuments))
	mux.Handle("POST /documents", s.route(createDocument))
	mux.Handle("GET /documents/{id}", s.route(getDocument))
	mux.Handle("PATCH /documents/{id}", s.route(updateDocument))
	mux.Handle("DELETE /documents/{id}", s.route(deleteDocument))
	mux.Handle("PUT /documents/{id}/shares/{userID}", s.route(share))
	log.Fatal(http.ListenAndServe("127.0.0.1:"+os.Getenv("PORT"), mux))
}

func migrate(db *gorm.DB) {
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatal(err)
	}
	if err := goose.Up(sqlDB, "migrations"); err != nil {
		log.Fatal(err)
	}
}

// A real app signs users in, with a session or a token, this one reads the user from a header
func (s server) route(h handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, err := strconv.ParseInt(r.Header.Get("x-user-id"), 10, 64)
		if err != nil {
			write(w, answer{http.StatusUnauthorized, map[string]string{"error": "unauthorized"}})
			return
		}
		a, err := h(r, s.db.WithContext(r.Context()), userID)
		if err != nil {
			log.Print(err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		write(w, a)
	})
}

func write(w http.ResponseWriter, a answer) {
	if a.body == nil {
		w.WriteHeader(a.status)
		return
	}
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(a.status)
	_ = json.NewEncoder(w).Encode(a.body)
}

func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	return id, err == nil
}

func projects(r *http.Request, db *gorm.DB, userID int64) (answer, error) {
	found := []Project{}
	err := readableProjects(db, userID).Find(&found).Error
	return answer{http.StatusOK, found}, err
}

func listDocuments(r *http.Request, db *gorm.DB, userID int64) (answer, error) {
	found := []DocumentItem{}
	err := readableDocuments(db, userID).Find(&found).Error
	return answer{http.StatusOK, found}, err
}

func createDocument(r *http.Request, db *gorm.DB, userID int64) (answer, error) {
	var document Document
	if err := json.NewDecoder(r.Body).Decode(&document); err != nil {
		return answer{http.StatusBadRequest, map[string]string{"error": "bad request"}}, nil
	}
	document.ID = 0
	bits, err := projectBits(db, userID, document.ProjectID)
	if err != nil || !bits["write"] {
		return forbidden, err
	}
	err = db.Create(&document).Error
	return answer{http.StatusCreated, document}, err
}

func getDocument(r *http.Request, db *gorm.DB, userID int64) (answer, error) {
	id, ok := pathID(r, "id")
	if !ok {
		return notFound, nil
	}
	bits, err := documentBits(db, userID, id)
	if err != nil || !bits["read"] {
		return notFound, err
	}
	var document Document
	err = db.Take(&document, id).Error
	return answer{http.StatusOK, document}, err
}

func updateDocument(r *http.Request, db *gorm.DB, userID int64) (answer, error) {
	id, ok := pathID(r, "id")
	if !ok {
		return notFound, nil
	}
	bits, err := documentBits(db, userID, id)
	if err != nil || !bits["read"] {
		return notFound, err
	}
	if !bits["write"] {
		return forbidden, nil
	}
	var changes struct {
		Title *string `json:"title"`
		Body  *string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&changes); err != nil {
		return answer{http.StatusBadRequest, map[string]string{"error": "bad request"}}, nil
	}
	updates := map[string]any{}
	if changes.Title != nil {
		updates["title"] = *changes.Title
	}
	if changes.Body != nil {
		updates["body"] = *changes.Body
	}
	if err := db.Model(&Document{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return answer{}, err
	}
	var document Document
	err = db.Take(&document, id).Error
	return answer{http.StatusOK, document}, err
}

func deleteDocument(r *http.Request, db *gorm.DB, userID int64) (answer, error) {
	id, ok := pathID(r, "id")
	if !ok {
		return notFound, nil
	}
	bits, err := documentBits(db, userID, id)
	if err != nil || !bits["read"] {
		return notFound, err
	}
	if !bits["delete"] {
		return forbidden, nil
	}
	err = db.Delete(&Document{}, id).Error
	return answer{http.StatusNoContent, nil}, err
}

func share(r *http.Request, db *gorm.DB, userID int64) (answer, error) {
	id, ok := pathID(r, "id")
	target, targetOK := pathID(r, "userID")
	if !ok || !targetOK {
		return notFound, nil
	}
	var body struct {
		Access string `json:"access"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Access != "viewer" && body.Access != "editor") {
		return answer{http.StatusBadRequest, map[string]string{"error": "bad request"}}, nil
	}
	bits, err := documentBits(db, userID, id)
	if err != nil || !bits["read"] {
		return notFound, err
	}
	var previous []string
	if err := db.Model(&DocumentShare{}).Where("document_id = ? and user_id = ?", id, target).Pluck("access", &previous).Error; err != nil {
		return answer{}, err
	}
	for _, access := range append(previous, body.Access) {
		for _, bit := range bitsOf[access] {
			if !bits[bit] {
				return forbidden, nil
			}
		}
	}
	err = db.Save(&DocumentShare{DocumentID: id, UserID: target, Access: body.Access}).Error
	return answer{http.StatusNoContent, nil}, err
}

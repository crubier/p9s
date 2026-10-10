package main

type TeamMember struct {
	TeamID int64 `gorm:"primaryKey"`
	UserID int64 `gorm:"primaryKey"`
}

type Project struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type ProjectShare struct {
	ProjectID int64 `gorm:"primaryKey"`
	TeamID    int64 `gorm:"primaryKey"`
	Access    string
}

type Document struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
}

// A document in a list, without its body
type DocumentItem struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	Title     string `json:"title"`
}

type DocumentShare struct {
	DocumentID int64 `gorm:"primaryKey"`
	UserID     int64 `gorm:"primaryKey"`
	Access     string
}

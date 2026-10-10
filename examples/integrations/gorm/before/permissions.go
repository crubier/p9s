package main

// Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
// shares of documents with the user

import (
	"errors"

	"gorm.io/gorm"
)

type bits map[string]bool

var bitsOf = map[string][]string{"viewer": {"read"}, "editor": {"read", "write"}, "owner": {"read", "write", "delete"}}

func (b bits) add(access string) {
	for _, bit := range bitsOf[access] {
		b[bit] = true
	}
}

func teamsOf(db *gorm.DB, userID int64) *gorm.DB {
	return db.Model(&TeamMember{}).Select("team_id").Where("user_id = ?", userID)
}

func projectBits(db *gorm.DB, userID, projectID int64) (bits, error) {
	var accesses []string
	err := db.Model(&ProjectShare{}).Where("project_id = ? and team_id in (?)", projectID, teamsOf(db, userID)).Pluck("access", &accesses).Error
	result := bits{}
	for _, access := range accesses {
		result.add(access)
	}
	return result, err
}

// The bits of the user on the document, or nil when there is no such document
func documentBits(db *gorm.DB, userID, documentID int64) (bits, error) {
	var document Document
	if err := db.Select("project_id").Take(&document, documentID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	result, err := projectBits(db, userID, document.ProjectID)
	if err != nil {
		return nil, err
	}
	var accesses []string
	err = db.Model(&DocumentShare{}).Where("document_id = ? and user_id = ?", documentID, userID).Pluck("access", &accesses).Error
	for _, access := range accesses {
		result.add(access)
	}
	return result, err
}

// Every share gives read, so a user reads the projects shared with their teams, and the documents of those projects or
// shared with them
func readableProjectIDs(db *gorm.DB, userID int64) *gorm.DB {
	return db.Model(&ProjectShare{}).Select("project_id").Where("team_id in (?)", teamsOf(db, userID))
}

func readableProjects(db *gorm.DB, userID int64) *gorm.DB {
	return db.Where("id in (?)", readableProjectIDs(db, userID)).Order("id")
}

func readableDocuments(db *gorm.DB, userID int64) *gorm.DB {
	shared := db.Model(&DocumentShare{}).Select("document_id").Where("user_id = ?", userID)
	return db.Model(&Document{}).Where("project_id in (?) or id in (?)", readableProjectIDs(db, userID), shared).Order("id")
}

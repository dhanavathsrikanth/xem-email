package models

import (
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"kori/internal/onboardingemails"
)

type rootSystemTemplate struct {
	key, name, subject, html, design string
	variables                        pq.StringArray
}

func rootSystemTemplateID(teamID, key string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("xem:system-template:"+teamID+":"+key)).String()
}

func rootSystemTemplateCategoryID(teamID string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("xem:system-template-category:"+teamID+":transactional")).String()
}

func rootSystemTemplates() []rootSystemTemplate {
	rows := make([]rootSystemTemplate, 0, len(onboardingemails.Templates)+len(onboardingemails.ServiceTemplates))
	for _, template := range onboardingemails.Templates {
		html, _ := template.Render("{{workspace_name}}", "{{domain}}", "https://app.xem.email/settings/sending")
		rows = append(rows, rootSystemTemplate{key: "xem-" + template.Key, name: template.Subject, subject: template.Subject, html: html, design: base64.StdEncoding.EncodeToString(template.Design()), variables: pq.StringArray{"workspace_name", "domain"}})
	}
	for _, template := range onboardingemails.ServiceTemplates {
		data := onboardingemails.ServiceData{Name: "{{first_name}}", Email: "{{account_email}}", Workspace: "{{workspace_name}}", Time: "{{event_time}}", Count: "{{event_count}}"}
		html, _ := template.Render(data, "https://app.xem.email"+template.Path)
		variables := pq.StringArray{"workspace_name", "event_time", "event_count"}
		if template.Account {
			variables = pq.StringArray{"account_email", "event_time"}
		}
		if template.Key == "welcome" {
			variables = pq.StringArray{"first_name", "workspace_name"}
		}
		if template.Key == "password_reset" {
			variables = append(variables, "reset_token")
		}
		rows = append(rows, rootSystemTemplate{key: "xem-" + template.Key, name: template.Subject, subject: template.Subject, html: html, design: base64.StdEncoding.EncodeToString(template.Design()), variables: variables})
	}
	return rows
}

// SeedSuperAdminSystemTemplates backfills editable copies of Xem's 18 branded
// system emails into super-admin workspaces. StarterKey is the stable identity:
// an existing row is never updated, including when an admin customized it.
func SeedSuperAdminSystemTemplates(db *gorm.DB) error {
	var teamIDs []string
	if err := db.Model(&User{}).Distinct("team_id").Where("role = ? AND team_id IS NOT NULL AND is_deleted = false", UserRoleSuperAdmin).Pluck("team_id", &teamIDs).Error; err != nil {
		return fmt.Errorf("find super-admin workspaces: %w", err)
	}
	for _, teamID := range teamIDs {
		seedErr := db.Transaction(func(tx *gorm.DB) error {
			var category EmailCategory
			if err := tx.Where("team_id = ? AND LOWER(name) = ? AND is_deleted = false", teamID, "transactional").First(&category).Error; err != nil {
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				var deletedCount int64
				if err := tx.Model(&EmailCategory{}).Where("team_id = ? AND LOWER(name) = ? AND is_deleted = true", teamID, "transactional").Count(&deletedCount).Error; err != nil {
					return err
				}
				if deletedCount > 0 {
					return fmt.Errorf("transactional category was deleted; preserving administrator intent")
				}
				category = EmailCategory{Base: Base{ID: rootSystemTemplateCategoryID(teamID)}, Name: "Transactional", Description: "Account, security, and service notifications", TeamID: teamID}
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&category).Error; err != nil {
					return err
				}
				if err := tx.Where("id = ? AND team_id = ? AND LOWER(name) = ? AND is_deleted = false", category.ID, teamID, "transactional").First(&category).Error; err != nil {
					return fmt.Errorf("verify transactional category: %w", err)
				}
			}
			for _, spec := range rootSystemTemplates() {
				var existing Template
				if err := tx.Where("team_id = ? AND starter_key = ?", teamID, spec.key).First(&existing).Error; err == nil {
					continue
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				row := Template{Base: Base{ID: rootSystemTemplateID(teamID, spec.key)}, TeamID: teamID, CategoryID: category.ID, StarterKey: spec.key, Name: spec.name, Subject: spec.subject, HTMLBody: spec.html, DesignJSON: spec.design, Variables: spec.variables}
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
					return err
				}
				var saved Template
				if err := tx.Where("team_id = ? AND starter_key = ?", teamID, spec.key).First(&saved).Error; err != nil {
					return fmt.Errorf("verify system template %s: %w", spec.key, err)
				}
			}
			return nil
		})
		if seedErr != nil {
			return fmt.Errorf("seed super-admin system templates for team %s: %w", teamID, seedErr)
		}
	}
	return nil
}

package services

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"kori/internal/config"
	"kori/internal/db"
	"kori/internal/models"
	"kori/internal/utils/crypto"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAPIEmailPersistsOutboxAndThreadingBeforeAcknowledgement(t *testing.T) {
	oldDB, oldCfg, oldPrivate, oldPublic := db.DB, cfg, crypto.PrivateKey, crypto.PublicKey
	t.Cleanup(func() { db.DB, cfg, crypto.PrivateKey, crypto.PublicKey = oldDB, oldCfg, oldPrivate, oldPublic })
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	crypto.PrivateKey, crypto.PublicKey = key, &key.PublicKey
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&models.Email{}, &models.SMTPConfig{}, &models.EmailCategory{}))
	db.DB = database
	cfg = &config.Config{Server: config.ServerConfig{PublicURL: "https://api.example.com"}, JWT: config.JWTConfig{Secret: "test"}}
	team := uuid.NewString()
	sender := models.SMTPConfig{TeamID: team, Provider: "CUSTOM", Host: "smtp.example.com", Port: 465, Username: "sender@example.com", FromEmail: "sender@example.com", Password: "secret-password", IsActive: true}
	require.NoError(t, database.Create(&sender).Error)
	category := models.EmailCategory{TeamID: team, Name: "Transactional"}
	require.NoError(t, database.Create(&category).Error)
	scheduled := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	input := &models.Email{TeamID: team, SMTPConfigID: sender.ID, To: "reader@example.com", Subject: "Reply", Body: "<p>Hello</p>", InReplyTo: "<parent@example.com>", Test: true, SendAt: scheduled}
	require.NoError(t, QueueAPIEmail(input))
	var stored models.Email
	require.NoError(t, database.First(&stored).Error)
	require.NotNil(t, stored.DeliveryKey)
	require.Equal(t, "api:"+stored.ID, *stored.DeliveryKey)
	require.Equal(t, models.EmailStatusPending, stored.Status)
	require.Equal(t, input.InReplyTo, stored.InReplyTo)
	require.Equal(t, sender.ID, stored.SMTPConfigID)
	require.Equal(t, scheduled, stored.SendAt)
	input.TeamID = uuid.NewString()
	require.Error(t, QueueAPIEmail(input))
	var count int64
	require.NoError(t, database.Model(&models.Email{}).Count(&count).Error)
	require.EqualValues(t, 1, count)

	input.TeamID = team
	input.Attachments = []models.MailAttachment{{Filename: "receipt.txt", Content: base64.StdEncoding.EncodeToString([]byte("receipt")), ContentType: "text/plain"}}
	requestKey := uuid.NewString()
	require.NoError(t, QueueAPIEmailWithKey(input, requestKey))
	originalID := input.ID
	require.NotEmpty(t, originalID)
	// Retry after status has advanced: no second row and no resend.
	require.NoError(t, database.Model(&models.Email{}).Where("id = ?", originalID).UpdateColumn("status", models.EmailStatusSent).Error)
	require.NoError(t, QueueAPIEmailWithKey(input, requestKey))
	require.Equal(t, originalID, input.ID)
	var receipt models.Email
	require.NoError(t, database.First(&receipt, "id = ?", originalID).Error)
	require.Equal(t, input.Attachments, receipt.Attachments)
	require.True(t, receipt.Test)
	require.Equal(t, models.EmailStatusSent, receipt.Status)
	input.Subject = "Changed after submission"
	require.ErrorIs(t, QueueAPIEmailWithKey(input, requestKey), ErrEmailRequestConflict)
	require.NoError(t, database.Model(&models.Email{}).Count(&count).Error)
	require.EqualValues(t, 2, count)

	input.Subject = "Reply"
	require.NoError(t, database.Model(&models.SMTPConfig{}).Where("id = ?", sender.ID).UpdateColumns(map[string]any{"is_active": false, "is_deleted": true}).Error)
	require.NoError(t, QueueAPIEmailWithKey(input, requestKey), "the original receipt survives sender disconnection")
	require.Equal(t, originalID, input.ID)
	require.ErrorIs(t, QueueAPIEmailWithKey(input, uuid.NewString()), ErrEmailSenderUnavailable)
}

func TestAPIEmailConcurrentReceiptAndChangedDefaultsPostgres(t *testing.T) {
	dsn := os.Getenv("POSTHOOT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL; enabled in backend integration CI")
	}
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	schema := "outbox_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	require.NoError(t, admin.Exec("CREATE SCHEMA "+schema).Error)
	t.Cleanup(func() { admin.Exec("DROP SCHEMA " + schema + " CASCADE"); raw, _ := admin.DB(); raw.Close() })
	database, err := gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{DisableForeignKeyConstraintWhenMigrating: true, Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	raw, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { raw.Close() })
	require.NoError(t, database.AutoMigrate(&models.Email{}, &models.SMTPConfig{}, &models.EmailCategory{}))
	oldDB, oldCfg, oldPrivate, oldPublic := db.DB, cfg, crypto.PrivateKey, crypto.PublicKey
	t.Cleanup(func() { db.DB, cfg, crypto.PrivateKey, crypto.PublicKey = oldDB, oldCfg, oldPrivate, oldPublic })
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	crypto.PrivateKey, crypto.PublicKey = key, &key.PublicKey
	db.DB = database
	cfg = &config.Config{Server: config.ServerConfig{PublicURL: "https://api.example.com"}, JWT: config.JWTConfig{Secret: "test"}}
	team := uuid.NewString()
	sender := models.SMTPConfig{TeamID: team, Provider: "CUSTOM", Host: "smtp.example.com", Port: 465, Username: "sender@example.com", FromEmail: "sender@example.com", Password: "local-test-only", IsActive: true, IsDefault: true}
	require.NoError(t, database.Create(&sender).Error)
	require.NoError(t, database.Create(&models.EmailCategory{TeamID: team, Name: "Transactional"}).Error)
	for _, selection := range []string{"explicit", "default", "provider"} {
		t.Run(selection, func(t *testing.T) {
			input := models.Email{TeamID: team, To: "reader@example.com", Subject: "Receipt", Body: "<p>Hello</p>", Test: true}
			provider := ""
			if selection == "explicit" {
				input.SMTPConfigID = sender.ID
			}
			if selection == "provider" {
				provider = "CUSTOM"
			}
			requestKey := uuid.NewString()
			start := make(chan struct{})
			errors := make(chan error, 12)
			ids := make(chan string, 12)
			var workers sync.WaitGroup
			for range 12 {
				workers.Add(1)
				go func() {
					defer workers.Done()
					copy := input
					<-start
					errors <- QueueAPIEmailRequest(&copy, requestKey, provider)
					ids <- copy.ID
				}()
			}
			close(start)
			workers.Wait()
			close(errors)
			close(ids)
			for err := range errors {
				require.NoError(t, err)
			}
			var originalID string
			for id := range ids {
				if originalID == "" {
					originalID = id
				}
				require.Equal(t, originalID, id)
			}
			var count int64
			require.NoError(t, database.Model(&models.Email{}).Where("id = ?", originalID).Count(&count).Error)
			require.EqualValues(t, 1, count)
			require.NoError(t, database.Model(&models.Email{}).Where("id = ?", originalID).UpdateColumns(map[string]any{"status": models.EmailStatusSent, "is_deleted": true}).Error)
			require.NoError(t, database.Model(&models.SMTPConfig{}).Where("id = ?", sender.ID).UpdateColumns(map[string]any{"is_default": false, "is_active": false, "is_deleted": true}).Error)
			require.NoError(t, QueueAPIEmailRequest(&input, requestKey, provider))
			require.Equal(t, originalID, input.ID)
			input.Subject = "Different payload"
			require.ErrorIs(t, QueueAPIEmailRequest(&input, requestKey, provider), ErrEmailRequestConflict)
			require.NoError(t, database.Model(&models.SMTPConfig{}).Where("id = ?", sender.ID).UpdateColumns(map[string]any{"is_default": true, "is_active": true, "is_deleted": false}).Error)
		})
	}
}

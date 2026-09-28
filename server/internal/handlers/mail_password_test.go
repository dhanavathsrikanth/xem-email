package handlers

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"kori/internal/db"
	"kori/internal/models"
	"kori/internal/utils/crypto"
)

func TestSavedMailPasswordCannotBeTestedAgainstAnotherEndpointOrWorkspace(t *testing.T) {
	oldDB, private, public := db.DB, crypto.PrivateKey, crypto.PublicKey
	t.Cleanup(func() { db.DB, crypto.PrivateKey, crypto.PublicKey = oldDB, private, public })
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	crypto.PrivateKey, crypto.PublicKey = key, &key.PublicKey
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	db.DB = database
	require.NoError(t, database.AutoMigrate(&models.SMTPConfig{}, &models.IMAPConfig{}))
	team := uuid.NewString()
	smtp := models.SMTPConfig{TeamID: team, Provider: "CUSTOM", Host: "smtp.example.com", Port: 465, Username: "mail@example.com", Password: "local-password"}
	imap := models.IMAPConfig{TeamID: team, Host: "imap.example.com", Port: 993, Username: "mail@example.com", Password: "local-password"}
	require.NoError(t, database.Create(&smtp).Error)
	require.NoError(t, database.Create(&imap).Error)
	for _, test := range []struct {
		name, id, host string
		port           int
		handler        echo.HandlerFunc
	}{
		{"smtp", smtp.ID, smtp.Host, smtp.Port, NewSMTPHandler().TestSMTPConnection},
		{"imap", imap.ID, imap.Host, imap.Port, NewIMAPHandler(database).TestConnection},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, field := range []string{"host", "port", "username", "workspace"} {
				body := map[string]any{"id": test.id, "host": test.host, "port": test.port, "username": "mail@example.com", "from": "mail@example.com"}
				owner := team
				switch field {
				case "host":
					body["host"] = "different.example.com"
				case "port":
					body["port"] = 443
				case "username":
					body["username"] = "different@example.com"
				case "workspace":
					owner = uuid.NewString()
				}
				encoded, err := json.Marshal(body)
				require.NoError(t, err)
				req := httptest.NewRequest("POST", "/test", bytes.NewReader(encoded))
				req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
				ctx := echo.New().NewContext(req, httptest.NewRecorder())
				ctx.Set("teamID", owner)
				err = test.handler(ctx)
				require.Error(t, err)
				code := 400
				if field == "workspace" {
					code = 404
				}
				require.Equal(t, code, err.(*echo.HTTPError).Code)
				require.NotContains(t, err.Error(), "local-password")
			}
		})
	}
}

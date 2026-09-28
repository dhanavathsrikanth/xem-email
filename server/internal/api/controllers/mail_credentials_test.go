package controllers

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
	"kori/internal/api/validator"
	"kori/internal/models"
	"kori/internal/services"
	"kori/internal/utils/crypto"
)

func TestMailCredentialsAreWriteOnlyAndUpdatesPreserveTheSameEndpoint(t *testing.T) {
	private, public := crypto.PrivateKey, crypto.PublicKey
	t.Cleanup(func() { crypto.PrivateKey, crypto.PublicKey = private, public })
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	crypto.PrivateKey, crypto.PublicKey = key, &key.PublicKey
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&models.SMTPConfig{}, &models.IMAPConfig{}))
	team := uuid.NewString()
	password := "local-test-password"
	smtp := models.SMTPConfig{TeamID: team, Provider: "CUSTOM", Host: "smtp.example.com", Port: 465, Username: "sender@example.com", FromEmail: "sender@example.com", Password: password, MaxSendRate: 10}
	imap := models.IMAPConfig{TeamID: team, Host: "imap.example.com", Port: 993, Username: "sender@example.com", Password: password}
	require.NoError(t, database.Create(&smtp).Error)
	require.NoError(t, database.Create(&imap).Error)
	smtpController := NewBaseController(services.NewBaseService(database, models.SMTPConfig{}))
	imapController := NewBaseController(services.NewBaseService(database, models.IMAPConfig{}))
	for _, test := range []struct {
		name, id, host string
		port           int
		update         echo.HandlerFunc
	}{
		{"smtp", smtp.ID, smtp.Host, smtp.Port, smtpController.Update},
		{"imap", imap.ID, imap.Host, imap.Port, imapController.Update},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := map[string]any{"host": test.host, "port": test.port, "username": "sender@example.com", "password": "", "provider": "CUSTOM", "fromEmail": "new@example.com", "maxSendRate": 10}
			call := func(owner string) (*httptest.ResponseRecorder, error) {
				body, e := json.Marshal(payload)
				require.NoError(t, e)
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest("PUT", "/connections/"+test.id, bytes.NewReader(body))
				request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
				echoServer := echo.New()
				echoServer.Validator = validator.NewValidator()
				ctx := echoServer.NewContext(request, recorder)
				ctx.SetParamNames("id")
				ctx.SetParamValues(test.id)
				ctx.Set("teamID", owner)
				return recorder, test.update(ctx)
			}
			recorder, err := call(team)
			require.NoError(t, err)
			require.NotContains(t, recorder.Body.String(), "password")
			if test.name == "smtp" {
				var stored models.SMTPConfig
				require.NoError(t, database.First(&stored, "id = ?", test.id).Error)
				require.Equal(t, password, stored.Password)
			} else {
				var stored models.IMAPConfig
				require.NoError(t, database.First(&stored, "id = ?", test.id).Error)
				require.Equal(t, password, stored.Password)
			}
			payload["host"] = "different.example.com"
			_, err = call(team)
			require.Error(t, err)
			require.Equal(t, 400, err.(*echo.HTTPError).Code)
			payload["password"] = "explicit-new-password"
			recorder, err = call(team)
			require.NoError(t, err)
			require.NotContains(t, recorder.Body.String(), "password")
			_, err = call(uuid.NewString())
			require.Error(t, err)
			require.Equal(t, 404, err.(*echo.HTTPError).Code)
		})
	}
}

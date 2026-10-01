package handlers

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"kori/internal/config"
	"kori/internal/mailconnect"
	"kori/internal/models"
	"kori/internal/utils/crypto"
)

func relayHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.IMAPConfig{}, &models.CloudflareRelay{}))
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	oldPrivate, oldPublic := crypto.PrivateKey, crypto.PublicKey
	crypto.PrivateKey, crypto.PublicKey = key, &key.PublicKey
	t.Cleanup(func() { crypto.PrivateKey, crypto.PublicKey = oldPrivate, oldPublic })
	return db
}

func seedWorkerMailbox(t *testing.T, db *gorm.DB) models.CloudflareRelay {
	t.Helper()
	relay := models.CloudflareRelay{Base: models.Base{ID: "relay-id"}, TeamID: "team-a", Address: "inbox@example.com", WorkerURL: "https://mail.example.com", IMAPConfigID: "mailbox-id", Enabled: true}
	var err error
	relay.Secret, err = crypto.SealSecret([]byte("0123456789abcdef0123456789abcdef"), mailconnect.RelaySecretAAD(relay.TeamID, relay.ID))
	require.NoError(t, err)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&models.IMAPConfig{Base: models.Base{ID: relay.IMAPConfigID}, TeamID: relay.TeamID, Host: "mail.example.com", Port: 443, Username: relay.Address, IsActive: true}).Error)
	require.NoError(t, db.Create(&relay).Error)
	return relay
}

func TestCloudflareMailboxProxyContracts(t *testing.T) {
	db := relayHandlerTestDB(t)
	seedWorkerMailbox(t, db)
	old := doMailboxWorkerRequest
	t.Cleanup(func() { doMailboxWorkerRequest = old })
	var flagBody string
	doMailboxWorkerRequest = func(_ context.Context, _ string, secret, method, path string, body []byte) ([]byte, int, error) {
		require.Equal(t, "0123456789abcdef0123456789abcdef", secret)
		switch {
		case path == "/v1/mailbox/folders":
			return []byte(`[{"Name":"INBOX"}]`), 200, nil
		case strings.HasPrefix(path, "/v1/mailbox/emails?"):
			require.Contains(t, path, "limit=20")
			return []byte(`{"folder_name":"INBOX","total_emails":1,"limit":20,"offset":0,"uidValidity":42,"emails":[{"id":"mailbox-id:INBOX:42:7","uid":7,"uidValidity":42,"body":"preview","flags":[],"to":"inbox@example.com","cc":"","bcc":"","from":"sender@example.com","subject":"Hello","date":"2026-09-30T10:30:00Z","messageId":"m1","message_id":"m1","reply_to":""}]}`), 200, nil
		case strings.HasPrefix(path, "/v1/mailbox/head?"):
			return []byte(`{"total_emails":1,"uidValidity":42,"latest_uid":7}`), 200, nil
		case strings.HasPrefix(path, "/v1/mailbox/message?"):
			return []byte(`{"id":"mailbox-id:INBOX:42:7","uid":7,"uidValidity":42,"body":"full","flags":[],"to":"inbox@example.com","cc":"","bcc":"","from":"sender@example.com","subject":"Hello","date":"2026-09-30T10:30:00Z","messageId":"m1","message_id":"m1","reply_to":""}`), 200, nil
		case method == http.MethodPatch && path == "/v1/mailbox/flags":
			flagBody = string(body)
			return nil, 204, nil
		}
		return nil, 500, nil
	}
	h := NewIMAPHandler(db)
	e := echo.New()
	run := func(method, target, body string, call func(echo.Context) error) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.Set("teamID", "team-a")
		require.NoError(t, call(c))
		return rec
	}
	require.Equal(t, 200, run(http.MethodGet, "/?config_id=mailbox-id", "", h.GetFolders).Code)
	require.Contains(t, run(http.MethodGet, "/?config_id=mailbox-id&folder=INBOX", "", h.GetEmails).Body.String(), `"uid":7`)
	require.Contains(t, run(http.MethodGet, "/?config_id=mailbox-id&folder=INBOX", "", h.GetHead).Body.String(), `"latest_uid":7`)
	require.Contains(t, run(http.MethodGet, "/?config_id=mailbox-id&folder=INBOX&uid=7&uid_validity=42", "", h.GetMessage).Body.String(), `"body":"full"`)
	require.Equal(t, 204, run(http.MethodPatch, "/?config_id=mailbox-id", `{"folder":"INBOX","uid":7,"uidValidity":42,"flag":"\\Seen","enabled":true}`, h.ChangeFlags).Code)
	require.JSONEq(t, `{"folder":"INBOX","uid":7,"uidValidity":42,"flag":"\\Seen","enabled":true}`, flagBody)
}
func relayContext(e *echo.Echo, method, path, body string) echo.Context {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("teamID", "team-a")
	c.SetPath("/api/v1/mail-connections/cloudflare-relays/:id")
	return c
}

func TestCloudflareRelayCreateValidatesIdentityAndHidesSecret(t *testing.T) {
	db := relayHandlerTestDB(t)
	old := doMailboxWorkerRequest
	t.Cleanup(func() { doMailboxWorkerRequest = old })
	doMailboxWorkerRequest = func(context.Context, string, string, string, string, []byte) ([]byte, int, error) {
		return []byte(`{"version":1,"address":"inbox@example.com"}`), 200, nil
	}
	h := NewCloudflareRelaysHandler(db, &config.Config{})
	e := echo.New()
	c := relayContext(e, http.MethodPost, "/api/v1/mail-connections/cloudflare-relays", `{"workerUrl":"https://mail.example.com","address":"inbox@example.com","secret":"0123456789abcdef0123456789abcdef"}`)
	require.NoError(t, h.Create(c))
	body := c.Response().Writer.(*httptest.ResponseRecorder).Body.String()
	require.NotContains(t, body, "0123456789abcdef")
	var relay models.CloudflareRelay
	require.NoError(t, db.First(&relay).Error)
	require.NotContains(t, relay.Secret, "0123456789abcdef")
	var mailbox models.IMAPConfig
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).First(&mailbox, "id = ?", relay.IMAPConfigID).Error)
	require.Equal(t, "mail.example.com", mailbox.Host)
}

func TestCloudflareRelayTenantScopeAndSyntheticMutationGuard(t *testing.T) {
	db := relayHandlerTestDB(t)
	relay := models.CloudflareRelay{TeamID: "other-team", Address: "other@example.com", WorkerURL: "https://mail.example.com", IMAPConfigID: "mailbox", Enabled: true}
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&models.IMAPConfig{Base: models.Base{ID: "mailbox"}, TeamID: "other-team", Host: "mail.example.com", Port: 443, Username: relay.Address, IsActive: true}).Error)
	require.NoError(t, db.Create(&relay).Error)
	h := NewCloudflareRelaysHandler(db, &config.Config{})
	e := echo.New()
	c := relayContext(e, http.MethodGet, "/", "")
	c.SetParamNames("id")
	c.SetParamValues(relay.ID)
	err := h.Get(c)
	var httpErr *echo.HTTPError
	require.ErrorAs(t, err, &httpErr)
	require.Equal(t, 404, httpErr.Code)
	var mailbox models.IMAPConfig
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).First(&mailbox, "id = ?", "mailbox").Error)
	mailbox.Host = "evil.example.com"
	require.ErrorContains(t, db.Save(&mailbox).Error, "must be managed through mail connections")
}

func TestCloudflareRelayNeverMarshalsSecret(t *testing.T) {
	raw, err := json.Marshal(models.CloudflareRelay{Secret: "must-not-leak"})
	require.NoError(t, err)
	require.NotContains(t, string(raw), "must-not-leak")
	require.NotContains(t, string(raw), "Secret")
}

func TestCloudflareWorkerSharedResponseFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "devops", "cloudflare-mailbox", "test", "fixtures", "worker-response.json"))
	require.NoError(t, err)
	var fixture struct {
		List   FolderData   `json:"list"`
		Detail EmailMessage `json:"detail"`
	}
	require.NoError(t, json.Unmarshal(raw, &fixture))
	require.Equal(t, "INBOX", fixture.List.FolderName)
	require.Equal(t, uint32(42), fixture.List.UIDValidity)
	require.Len(t, fixture.List.Emails, 1)
	message := fixture.List.Emails[0]
	require.Equal(t, uint32(1), message.UID)
	require.Equal(t, "<pre>hello &lt;world&gt;</pre>", message.Body)
	require.Empty(t, message.Flags)
	require.Len(t, message.Attachments, 1)
	require.Equal(t, "note.txt", message.Attachments[0].Filename)
	require.Equal(t, "text/plain", message.Attachments[0].MIMEType)
	require.Empty(t, message.Attachments[0].Data)
	require.Equal(t, "<pre>hello &lt;world&gt;\n</pre>", fixture.Detail.Body)
	require.Equal(t, []byte("attachment"), fixture.Detail.Attachments[0].Data)
}

func TestCloudflareMailboxProxyDoesNotCrossTenant(t *testing.T) {
	db := relayHandlerTestDB(t)
	relay := seedWorkerMailbox(t, db)
	require.NoError(t, db.Model(&relay).UpdateColumn("team_id", "other-team").Error)
	old := doMailboxWorkerRequest
	t.Cleanup(func() { doMailboxWorkerRequest = old })
	called := false
	doMailboxWorkerRequest = func(context.Context, string, string, string, string, []byte) ([]byte, int, error) {
		called = true
		return nil, 500, nil
	}
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/?config_id=mailbox-id&folder=INBOX&uid=7&uid_validity=42", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("teamID", "team-a")
	err := NewIMAPHandler(db).GetMessage(c)
	require.Error(t, err)
	require.False(t, called)
}

func TestCloudflareMailboxProxyNeverFallsBackForDisabledOrUnreadableRelay(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*gorm.DB, models.CloudflareRelay)
	}{
		{"disabled", func(db *gorm.DB, r models.CloudflareRelay) {
			require.NoError(t, db.Model(&r).Updates(map[string]any{"enabled": false, "secret": ""}).Error)
		}},
		{"unreadable secret", func(db *gorm.DB, r models.CloudflareRelay) {
			require.NoError(t, db.Model(&r).UpdateColumn("secret", "not-an-envelope").Error)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := relayHandlerTestDB(t)
			relay := seedWorkerMailbox(t, db)
			tc.mutate(db, relay)
			old := doMailboxWorkerRequest
			t.Cleanup(func() { doMailboxWorkerRequest = old })
			called := false
			doMailboxWorkerRequest = func(context.Context, string, string, string, string, []byte) ([]byte, int, error) {
				called = true
				return nil, 500, nil
			}
			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/?config_id=mailbox-id", nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.Set("teamID", "team-a")
			err := NewIMAPHandler(db).GetFolders(c)
			var httpErr *echo.HTTPError
			require.ErrorAs(t, err, &httpErr)
			if tc.name == "disabled" {
				require.Equal(t, 409, httpErr.Code)
			} else {
				require.Equal(t, 500, httpErr.Code)
			}
			require.False(t, called)
		})
	}
}

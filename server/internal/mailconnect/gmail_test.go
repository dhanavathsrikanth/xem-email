package mailconnect

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"kori/internal/models"
)

func TestGmailMessagesUsesMetadataOnlyAndPreservesNativeIDs(t *testing.T) {
	var active, maximum atomic.Int32
	var profileSeen atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer access", r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/messages":
			require.True(t, profileSeen.Load(), "history baseline must be captured before listing")
			require.Equal(t, "INBOX", r.URL.Query().Get("labelIds"))
			require.Equal(t, "20", r.URL.Query().Get("maxResults"))
			fmt.Fprint(w, `{"messages":[{"id":"native-a"},{"id":"native-b"}],"nextPageToken":"opaque-next","resultSizeEstimate":42}`)
		case "/messages/native-a", "/messages/native-b":
			require.Equal(t, "metadata", r.URL.Query().Get("format"))
			n := active.Add(1)
			for n > maximum.Load() && !maximum.CompareAndSwap(maximum.Load(), n) {
			}
			time.Sleep(10 * time.Millisecond)
			active.Add(-1)
			id := r.URL.Path[len("/messages/"):]
			fmt.Fprintf(w, `{"id":%q,"labelIds":["INBOX","UNREAD"],"snippet":"preview","payload":{"headers":[{"name":"Subject","value":"Hello"}]}}`, id)
		case "/profile":
			profileSeen.Store(true)
			fmt.Fprint(w, `{"historyId":"987654321"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := &GmailClient{baseURL: server.URL, http: server.Client(), token: "access"}

	page, err := client.Messages(context.Background(), "INBOX", "receipt", "", 20)
	require.NoError(t, err)
	require.Equal(t, "opaque-next", page.NextPageToken)
	require.Equal(t, "987654321", page.HistoryID)
	require.Equal(t, []string{"native-a", "native-b"}, []string{page.Messages[0].ID, page.Messages[1].ID})
	require.LessOrEqual(t, maximum.Load(), int32(4))
}

func TestGmailAPIErrorPreservesBoundedQuotaReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "17")
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, `{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}`)
	}))
	defer server.Close()
	client := &GmailClient{baseURL: server.URL, http: server.Client(), token: "access"}
	_, err := client.Labels(context.Background())
	var apiErr *GmailAPIError
	require.ErrorAs(t, err, &apiErr)
	require.Equal(t, "userRateLimitExceeded", apiErr.Reason)
	require.Equal(t, "17", apiErr.RetryAfter)
}

func TestGmailIDsAreStrictAndOpaqueTokensRemainOpaque(t *testing.T) {
	require.True(t, validGmailID("18f_ab-CD"))
	require.False(t, validGmailID("message/other"))
	require.False(t, validGmailID(strings.Repeat("a", 257)))
	require.True(t, validGmailOpaque("opaque+/token=="))
	require.True(t, validGmailOpaque(strings.Repeat("a", 404)))
}

func TestGmailVisibleBodySkipsTextAttachmentsAndBoundsTraversal(t *testing.T) {
	message := GmailMessage{Payload: GmailPart{MimeType: "multipart/mixed", Parts: []GmailPart{
		{MimeType: "text/plain", Body: GmailBody{Data: base64.RawURLEncoding.EncodeToString([]byte("visible"))}},
		{MimeType: "text/plain", Headers: []GmailHeader{{Name: "Content-Disposition", Value: "attachment"}}, Body: GmailBody{AttachmentID: "att", Data: base64.RawURLEncoding.EncodeToString([]byte("private"))}},
	}}}
	body, isHTML, warning := message.VisibleBody(1024)
	require.Equal(t, "visible", body)
	require.False(t, isHTML)
	require.Empty(t, warning)
}

func TestGmailAttachmentRejectsDeclaredOversizeBeforeDownload(t *testing.T) {
	var downloaded atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/attachments/") {
			downloaded.Store(true)
			t.Fatal("oversized attachment must not be downloaded")
		}
		fmt.Fprint(w, `{"id":"native-id","payload":{"parts":[{"partId":"1","filename":"large.bin","body":{"attachmentId":"attachment-id","size":10485761}}]}}`)
	}))
	defer server.Close()
	client := &GmailClient{baseURL: server.URL, http: server.Client(), token: "access"}
	_, err := client.Attachment(context.Background(), "native-id", gmailPartSelector(GmailPart{PartID: "1"}, "0.0"))
	require.ErrorIs(t, err, errGmailAttachmentLarge)
	require.False(t, downloaded.Load())
}

func TestGmailFullMessageHydratesExternalVisibleBodyOnly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/messages/native-id":
			fmt.Fprint(w, `{"id":"native-id","payload":{"mimeType":"multipart/mixed","parts":[{"mimeType":"text/plain","body":{"attachmentId":"body-part","size":5}},{"filename":"private.txt","mimeType":"text/plain","body":{"attachmentId":"file-part","size":7}}]}}`)
		case "/messages/native-id/attachments/body-part":
			fmt.Fprintf(w, `{"size":5,"data":%q}`, base64.RawURLEncoding.EncodeToString([]byte("hello")))
		case "/messages/native-id/attachments/file-part":
			t.Fatal("actual attachment content must remain lazy")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := &GmailClient{baseURL: server.URL, http: server.Client(), token: "access"}
	message, err := client.Message(context.Background(), "native-id", "full")
	require.NoError(t, err)
	body, isHTML, warning := message.VisibleBody(1024)
	require.Equal(t, "hello", body)
	require.False(t, isHTML)
	require.Empty(t, warning)
	require.Len(t, message.Attachments(), 1)
}

func TestGmailAttachmentRequiresMembershipAndReturnsDecodedBytes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/messages/native-id":
			fmt.Fprint(w, `{"id":"native-id","payload":{"parts":[{"partId":"1","filename":"brief.txt","mimeType":"text/plain","body":{"attachmentId":"attachment-id","size":5}}]}}`)
		case "/messages/native-id/attachments/attachment-id":
			fmt.Fprintf(w, `{"size":5,"data":%q}`, base64.RawURLEncoding.EncodeToString([]byte("hello")))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := &GmailClient{baseURL: server.URL, http: server.Client(), token: "access"}

	data, err := client.Attachment(context.Background(), "native-id", gmailPartSelector(GmailPart{PartID: "1"}, "0.0"))
	require.NoError(t, err)
	require.Equal(t, []byte("hello"), data)
	_, err = client.Attachment(context.Background(), "native-id", "part:b3RoZXI")
	require.ErrorIs(t, err, osErrNotExist)
}

func TestGmailAttachmentSelectorSurvivesRotatingProviderID(t *testing.T) {
	var fullCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/messages/native-id":
			n := fullCalls.Add(1)
			fmt.Fprintf(w, `{"id":"native-id","payload":{"parts":[{"partId":"2.1","filename":"brief.txt","mimeType":"text/plain","body":{"attachmentId":"rotating-%d","size":5}}]}}`, n)
		case r.URL.Path == "/messages/native-id/attachments/rotating-2":
			fmt.Fprintf(w, `{"size":5,"data":%q}`, base64.RawURLEncoding.EncodeToString([]byte("hello")))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := &GmailClient{baseURL: server.URL, http: server.Client(), token: "access"}
	first, err := client.message(context.Background(), "native-id", "full", false)
	require.NoError(t, err)
	selector := first.Attachments()[0].AttachmentID
	require.NotContains(t, selector, "rotating-1")
	data, err := client.Attachment(context.Background(), "native-id", selector)
	require.NoError(t, err)
	require.Equal(t, []byte("hello"), data)
}

func TestGmailHistoryTreatsNotFoundAsStaleCursor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/history", r.URL.Path)
		require.Equal(t, "INBOX", r.URL.Query().Get("labelId"))
		http.Error(w, "stale", http.StatusNotFound)
	}))
	defer server.Close()
	client := &GmailClient{baseURL: server.URL, http: server.Client(), token: "access"}

	result, err := client.History(context.Background(), "INBOX", "123")
	require.NoError(t, err)
	require.True(t, result.Stale)
}

func TestNewGmailClientFailsClosedForBrokenGoogleConnections(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&models.IMAPConfig{}, &models.MailConnection{}))
	team := "team"
	for _, tc := range []struct {
		name       string
		config     models.IMAPConfig
		connection *models.MailConnection
		handled    bool
		wantErr    bool
	}{
		{name: "missing connection", config: models.IMAPConfig{Base: models.Base{ID: "gmail-missing"}, TeamID: team, Host: "imap.gmail.com", Port: 993, Username: "me@example.com"}, handled: true, wantErr: true},
		{name: "deleted config", config: models.IMAPConfig{Base: models.Base{ID: "gmail-deleted"}, TeamID: team, Host: "imap.gmail.com", Port: 993, Username: "me@example.com", IsActive: true}, handled: true, wantErr: true},
		{name: "password backed Gmail stays generic", config: models.IMAPConfig{Base: models.Base{ID: "gmail-password"}, TeamID: team, Host: "imap.gmail.com", Port: 993, Username: "me@example.com", Password: "app-password"}, handled: false},
		{name: "inactive connection", config: models.IMAPConfig{Base: models.Base{ID: "gmail-inactive"}, TeamID: team, Host: "imap.gmail.com", Port: 993, Username: "me@example.com", IsActive: true}, connection: &models.MailConnection{Base: models.Base{ID: "connection-inactive"}, TeamID: team, Provider: Google, Address: "me@example.com", SMTPConfigID: "smtp-inactive", Active: false, Secret: "sealed"}, handled: true, wantErr: true},
		{name: "empty secret", config: models.IMAPConfig{Base: models.Base{ID: "gmail-empty"}, TeamID: team, Host: "imap.gmail.com", Port: 993, Username: "me@example.com", IsActive: true}, connection: &models.MailConnection{Base: models.Base{ID: "connection-empty"}, TeamID: team, Provider: Google, Address: "me@example.com", SMTPConfigID: "smtp-empty", Active: true}, handled: true, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := tc.config
			if tc.name == "deleted config" {
				config.IsDeleted = true
			}
			require.NoError(t, database.Session(&gorm.Session{SkipHooks: true}).Create(&config).Error)
			if tc.connection != nil {
				id := config.ID
				tc.connection.IMAPConfigID = &id
				require.NoError(t, database.Session(&gorm.Session{SkipHooks: true}).Create(tc.connection).Error)
			}
			_, _, handled, err := NewGmailClient(context.Background(), database, team, config.ID)
			require.Equal(t, tc.handled, handled)
			if tc.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
	_, _, handled, err := NewGmailClient(context.Background(), database, "other-team", "gmail-missing")
	require.False(t, handled)
	require.NoError(t, err)
}

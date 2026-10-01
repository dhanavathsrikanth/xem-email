package handlers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
	"kori/internal/mailconnect"
	"kori/internal/models"
)

type fakeGmailMailbox struct {
	page       *mailconnect.GmailMessagePage
	message    *mailconnect.GmailMessage
	modifiedID string
	add        []string
	remove     []string
	attachment []byte
}

func (f *fakeGmailMailbox) Labels(context.Context) ([]mailconnect.GmailLabel, error) {
	return []mailconnect.GmailLabel{{ID: "CATEGORY_PROMOTIONS", Name: "CATEGORY_PROMOTIONS"}, {ID: "Label_7", Name: "Customers"}, {ID: "SENT", Name: "SENT"}, {ID: "YELLOW_STAR", Name: "YELLOW_STAR"}, {ID: "INBOX", Name: "INBOX"}, {ID: "CHAT", Name: "CHAT"}}, nil
}
func (f *fakeGmailMailbox) Messages(context.Context, string, string, string, int) (*mailconnect.GmailMessagePage, error) {
	return f.page, nil
}
func (f *fakeGmailMailbox) Message(context.Context, string, string) (*mailconnect.GmailMessage, error) {
	return f.message, nil
}
func (f *fakeGmailMailbox) ModifyLabels(_ context.Context, id string, add, remove []string) error {
	f.modifiedID, f.add, f.remove = id, add, remove
	return nil
}
func (f *fakeGmailMailbox) Attachment(context.Context, string, string) ([]byte, error) {
	return f.attachment, nil
}
func (f *fakeGmailMailbox) History(context.Context, string, string) (mailconnect.GmailHistoryResult, error) {
	return mailconnect.GmailHistoryResult{HistoryID: "new", Changed: true}, nil
}

func gmailTestContext(method, target, body string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("teamID", "team")
	return c, rec
}

func gmailTestHandler(fake *fakeGmailMailbox) *IMAPHandler {
	return &IMAPHandler{gmailConnect: func(echo.Context) (gmailMailboxAPI, *models.IMAPConfig, bool, error) {
		return fake, &models.IMAPConfig{Base: models.Base{ID: "config"}}, true, nil
	}}
}

func TestGmailListUsesNativeIdentityAndMetadataEnvelope(t *testing.T) {
	message := mailconnect.GmailMessage{ID: "native-id", LabelIDs: []string{"INBOX", "UNREAD"}, Snippet: "<preview>", Payload: mailconnect.GmailPart{Headers: []mailconnect.GmailHeader{{Name: "Subject", Value: "Hello"}, {Name: "Message-ID", Value: "<rfc@example>"}}}}
	fake := &fakeGmailMailbox{page: &mailconnect.GmailMessagePage{Messages: []mailconnect.GmailMessage{message}, NextPageToken: "opaque", ResultSizeEstimate: 9, HistoryID: "history"}}
	c, rec := gmailTestContext(http.MethodGet, "/?config_id=config&folder=INBOX&limit=20", "")
	require.NoError(t, gmailTestHandler(fake).GetEmails(c))
	require.Contains(t, rec.Body.String(), `"id":"config:gmail:native-id"`)
	require.Contains(t, rec.Body.String(), `"providerMessageId":"native-id"`)
	require.Contains(t, rec.Body.String(), `"next_page_token":"opaque"`)
	require.Contains(t, rec.Body.String(), `"history_id":"history"`)
	require.Contains(t, rec.Body.String(), `"total_is_estimate":true`)
	require.Contains(t, rec.Body.String(), `"body":"\u0026lt;preview\u0026gt;"`)
}

func TestGmailRejectsLegacyPaginationBeforeProviderRequest(t *testing.T) {
	fake := &fakeGmailMailbox{}
	c, _ := gmailTestContext(http.MethodGet, "/?config_id=config&folder=INBOX&offset=20", "")
	err := gmailTestHandler(fake).GetEmails(c)
	var httpErr *echo.HTTPError
	require.ErrorAs(t, err, &httpErr)
	require.Equal(t, 400, httpErr.Code)
}

func TestGmailSeenAndStarredMapToIndependentLabels(t *testing.T) {
	for _, tc := range []struct {
		body        string
		add, remove []string
	}{{`{"folder":"INBOX","providerMessageId":"native","flag":"\\Seen","enabled":true}`, nil, []string{"UNREAD"}}, {`{"folder":"INBOX","providerMessageId":"native","flag":"\\Flagged","enabled":true}`, []string{"STARRED"}, nil}} {
		fake := &fakeGmailMailbox{}
		c, rec := gmailTestContext(http.MethodPatch, "/?config_id=config", tc.body)
		require.NoError(t, gmailTestHandler(fake).ChangeFlags(c))
		require.Equal(t, 204, rec.Code)
		require.Equal(t, "native", fake.modifiedID)
		require.ElementsMatch(t, tc.add, fake.add)
		require.ElementsMatch(t, tc.remove, fake.remove)
	}
}

func TestGmailAttachmentReturnsStandardBase64(t *testing.T) {
	attachmentID := strings.Repeat("a", 404)
	message := &mailconnect.GmailMessage{ID: "native", LabelIDs: []string{"INBOX"}, Payload: mailconnect.GmailPart{Parts: []mailconnect.GmailPart{{Filename: "brief.txt", MimeType: "text/plain", Body: mailconnect.GmailBody{AttachmentID: attachmentID, Size: 5}}}}}
	fake := &fakeGmailMailbox{message: message, attachment: []byte("hello")}
	c, rec := gmailTestContext(http.MethodGet, "/?config_id=config&folder=INBOX&message_id=native&attachment_id="+attachmentID, "")
	require.NoError(t, gmailTestHandler(fake).GetAttachment(c))
	require.JSONEq(t, `{"Data":"aGVsbG8="}`, rec.Body.String())
}

func TestGmailHooksBypassStorageForEveryReadRoute(t *testing.T) {
	bodyData := "aGVsbG8"
	message := &mailconnect.GmailMessage{ID: "native", LabelIDs: []string{"INBOX"}, Payload: mailconnect.GmailPart{MimeType: "text/plain", Body: mailconnect.GmailBody{Data: bodyData}}}
	fake := &fakeGmailMailbox{page: &mailconnect.GmailMessagePage{}, message: message}
	h := gmailTestHandler(fake)
	for _, test := range []struct {
		name, target string
		call         func(echo.Context) error
	}{
		{"folders", "/?config_id=config", h.GetFolders},
		{"head", "/?config_id=config&folder=INBOX&history_id=old", h.GetHead},
		{"message", "/?config_id=config&folder=INBOX&message_id=native", h.GetMessage},
	} {
		t.Run(test.name, func(t *testing.T) {
			c, rec := gmailTestContext(http.MethodGet, test.target, "")
			require.NoError(t, test.call(c))
			require.Equal(t, 200, rec.Code)
		})
	}
}

func TestGmailFoldersUseFriendlyNamesAndPredictableOrder(t *testing.T) {
	fake := &fakeGmailMailbox{}
	c, rec := gmailTestContext(http.MethodGet, "/?config_id=config", "")
	require.NoError(t, gmailTestHandler(fake).GetFolders(c))
	require.JSONEq(t, `[
		{"Name":"INBOX","DisplayName":"Inbox","Attributes":[]},
		{"Name":"YELLOW_STAR","DisplayName":"Yellow star","Attributes":[]},
		{"Name":"SENT","DisplayName":"Sent","Attributes":[]},
		{"Name":"CATEGORY_PROMOTIONS","DisplayName":"Promotions","Attributes":[]},
		{"Name":"CHAT","DisplayName":"Chats","Attributes":[]},
		{"Name":"Label_7","DisplayName":"Customers","Attributes":[]}
	]`, rec.Body.String())
}

func TestGmailQuotaAndDisabledAPIHaveActionableErrors(t *testing.T) {
	for _, tc := range []struct {
		reason  string
		status  int
		message string
	}{{"userRateLimitExceeded", 429, "quota"}, {"accessNotConfigured", 503, "not enabled"}} {
		c, rec := gmailTestContext(http.MethodGet, "/", "")
		err := gmailError(c, &mailconnect.GmailAPIError{Status: 403, Reason: tc.reason, RetryAfter: "9"})
		var httpErr *echo.HTTPError
		require.ErrorAs(t, err, &httpErr)
		require.Equal(t, tc.status, httpErr.Code)
		require.Contains(t, strings.ToLower(httpErr.Message.(string)), tc.message)
		if tc.status == 429 {
			require.Equal(t, "9", rec.Header().Get("Retry-After"))
		}
	}
}

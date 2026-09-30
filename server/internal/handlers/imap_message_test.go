package handlers

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/emersion/go-imap"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"kori/internal/models"
	"kori/internal/utils"
)

type fakeMessageIMAP struct {
	status       *imap.MailboxStatus
	raw          []byte
	size         uint32
	uid          uint32
	selectFolder string
	readOnly     bool
	peek         bool
	uids         []uint32
	fetches      int
}

func (f *fakeMessageIMAP) Select(folder string, readOnly bool) (*imap.MailboxStatus, error) {
	f.selectFolder, f.readOnly = folder, readOnly
	return f.status, nil
}
func (f *fakeMessageIMAP) UidFetch(_ *imap.SeqSet, items []imap.FetchItem, out chan *imap.Message) error {
	f.fetches++
	defer close(out)
	message := imap.NewMessage(1, items)
	message.Uid, message.Size = f.uid, f.size
	for _, item := range items {
		if strings.Contains(string(item), "BODY.PEEK") {
			f.peek = true
			// Servers respond with BODY[] even when clients request BODY.PEEK[].
			message.Body[&imap.BodySectionName{}] = bytes.NewBuffer(f.raw)
		}
	}
	out <- message
	return nil
}
func (f *fakeMessageIMAP) UidSearch(*imap.SearchCriteria) ([]uint32, error) { return f.uids, nil }
func (f *fakeMessageIMAP) Close() error                                     { return nil }

func messageQueryContext(raw string) echo.Context {
	e := echo.New()
	req := httptest.NewRequest("GET", "/api/v1/imap/message?"+raw, nil)
	return e.NewContext(req, httptest.NewRecorder())
}

func TestParseMessageQueryRequiresStableBoundedIdentity(t *testing.T) {
	valid, err := parseMessageQuery(messageQueryContext("folder=INBOX&uid=42&uid_validity=7"))
	require.NoError(t, err)
	require.Equal(t, messageQuery{Folder: "INBOX", UID: 42, UIDValidity: 7}, valid)

	for _, raw := range []string{
		"folder=INBOX&uid=0&uid_validity=7",
		"folder=INBOX&uid=42&uid_validity=0",
		"folder=INBOX&uid=4294967296&uid_validity=7",
		"folder=INBOX&uid=42&uid_validity=4294967296",
		"folder=&uid=42&uid_validity=7",
		"folder=" + strings.Repeat("a", 1025) + "&uid=42&uid_validity=7",
	} {
		_, err := parseMessageQuery(messageQueryContext(raw))
		var httpErr *echo.HTTPError
		require.ErrorAs(t, err, &httpErr, raw)
		require.Equal(t, 400, httpErr.Code, raw)
	}
}

func TestParseMailPaginationAcceptsStableUIDCursor(t *testing.T) {
	parsed, err := parseMailPagination(messageQueryContext("limit=2&before_uid=42"))
	require.NoError(t, err)
	require.Equal(t, pagination{Limit: 2, BeforeUID: 42}, parsed)

	for _, raw := range []string{
		"before_uid=0",
		"before_uid=-1",
		"before_uid=4294967296",
		"before_uid=42&offset=1",
		"before_uid=42&page=1",
		"before_uid=42&offset=0&page=1",
		"before_uid=42&offset=0&page=-1",
	} {
		_, err := parseMailPagination(messageQueryContext(raw))
		var httpErr *echo.HTTPError
		require.ErrorAs(t, err, &httpErr, raw)
		require.Equal(t, 400, httpErr.Code, raw)
	}
}

func TestMailUIDWindowUsesStrictCursorAndAdvancesPastVanishedMessages(t *testing.T) {
	uids := []uint32{7, 12, 11, 10, 9, 8}
	window, total, next := mailUIDWindow(uids, pagination{Limit: 2, BeforeUID: 11})
	require.Equal(t, 6, total)
	require.Equal(t, []uint32{10, 9}, window)
	require.Equal(t, uint32(9), next)

	// The response cursor is derived from the requested window, not from how
	// many messages survive the later fetch/parse step.
	window, total, next = mailUIDWindow([]uint32{12, 11, 10}, pagination{Limit: 2})
	require.Equal(t, 3, total)
	require.Equal(t, []uint32{12, 11}, window)
	require.Equal(t, uint32(11), next)

	window, total, next = mailUIDWindow([]uint32{12, 11}, pagination{Limit: 2, BeforeUID: 11})
	require.Empty(t, window)
	require.Equal(t, 2, total)
	require.Zero(t, next)
}

func TestCanonicalMessageJSONOmitsAttachmentContent(t *testing.T) {
	message := EmailMessage{ID: "config:INBOX:7:42", UID: 42, UIDValidity: 7, Body: "<p>Hello</p>", Attachments: nil}
	raw, err := json.Marshal(message)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "attachments")

	message.Attachments = []utils.EmailAttachment{{Filename: "private.txt", Data: []byte("private bytes"), MIMEType: "text/plain"}}
	raw, err = json.Marshal(message)
	require.NoError(t, err)
	require.Contains(t, string(raw), "attachments")
}

func TestGetMessageUsesReadOnlyPeekAndChecksUIDValidity(t *testing.T) {
	raw := []byte("From: sender@example.com\r\nTo: reader@example.com\r\nSubject: Hello\r\nMessage-ID: <one@example.com>\r\nContent-Type: text/plain\r\n\r\nPrivate body")
	for _, test := range []struct {
		name       string
		validity   uint32
		size       uint32
		wantStatus int
	}{
		{name: "canonical", validity: 7, size: uint32(len(raw)), wantStatus: 200},
		{name: "stale validity", validity: 8, size: uint32(len(raw)), wantStatus: 409},
		{name: "bounded", validity: 7, size: 10*1024*1024 + 1, wantStatus: 413},
	} {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeMessageIMAP{status: &imap.MailboxStatus{UidValidity: test.validity}, raw: raw, size: test.size, uid: 42}
			h := &IMAPHandler{messageConnect: func(echo.Context) (messageIMAPClient, *models.IMAPConfig, error) {
				return fake, &models.IMAPConfig{Base: models.Base{ID: "config"}}, nil
			}}
			e := echo.New()
			recorder := httptest.NewRecorder()
			context := e.NewContext(httptest.NewRequest("GET", "/api/v1/imap/message?folder=INBOX&uid=42&uid_validity=7", nil), recorder)
			err := h.GetMessage(context)
			if test.wantStatus == 200 {
				require.NoError(t, err)
				require.Equal(t, 200, recorder.Code)
				require.True(t, fake.readOnly)
				require.True(t, fake.peek)
				require.Contains(t, recorder.Body.String(), "Private body")
				require.NotContains(t, recorder.Body.String(), "attachments")
			} else {
				var httpErr *echo.HTTPError
				require.ErrorAs(t, err, &httpErr)
				require.Equal(t, test.wantStatus, httpErr.Code)
			}
		})
	}
}

func TestGetMessagePreservesIdentityWhenMIMEIsUnsupported(t *testing.T) {
	raw := []byte("From: sender@example.com\r\nTo: reader@example.com\r\nSubject: Limited\r\nMessage-ID: <limited@example.com>\r\nContent-Type: multipart/mixed; boundary\r\n\r\nprivate undecoded MIME")
	fake := &fakeMessageIMAP{status: &imap.MailboxStatus{UidValidity: 7}, raw: raw, size: uint32(len(raw)), uid: 42}
	h := &IMAPHandler{messageConnect: func(echo.Context) (messageIMAPClient, *models.IMAPConfig, error) {
		return fake, &models.IMAPConfig{Base: models.Base{ID: "config"}}, nil
	}}
	recorder := httptest.NewRecorder()
	context := echo.New().NewContext(httptest.NewRequest("GET", "/api/v1/imap/message?folder=INBOX&uid=42&uid_validity=7", nil), recorder)
	require.NoError(t, h.GetMessage(context))
	require.Equal(t, 200, recorder.Code)
	require.Contains(t, recorder.Body.String(), "limited@example.com")
	require.Contains(t, recorder.Body.String(), utils.UnavailableMailBody)
	require.NotContains(t, recorder.Body.String(), "private undecoded MIME")
}

func TestMessageConnectionCannotLoadAnotherWorkspaceConfig(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&models.IMAPConfig{}))
	config := models.IMAPConfig{TeamID: "other-team", Host: "imap.example.com", Port: 993, Username: "private@example.com", Password: "private"}
	require.NoError(t, database.Session(&gorm.Session{SkipHooks: true}).Create(&config).Error)

	e := echo.New()
	context := e.NewContext(httptest.NewRequest("GET", "/api/v1/imap/message?config_id="+config.ID, nil), httptest.NewRecorder())
	context.Set("teamID", "requesting-team")
	_, _, err = NewIMAPHandler(database).connect(context)
	var httpErr *echo.HTTPError
	require.ErrorAs(t, err, &httpErr)
	require.Equal(t, 404, httpErr.Code)
}

func TestGetHeadIsReadOnlyAndNeverFetchesBodies(t *testing.T) {
	fake := &fakeMessageIMAP{status: &imap.MailboxStatus{UidValidity: 91}, uids: []uint32{7, 12, 9}}
	h := &IMAPHandler{headConnect: func(echo.Context) (headIMAPClient, error) { return fake, nil }}
	recorder := httptest.NewRecorder()
	context := echo.New().NewContext(httptest.NewRequest("GET", "/api/v1/imap/head?folder=INBOX&q=receipt", nil), recorder)
	require.NoError(t, h.GetHead(context))
	require.True(t, fake.readOnly)
	require.Equal(t, "INBOX", fake.selectFolder)
	require.Zero(t, fake.fetches)
	require.JSONEq(t, `{"total_emails":3,"uidValidity":91,"latest_uid":12}`, recorder.Body.String())
}

func TestGetHeadValidatesFolderAndSearchBounds(t *testing.T) {
	for _, raw := range []string{"", "?folder=" + strings.Repeat("a", 1025), "?folder=INBOX&q=" + strings.Repeat("a", 1025)} {
		recorder := httptest.NewRecorder()
		context := echo.New().NewContext(httptest.NewRequest("GET", "/api/v1/imap/head"+raw, nil), recorder)
		err := (&IMAPHandler{}).GetHead(context)
		var httpErr *echo.HTTPError
		require.ErrorAs(t, err, &httpErr)
		require.Equal(t, 400, httpErr.Code)
	}
}

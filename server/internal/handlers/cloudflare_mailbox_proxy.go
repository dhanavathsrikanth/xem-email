package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/emersion/go-imap"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"kori/internal/mailconnect"
	"kori/internal/models"
	"kori/internal/utils/crypto"
)

func (h *IMAPHandler) cloudflareRelay(c echo.Context) (*models.CloudflareRelay, string, error) {
	if h.db == nil {
		return nil, "", echo.NewHTTPError(500, "Mailbox storage is unavailable")
	}
	team, _ := c.Get("teamID").(string)
	if team == "" {
		return nil, "", echo.NewHTTPError(401, "Authentication required")
	}
	var relay models.CloudflareRelay
	err := h.db.Where("imap_config_id = ? AND team_id = ?", c.QueryParam("config_id"), team).First(&relay).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", echo.NewHTTPError(500, "Unable to load mailbox")
	}
	if !relay.Enabled || relay.Secret == "" {
		return nil, "", echo.NewHTTPError(409, "Mailbox connection is disabled. Reconnect in settings.")
	}
	secret, err := crypto.OpenSecret(relay.Secret, mailconnect.RelaySecretAAD(relay.TeamID, relay.ID))
	if err != nil {
		return nil, "", echo.NewHTTPError(500, "Unable to open mailbox credential")
	}
	return &relay, string(secret), nil
}

func mailboxWorkerError(status int) error {
	switch {
	case status == 401 || status == 403:
		return echo.NewHTTPError(409, "Mailbox Worker authentication failed. Reconnect in settings.")
	case status == 404:
		return echo.NewHTTPError(404, "Message is unavailable")
	case status == 409:
		return echo.NewHTTPError(409, "Mailbox changed. Refresh and try again.")
	case status == 400 || status == 422:
		return echo.NewHTTPError(400, "Invalid mailbox request")
	case status == 408 || status == 425 || status == 429 || status >= 500:
		return echo.NewHTTPError(503, "Mailbox Worker is temporarily unavailable")
	default:
		return echo.NewHTTPError(502, "Mailbox Worker request failed")
	}
}

func (h *IMAPHandler) proxyMailboxJSON(c echo.Context, method, path string, body []byte, out any) (bool, error) {
	relay, secret, err := h.cloudflareRelay(c)
	if err != nil {
		return true, err
	}
	if relay == nil {
		return false, nil
	}
	raw, status, err := doMailboxWorkerRequest(c.Request().Context(), relay.WorkerURL, secret, method, path, body)
	if err != nil {
		return true, echo.NewHTTPError(502, "Unable to reach mailbox Worker")
	}
	if status < 200 || status >= 300 {
		return true, mailboxWorkerError(status)
	}
	if out != nil && json.Unmarshal(raw, out) != nil {
		return true, echo.NewHTTPError(502, "Mailbox Worker returned an invalid response")
	}
	return true, nil
}

func mailboxQuery(c echo.Context, names ...string) string {
	v := url.Values{}
	for _, name := range names {
		if value := c.QueryParam(name); value != "" {
			v.Set(name, value)
		}
	}
	encoded := v.Encode()
	if encoded == "" {
		return ""
	}
	return "?" + encoded
}

func (h *IMAPHandler) cloudflareFolders(c echo.Context) (bool, error) {
	var folders []imap.MailboxInfo
	handled, err := h.proxyMailboxJSON(c, http.MethodGet, "/v1/mailbox/folders", nil, &folders)
	if !handled || err != nil {
		return handled, err
	}
	if len(folders) != 1 || folders[0].Name != "INBOX" {
		return true, echo.NewHTTPError(502, "Mailbox Worker returned invalid folders")
	}
	return true, c.JSON(200, folders)
}
func (h *IMAPHandler) cloudflareEmails(c echo.Context, p pagination) (bool, error) {
	var result FolderData
	for _, name := range []string{"since", "before", "subject", "from", "to", "cc", "bcc", "body"} {
		if c.QueryParam(name) != "" {
			relay, _, err := h.cloudflareRelay(c)
			if err != nil {
				return true, err
			}
			if relay != nil {
				return true, echo.NewHTTPError(400, "Cloudflare Worker mailboxes currently support only text search")
			}
			break
		}
	}
	values := url.Values{"folder": {c.QueryParam("folder")}, "limit": {strconv.Itoa(p.Limit)}, "offset": {strconv.Itoa(p.Offset)}}
	if p.BeforeUID != 0 {
		values.Set("before_uid", strconv.FormatUint(uint64(p.BeforeUID), 10))
		values.Set("offset", "0")
	}
	if q := c.QueryParam("q"); q != "" {
		values.Set("q", q)
	}
	path := "/v1/mailbox/emails?" + values.Encode()
	handled, err := h.proxyMailboxJSON(c, http.MethodGet, path, nil, &result)
	if !handled || err != nil {
		return handled, err
	}
	if result.FolderName != "INBOX" || result.UIDValidity == 0 || result.TotalEmails < 0 || len(result.Emails) > p.Limit {
		return true, echo.NewHTTPError(502, "Mailbox Worker returned an invalid message list")
	}
	for _, m := range result.Emails {
		if m.UID == 0 || m.UIDValidity != result.UIDValidity {
			return true, echo.NewHTTPError(502, "Mailbox Worker returned an invalid message")
		}
	}
	return true, c.JSON(200, result)
}
func (h *IMAPHandler) cloudflareHead(c echo.Context) (bool, error) {
	var result struct {
		Total       int    `json:"total_emails"`
		UIDValidity uint32 `json:"uidValidity"`
		Latest      uint32 `json:"latest_uid"`
	}
	handled, err := h.proxyMailboxJSON(c, http.MethodGet, "/v1/mailbox/head"+mailboxQuery(c, "folder", "q"), nil, &result)
	if !handled || err != nil {
		return handled, err
	}
	if result.Total < 0 || result.UIDValidity == 0 {
		return true, echo.NewHTTPError(502, "Mailbox Worker returned an invalid mailbox status")
	}
	return true, c.JSON(200, result)
}
func (h *IMAPHandler) cloudflareMessage(c echo.Context, q messageQuery) (bool, error) {
	var result EmailMessage
	path := "/v1/mailbox/message?folder=" + url.QueryEscape(q.Folder) + "&uid=" + strconv.FormatUint(uint64(q.UID), 10) + "&uid_validity=" + strconv.FormatUint(uint64(q.UIDValidity), 10)
	handled, err := h.proxyMailboxJSON(c, http.MethodGet, path, nil, &result)
	if !handled || err != nil {
		return handled, err
	}
	if result.UID != q.UID || result.UIDValidity != q.UIDValidity {
		return true, echo.NewHTTPError(502, "Mailbox Worker returned the wrong message")
	}
	return true, c.JSON(200, result)
}
func (h *IMAPHandler) cloudflareFlags(c echo.Context, request any) (bool, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return true, echo.NewHTTPError(400, "Invalid flag update")
	}
	handled, err := h.proxyMailboxJSON(c, http.MethodPatch, "/v1/mailbox/flags", body, nil)
	if !handled || err != nil {
		return handled, err
	}
	return true, c.NoContent(204)
}

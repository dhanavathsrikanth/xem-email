package mailconnect

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"kori/internal/models"
)

const gmailAPIBase = "https://gmail.googleapis.com/gmail/v1/users/me"

var ErrGmailHistoryStale = errors.New("Gmail history cursor is stale")

type GmailAPIError struct {
	Status     int
	RetryAfter string
	Reason     string
}

func (e *GmailAPIError) Error() string { return fmt.Sprintf("Gmail API returned HTTP %d", e.Status) }

type GmailClient struct {
	baseURL string
	http    *http.Client
	token   string
}

type GmailLabel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type GmailHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type GmailBody struct {
	AttachmentID string `json:"attachmentId"`
	Size         int64  `json:"size"`
	Data         string `json:"data"`
}

type GmailPart struct {
	PartID   string        `json:"partId"`
	MimeType string        `json:"mimeType"`
	Filename string        `json:"filename"`
	Headers  []GmailHeader `json:"headers"`
	Body     GmailBody     `json:"body"`
	Parts    []GmailPart   `json:"parts"`
}

type GmailMessage struct {
	ID           string    `json:"id"`
	ThreadID     string    `json:"threadId"`
	LabelIDs     []string  `json:"labelIds"`
	Snippet      string    `json:"snippet"`
	HistoryID    string    `json:"historyId"`
	InternalDate string    `json:"internalDate"`
	Payload      GmailPart `json:"payload"`
}

type GmailMessagePage struct {
	Messages           []GmailMessage `json:"messages"`
	NextPageToken      string         `json:"nextPageToken"`
	ResultSizeEstimate int            `json:"resultSizeEstimate"`
	HistoryID          string         `json:"historyId"`
}

type GmailHistoryResult struct {
	HistoryID string
	Changed   bool
	Stale     bool
}

type GmailAttachment struct {
	Filename     string
	MIMEType     string
	Size         int64
	AttachmentID string
}

func (m GmailMessage) Header(name string) string {
	for _, header := range m.Payload.Headers {
		if strings.EqualFold(header.Name, name) {
			return header.Value
		}
	}
	return ""
}

func (m GmailMessage) Attachments() []GmailAttachment {
	attachments := []GmailAttachment{}
	walkGmailPartsWithPath(m.Payload, func(part GmailPart, path string) {
		if part.Body.AttachmentID != "" && isGmailAttachment(part) {
			name := part.Filename
			if name == "" {
				name = "attachment"
			}
			attachments = append(attachments, GmailAttachment{Filename: name, MIMEType: part.MimeType, Size: part.Body.Size, AttachmentID: gmailPartSelector(part, path)})
		}
	})
	return attachments
}

func (m GmailMessage) VisibleBody(max int64) (string, bool, string) {
	var htmlBody, textBody string
	limited := false
	remaining := max
	complete := walkGmailParts(m.Payload, func(part GmailPart) {
		if isGmailAttachment(part) || part.Body.Data == "" || (part.MimeType != "text/html" && part.MimeType != "text/plain") {
			return
		}
		data, err := decodeGmailData(part.Body.Data, remaining)
		if errors.Is(err, errGmailAttachmentLarge) {
			limited = true
			return
		}
		if err != nil {
			return
		}
		remaining -= int64(len(data))
		if part.MimeType == "text/html" && htmlBody == "" {
			htmlBody = string(data)
		}
		if part.MimeType == "text/plain" && textBody == "" {
			textBody = string(data)
		}
	})
	if !complete {
		limited = true
	}
	if htmlBody != "" {
		if limited {
			return htmlBody, true, "Some message content was omitted because it exceeded the 10 MiB limit."
		}
		return htmlBody, true, ""
	}
	if textBody != "" {
		if limited {
			return textBody, false, "Some message content was omitted because it exceeded the 10 MiB limit."
		}
		return textBody, false, ""
	}
	return "", false, "Message content could not be displayed."
}

func NewGmailClient(ctx context.Context, tx *gorm.DB, teamID, configID string) (*GmailClient, *models.IMAPConfig, bool, error) {
	var cfg models.IMAPConfig
	if err := tx.WithContext(ctx).Session(&gorm.Session{SkipHooks: true}).Where("id = ? AND team_id = ?", configID, teamID).First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, false, nil
		}
		return nil, nil, true, err
	}
	if cfg.IsDeleted {
		if strings.EqualFold(cfg.Host, "imap.gmail.com") && cfg.Password == "" {
			return nil, &cfg, true, errors.New("Google mailbox configuration is deleted")
		}
		return nil, nil, false, nil
	}
	var connection models.MailConnection
	err := tx.WithContext(ctx).Where("team_id = ? AND imap_config_id = ? AND is_deleted = false", teamID, cfg.ID).First(&connection).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if strings.EqualFold(cfg.Host, "imap.gmail.com") && cfg.Password == "" {
			return nil, &cfg, true, errors.New("Google mailbox connection is missing")
		}
		return nil, &cfg, false, nil
	}
	if err != nil {
		return nil, &cfg, true, err
	}
	if connection.Provider != Google {
		return nil, &cfg, true, errors.New("unsupported connected mailbox provider")
	}
	if !cfg.IsActive || !connection.Active || connection.Secret == "" {
		return nil, &cfg, true, errors.New("Google mailbox disconnected")
	}
	token, err := GoogleToken(ctx, tx, &connection)
	if err != nil {
		return nil, &cfg, true, err
	}
	return &GmailClient{baseURL: gmailAPIBase, http: HTTPClient(), token: token}, &cfg, true, nil
}

func (g *GmailClient) request(ctx context.Context, method, path string, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, g.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := g.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var failure struct {
			Error struct {
				Errors []struct {
					Reason string `json:"reason"`
				} `json:"errors"`
			} `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 64*1024)).Decode(&failure)
		reason := ""
		if len(failure.Error.Errors) > 0 {
			reason = failure.Error.Errors[0].Reason
		}
		return &GmailAPIError{Status: res.StatusCode, RetryAfter: res.Header.Get("Retry-After"), Reason: reason}
	}
	if out == nil {
		_, err = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		return err
	}
	limit := int64(12 * 1024 * 1024)
	if strings.Contains(path, "/attachments/") || strings.Contains(path, "format=full") {
		limit = 15 * 1024 * 1024
	}
	return json.NewDecoder(io.LimitReader(res.Body, limit)).Decode(out)
}

func (g *GmailClient) Labels(ctx context.Context) ([]GmailLabel, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var response struct {
		Labels []GmailLabel `json:"labels"`
	}
	if err := g.request(ctx, http.MethodGet, "/labels", nil, &response); err != nil {
		return nil, err
	}
	return response.Labels, nil
}

var gmailIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,256}$`)

func validGmailID(value string) bool { return gmailIDPattern.MatchString(value) }
func validGmailOpaque(value string) bool {
	return value != "" && len(value) <= 4096 && !strings.ContainsAny(value, "\x00\r\n")
}

func (g *GmailClient) Message(ctx context.Context, id, format string) (*GmailMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return g.message(ctx, id, format, format == "full")
}

func (g *GmailClient) message(ctx context.Context, id, format string, hydrate bool) (*GmailMessage, error) {
	if !validGmailID(id) {
		return nil, errors.New("invalid Gmail message ID")
	}
	values := url.Values{"format": {format}}
	if format == "metadata" {
		for _, header := range []string{"From", "To", "Cc", "Bcc", "Reply-To", "Subject", "Date", "Message-ID"} {
			values.Add("metadataHeaders", header)
		}
	}
	var message GmailMessage
	if err := g.request(ctx, http.MethodGet, "/messages/"+url.PathEscape(id)+"?"+values.Encode(), nil, &message); err != nil {
		return nil, err
	}
	if message.ID != id {
		return nil, errors.New("Gmail returned mismatched message identity")
	}
	if hydrate {
		g.hydrateVisibleBodies(ctx, id, &message.Payload, 10*1024*1024)
	}
	return &message, nil
}

func (g *GmailClient) hydrateVisibleBodies(ctx context.Context, messageID string, root *GmailPart, budget int64) {
	type entry struct {
		part  *GmailPart
		depth int
	}
	stack := []entry{{part: root}}
	fetched := 0
	for visited := 0; len(stack) > 0 && visited < 1000 && fetched < 8 && budget > 0; visited++ {
		last := len(stack) - 1
		current := stack[last]
		stack = stack[:last]
		part := current.part
		if !isGmailAttachment(*part) && (part.MimeType == "text/plain" || part.MimeType == "text/html") && part.Body.Data == "" && validGmailOpaque(part.Body.AttachmentID) && part.Body.Size <= budget {
			var response GmailBody
			path := "/messages/" + url.PathEscape(messageID) + "/attachments/" + url.PathEscape(part.Body.AttachmentID)
			if g.request(ctx, http.MethodGet, path, nil, &response) == nil {
				if data, err := decodeGmailData(response.Data, budget); err == nil {
					part.Body.Data = base64.RawURLEncoding.EncodeToString(data)
					budget -= int64(len(data))
					fetched++
				}
			}
		}
		if current.depth >= 32 {
			continue
		}
		for i := len(part.Parts) - 1; i >= 0; i-- {
			stack = append(stack, entry{part: &part.Parts[i], depth: current.depth + 1})
		}
	}
}

func (g *GmailClient) Messages(ctx context.Context, label, query, pageToken string, limit int) (*GmailMessagePage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if !validGmailID(label) || limit < 1 || limit > 20 || len(query) > 1024 || strings.ContainsRune(query, '\x00') || (pageToken != "" && !validGmailOpaque(pageToken)) {
		return nil, errors.New("invalid Gmail message query")
	}
	values := url.Values{"labelIds": {label}, "maxResults": {strconv.Itoa(limit)}}
	if query != "" {
		values.Set("q", query)
	}
	if pageToken != "" {
		values.Set("pageToken", pageToken)
	}
	var profile struct {
		HistoryID string `json:"historyId"`
	}
	if err := g.request(ctx, http.MethodGet, "/profile", nil, &profile); err != nil {
		return nil, err
	}
	var page GmailMessagePage
	if err := g.request(ctx, http.MethodGet, "/messages?"+values.Encode(), nil, &page); err != nil {
		return nil, err
	}
	results := make([]GmailMessage, len(page.Messages))
	keep := make([]bool, len(page.Messages))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	var firstErr error
	var mu sync.Mutex
	for i, item := range page.Messages {
		if !validGmailID(item.ID) {
			continue
		}
		wg.Add(1)
		go func(index int, id string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			message, err := g.Message(ctx, id, "metadata")
			if apiErr := new(GmailAPIError); errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
				return
			}
			if err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}
			results[index], keep[index] = *message, true
		}(i, item.ID)
	}
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	page.Messages = page.Messages[:0]
	for i := range results {
		if keep[i] {
			page.Messages = append(page.Messages, results[i])
		}
	}
	page.HistoryID = profile.HistoryID
	return &page, nil
}

func (g *GmailClient) ModifyLabels(ctx context.Context, id string, add, remove []string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if !validGmailID(id) {
		return errors.New("invalid Gmail message ID")
	}
	body, _ := json.Marshal(map[string][]string{"addLabelIds": add, "removeLabelIds": remove})
	return g.request(ctx, http.MethodPost, "/messages/"+url.PathEscape(id)+"/modify", strings.NewReader(string(body)), &GmailMessage{})
}

func (g *GmailClient) Attachment(ctx context.Context, messageID, attachmentID string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if !validGmailID(messageID) || !validGmailOpaque(attachmentID) {
		return nil, errors.New("invalid Gmail attachment ID")
	}
	message, err := g.message(ctx, messageID, "full", false)
	if err != nil {
		return nil, err
	}
	found, declaredSize, currentAttachmentID := false, int64(0), ""
	walkGmailPartsWithPath(message.Payload, func(part GmailPart, path string) {
		if gmailPartSelector(part, path) == attachmentID && part.Body.AttachmentID != "" && isGmailAttachment(part) {
			found = true
			declaredSize = part.Body.Size
			currentAttachmentID = part.Body.AttachmentID
		}
	})
	if !found {
		return nil, osErrNotExist
	}
	if declaredSize > 10*1024*1024 {
		return nil, errGmailAttachmentLarge
	}
	var response GmailBody
	if err := g.request(ctx, http.MethodGet, "/messages/"+url.PathEscape(messageID)+"/attachments/"+url.PathEscape(currentAttachmentID), nil, &response); err != nil {
		return nil, err
	}
	if response.Size > 10*1024*1024 {
		return nil, errGmailAttachmentLarge
	}
	data, err := decodeGmailData(response.Data, 10*1024*1024)
	if err != nil {
		return nil, err
	}
	return data, nil
}

var (
	osErrNotExist           = errors.New("Gmail attachment not found")
	errGmailAttachmentLarge = errors.New("Gmail attachment exceeds 10 MiB")
)

func IsGmailAttachmentNotFound(err error) bool { return errors.Is(err, osErrNotExist) }
func IsGmailAttachmentTooLarge(err error) bool { return errors.Is(err, errGmailAttachmentLarge) }

func decodeGmailData(value string, max int64) ([]byte, error) {
	if max < 0 || int64(len(value)) > (max+2)/3*4+4 {
		return nil, errGmailAttachmentLarge
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		decoded, err = base64.URLEncoding.DecodeString(value)
	}
	if err != nil {
		return nil, err
	}
	if int64(len(decoded)) > max {
		return nil, errGmailAttachmentLarge
	}
	return decoded, nil
}

func walkGmailParts(part GmailPart, fn func(GmailPart)) bool {
	return walkGmailPartsWithPath(part, func(part GmailPart, _ string) { fn(part) })
}

func walkGmailPartsWithPath(part GmailPart, fn func(GmailPart, string)) bool {
	type entry struct {
		part  GmailPart
		depth int
		path  string
	}
	stack := []entry{{part: part, path: "0"}}
	visited := 0
	for ; len(stack) > 0 && visited < 1000; visited++ {
		last := len(stack) - 1
		current := stack[last]
		stack = stack[:last]
		fn(current.part, current.path)
		if current.depth >= 32 {
			continue
		}
		for i := len(current.part.Parts) - 1; i >= 0; i-- {
			stack = append(stack, entry{part: current.part.Parts[i], depth: current.depth + 1, path: current.path + "." + strconv.Itoa(i)})
		}
	}
	return len(stack) == 0
}

func gmailPartSelector(part GmailPart, path string) string {
	if part.PartID != "" {
		return "part:" + base64.RawURLEncoding.EncodeToString([]byte(part.PartID))
	}
	return "path:" + path
}

func isGmailAttachment(part GmailPart) bool {
	if part.Filename != "" {
		return true
	}
	for _, header := range part.Headers {
		if strings.EqualFold(header.Name, "Content-Disposition") && strings.HasPrefix(strings.ToLower(strings.TrimSpace(header.Value)), "attachment") {
			return true
		}
	}
	return false
}

func (g *GmailClient) History(ctx context.Context, label, start string) (GmailHistoryResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if !validGmailID(label) || !validGmailID(start) {
		return GmailHistoryResult{}, errors.New("invalid Gmail history query")
	}
	pageToken := ""
	result := GmailHistoryResult{HistoryID: start}
	for page := 0; page < 5; page++ {
		values := url.Values{"startHistoryId": {start}, "labelId": {label}, "maxResults": {"100"}}
		if pageToken != "" {
			values.Set("pageToken", pageToken)
		}
		var response struct {
			HistoryID     string `json:"historyId"`
			NextPageToken string `json:"nextPageToken"`
			History       []struct {
				MessagesAdded []struct {
					Message GmailMessage `json:"message"`
				} `json:"messagesAdded"`
				MessagesDeleted []struct {
					Message GmailMessage `json:"message"`
				} `json:"messagesDeleted"`
				LabelsAdded []struct {
					Message  GmailMessage `json:"message"`
					LabelIDs []string     `json:"labelIds"`
				} `json:"labelsAdded"`
				LabelsRemoved []struct {
					Message  GmailMessage `json:"message"`
					LabelIDs []string     `json:"labelIds"`
				} `json:"labelsRemoved"`
			} `json:"history"`
		}
		err := g.request(ctx, http.MethodGet, "/history?"+values.Encode(), nil, &response)
		if apiErr := new(GmailAPIError); errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
			return GmailHistoryResult{Stale: true}, nil
		}
		if err != nil {
			return GmailHistoryResult{}, err
		}
		if response.HistoryID != "" {
			result.HistoryID = response.HistoryID
		}
		for _, history := range response.History {
			if len(history.MessagesAdded)+len(history.MessagesDeleted)+len(history.LabelsAdded)+len(history.LabelsRemoved) > 0 {
				result.Changed = true
			}
		}
		if response.NextPageToken == "" {
			return result, nil
		}
		pageToken = response.NextPageToken
	}
	result.Changed = true
	return result, nil
}

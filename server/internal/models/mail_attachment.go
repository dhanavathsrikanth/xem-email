package models

import (
	"encoding/base64"
	"errors"
	"mime"
	"strings"
	"unicode"
	"unicode/utf8"
)

const MaxMailAttachmentBytes = 3 * 1024 * 1024
const MaxMailAttachments = 10

// Attachment bytes live with the durable outbox record. No public object URL
// or caller-controlled filesystem path is used when a worker builds the MIME.
type MailAttachment struct {
	Filename    string `json:"filename"`
	Content     string `json:"content"`
	ContentType string `json:"contentType"`
}

func ValidateMailAttachments(files []MailAttachment) error {
	if len(files) > MaxMailAttachments {
		return errors.New("attach at most 10 files")
	}
	total := 0
	for _, file := range files {
		if file.Filename == "" || file.Filename == "." || file.Filename == ".." || len(file.Filename) > 255 || !utf8.ValidString(file.Filename) || strings.ContainsAny(file.Filename, "/\\") || strings.TrimSpace(file.Filename) != file.Filename {
			return errors.New("attachment filename must be a plain filename of at most 255 bytes")
		}
		for _, r := range file.Filename {
			if unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
				return errors.New("attachment filename contains hidden or control characters")
			}
		}
		kind, params, err := mime.ParseMediaType(file.ContentType)
		if err != nil || !strings.Contains(kind, "/") || len(params) != 0 || len(kind) > 127 {
			return errors.New("attachment contentType must be a MIME type without parameters")
		}
		if len(file.Content) > base64.StdEncoding.EncodedLen(MaxMailAttachmentBytes-total) || strings.ContainsAny(file.Content, "\r\n") {
			return errors.New("attachments must total at most 3 MiB")
		}
		data, err := base64.StdEncoding.Strict().DecodeString(file.Content)
		if err != nil {
			return errors.New("attachment content must be valid base64")
		}
		total += len(data)
		if total > MaxMailAttachmentBytes {
			return errors.New("attachments must total at most 3 MiB")
		}
	}
	return nil
}

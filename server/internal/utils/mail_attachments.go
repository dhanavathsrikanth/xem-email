package utils

import (
	"bytes"
	"encoding/base64"
	"gopkg.in/gomail.v2"
	"io"
	"kori/internal/models"
	"mime"
)

func addMailAttachments(message *gomail.Message, files []models.MailAttachment) error {
	if err := models.ValidateMailAttachments(files); err != nil {
		return err
	}
	for _, file := range files {
		data, err := base64.StdEncoding.Strict().DecodeString(file.Content)
		if err != nil {
			return err
		}
		kind, _, _ := mime.ParseMediaType(file.ContentType)
		message.Attach(file.Filename,
			gomail.SetHeader(map[string][]string{"Content-Type": {kind}}),
			gomail.SetCopyFunc(func(w io.Writer) error {
				_, err := io.Copy(w, bytes.NewReader(data))
				return err
			}),
		)
	}
	return nil
}

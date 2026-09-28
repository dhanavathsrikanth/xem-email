package utils

import (
	"bytes"
	"encoding/base64"
	"github.com/stretchr/testify/require"
	"gopkg.in/gomail.v2"
	"io"
	"kori/internal/models"
	"mime"
	"mime/multipart"
	"net/mail"
	"testing"
)

func TestOutgoingAttachmentsRoundTripAsDistinctMIMEParts(t *testing.T) {
	m := gomail.NewMessage()
	m.SetHeader("From", "sender@example.com")
	m.SetHeader("To", "recipient@example.com")
	m.SetBody("text/html", "<p>Two files</p>")
	files := []models.MailAttachment{
		{Filename: "résumé.txt", Content: base64.StdEncoding.EncodeToString([]byte("first content")), ContentType: "text/plain"},
		{Filename: "invoice.pdf", Content: base64.StdEncoding.EncodeToString([]byte{0, 1, 2, 255}), ContentType: "application/pdf"},
	}
	require.NoError(t, addMailAttachments(m, files))
	var raw bytes.Buffer
	_, err := m.WriteTo(&raw)
	require.NoError(t, err)
	parsed, err := mail.ReadMessage(&raw)
	require.NoError(t, err)
	kind, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	require.NoError(t, err)
	require.Equal(t, "multipart/mixed", kind)
	reader := multipart.NewReader(parsed.Body, params["boundary"])
	_, err = reader.NextPart()
	require.NoError(t, err)
	for _, file := range files {
		part, err := reader.NextPart()
		require.NoError(t, err)
		require.Equal(t, file.Filename, part.FileName())
		require.Equal(t, file.ContentType, part.Header.Get("Content-Type"))
		data, err := io.ReadAll(base64.NewDecoder(base64.StdEncoding, part))
		require.NoError(t, err)
		require.Equal(t, file.Content, base64.StdEncoding.EncodeToString(data))
	}
	_, err = reader.NextPart()
	require.ErrorIs(t, err, io.EOF)
}

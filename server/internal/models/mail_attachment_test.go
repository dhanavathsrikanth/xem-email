package models

import (
	"encoding/base64"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestMailAttachmentLimitsAndUntrustedMetadata(t *testing.T) {
	valid := MailAttachment{Filename: "receipt.pdf", Content: base64.StdEncoding.EncodeToString([]byte("document")), ContentType: "application/pdf"}
	require.NoError(t, ValidateMailAttachments([]MailAttachment{valid}))
	for _, name := range []string{"", "../receipt.pdf", `C:\receipt.pdf`, "receipt\r\nBcc: victim@example.com", "evil\u202egpj.exe", ".", strings.Repeat("é", 128)} {
		t.Run(name, func(t *testing.T) {
			file := valid
			file.Filename = name
			require.Error(t, ValidateMailAttachments([]MailAttachment{file}))
		})
	}
	for _, kind := range []string{"", "plain", "text/plain; name=x", "text/plain\r\nX-Evil: yes"} {
		file := valid
		file.ContentType = kind
		require.Error(t, ValidateMailAttachments([]MailAttachment{file}))
	}
	for _, content := range []string{"!!!", "abcd\n", "YR=="} {
		file := valid
		file.Content = content
		require.Error(t, ValidateMailAttachments([]MailAttachment{file}))
	}
	file := valid
	file.Content = base64.StdEncoding.EncodeToString(make([]byte, MaxMailAttachmentBytes))
	require.NoError(t, ValidateMailAttachments([]MailAttachment{file}))
	require.Error(t, ValidateMailAttachments([]MailAttachment{file, valid}))
	require.Error(t, ValidateMailAttachments(make([]MailAttachment, MaxMailAttachments+1)))
}

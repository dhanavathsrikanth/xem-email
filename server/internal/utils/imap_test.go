package utils

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseEmailDoesNotLogMalformedPrivateHeaders(t *testing.T) {
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previous) })

	secret := "private-token-should-not-be-logged"
	raw := strings.Join([]string{
		"Date: " + secret,
		"From: " + secret,
		"To: " + secret,
		"Cc: " + secret,
		"Reply-To: " + secret,
		"Subject: readable",
		"Content-Type: text/plain",
		"",
		"hello",
	}, "\r\n")
	parsed, err := ParseEmail(strings.NewReader(raw))
	require.NoError(t, err)
	require.Equal(t, "hello", strings.TrimSpace(parsed.BodyText))
	require.Empty(t, parsed.From)
	require.Empty(t, parsed.To)
	require.Empty(t, parsed.Cc)
	require.Empty(t, parsed.ReplyTo)
	require.NotContains(t, logs.String(), secret)
}

func TestParseEmailFallsBackWithoutExposingRawMalformedMIME(t *testing.T) {
	raw := strings.Join([]string{
		"From: Sender <sender@example.net>",
		"To: inbox@example.com",
		"Subject: =?UTF-8?Q?Still_readable?=",
		"Message-ID: <fallback@example.net>",
		"Content-Type: multipart/mixed; boundary",
		"",
		"private raw MIME must not be rendered",
	}, "\r\n")
	parsed, err := ParseEmail(strings.NewReader(raw))
	require.NoError(t, err)
	require.True(t, parsed.Limited)
	require.Equal(t, UnavailableMailBody, parsed.BodyText)
	require.Equal(t, "Still readable", parsed.Subject)
	require.Equal(t, "<fallback@example.net>", parsed.MessageID)
	require.Equal(t, "sender@example.net", parsed.From[0].Address)
	require.NotContains(t, parsed.BodyText, "private raw MIME")
}

func TestParseEmailUnreadableSourceStillReturnsError(t *testing.T) {
	parsed, err := ParseEmail(errorReader{})
	require.Error(t, err)
	require.Nil(t, parsed)
}

func TestParseEmailRetainsTextAttachmentFromMultipartMixed(t *testing.T) {
	raw := strings.Join([]string{
		"From: sender@example.net", "To: inbox@example.com", "Subject: attachment", "MIME-Version: 1.0",
		`Content-Type: multipart/mixed; boundary="safe"`, "", "--safe", "Content-Type: text/plain; charset=utf-8", "", "Visible body only",
		"--safe", "Content-Type: text/plain; charset=utf-8", `Content-Disposition: attachment; filename="=?UTF-8?B?dmVyaWZpY2F0aW9uLeKcky50eHQ=?="`,
		"Content-Transfer-Encoding: base64", "", "c2FmZSB1bmljb2RlIOKckw==", "--safe--", "",
	}, "\r\n")
	parsed, err := ParseEmail(strings.NewReader(raw))
	require.NoError(t, err)
	require.Equal(t, "Visible body only", strings.TrimSpace(parsed.BodyText))
	require.NotContains(t, parsed.BodyText, "safe unicode")
	require.Len(t, parsed.Attachments, 1)
	require.Equal(t, "verification-✓.txt", parsed.Attachments[0].Filename)
	require.Equal(t, "text/plain", parsed.Attachments[0].MIMEType)
	require.Equal(t, "safe unicode ✓", string(parsed.Attachments[0].Data))
}

func TestParseEmailAttachmentOnlyDoesNotExposeAttachmentAsBody(t *testing.T) {
	raw := strings.Join([]string{
		"From: sender@example.net", "To: inbox@example.com", "Subject: attachment only", "MIME-Version: 1.0",
		`Content-Type: multipart/mixed; boundary="safe"`, "", "--safe", `Content-Type: text/plain; name="secret.txt"`,
		`Content-Disposition: attachment; filename="secret.txt"`, "", "attachment contents must stay private", "--safe--", "",
	}, "\r\n")
	parsed, err := ParseEmail(strings.NewReader(raw))
	require.NoError(t, err)
	require.Equal(t, EmptyMailBody, parsed.BodyText)
	require.Empty(t, parsed.BodyHTML)
	require.NotContains(t, parsed.BodyText, "attachment contents")
	require.Len(t, parsed.Attachments, 1)
	require.Equal(t, "attachment contents must stay private", strings.TrimSpace(string(parsed.Attachments[0].Data)))
}

func TestParseEmailDecodesVisibleBodyCharset(t *testing.T) {
	raw := []byte(strings.Join([]string{
		"From: sender@example.net", "To: inbox@example.com", "Subject: latin1", "MIME-Version: 1.0",
		"Content-Type: text/plain; charset=iso-8859-1", "Content-Transfer-Encoding: quoted-printable", "", "caf=E9", "",
	}, "\r\n"))
	parsed, err := ParseEmail(bytes.NewReader(raw))
	require.NoError(t, err)
	require.Equal(t, "café", strings.TrimSpace(parsed.BodyText))
}

func TestParseEmailRejectsExcessiveMIMENestingBeforeLegacyParsing(t *testing.T) {
	var raw strings.Builder
	raw.WriteString("From: sender@example.net\r\nTo: inbox@example.com\r\nSubject: nested\r\nMIME-Version: 1.0\r\n")
	for depth := 0; depth < maxMIMEDepth+2; depth++ {
		boundary := fmt.Sprintf("level-%d", depth)
		raw.WriteString(fmt.Sprintf("Content-Type: multipart/mixed; boundary=%q\r\n\r\n--%s\r\n", boundary, boundary))
	}
	raw.WriteString("Content-Type: text/plain\r\n\r\ncontent beyond the supported depth\r\n")
	for depth := maxMIMEDepth + 1; depth >= 0; depth-- {
		raw.WriteString(fmt.Sprintf("--level-%d--\r\n", depth))
	}

	parsed, err := ParseEmail(strings.NewReader(raw.String()))
	require.NoError(t, err)
	require.True(t, parsed.Limited)
	require.Equal(t, UnavailableMailBody, parsed.BodyText)
	require.NotContains(t, parsed.BodyText, "content beyond")
}

func TestParseEmailRejectsExcessiveMIMEPartCountBeforeLegacyParsing(t *testing.T) {
	var raw strings.Builder
	raw.WriteString("From: sender@example.net\r\nTo: inbox@example.com\r\nSubject: many parts\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=many\r\n\r\n")
	for part := 0; part < maxMIMEParts; part++ {
		raw.WriteString("--many\r\nContent-Type: text/plain\r\n\r\npart content\r\n")
	}
	raw.WriteString("--many--\r\n")

	parsed, err := ParseEmail(strings.NewReader(raw.String()))
	require.NoError(t, err)
	require.True(t, parsed.Limited)
	require.Equal(t, UnavailableMailBody, parsed.BodyText)
	require.NotContains(t, parsed.BodyText, "part content")
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

package utils

import (
	"bytes"
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

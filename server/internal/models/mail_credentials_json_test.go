package models

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestMailPasswordsNeverSerializeIncludingRelationships(t *testing.T) {
	smtp := SMTPConfig{Password: "private-smtp-password", Host: "smtp.example.com"}
	imap := IMAPConfig{Password: "private-imap-password", Host: "imap.example.com"}
	for _, value := range []any{smtp, &smtp, imap, &imap, Email{SMTPConfig: &smtp}, []SMTPConfig{smtp}, []IMAPConfig{imap}} {
		raw, err := json.Marshal(value)
		require.NoError(t, err)
		require.NotContains(t, string(raw), "password")
		require.Contains(t, string(raw), "example.com")
	}
	require.Equal(t, "private-smtp-password", smtp.Password)
	require.Equal(t, "private-imap-password", imap.Password)
	var submittedSMTP SMTPConfig
	var submittedIMAP IMAPConfig
	require.NoError(t, json.Unmarshal([]byte(`{"password":"new-password"}`), &submittedSMTP))
	require.NoError(t, json.Unmarshal([]byte(`{"password":"new-password"}`), &submittedIMAP))
	require.Equal(t, "new-password", submittedSMTP.Password)
	require.Equal(t, "new-password", submittedIMAP.Password)
}

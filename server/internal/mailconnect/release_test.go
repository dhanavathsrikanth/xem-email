package mailconnect

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestGoogleMailReleaseRequiresExplicitAccess(t *testing.T) {
	t.Setenv("GOOGLE_MAIL_ACCESS", "")
	t.Setenv("GOOGLE_MAIL_TEST_USERS", "")
	require.False(t, GoogleMailAccess("tester@example.com"))
	t.Setenv("GOOGLE_MAIL_TEST_USERS", " Tester@example.com, second@example.com ")
	require.True(t, GoogleMailAccess("tester@example.com"))
	require.False(t, GoogleMailAccess("attacker@example.com"))
	t.Setenv("GOOGLE_MAIL_ACCESS", "disabled")
	require.False(t, GoogleMailAccess("tester@example.com"))
	t.Setenv("GOOGLE_MAIL_ACCESS", "public")
	require.True(t, GoogleMailAccess("any@example.com"))
}

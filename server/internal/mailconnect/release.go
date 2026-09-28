package mailconnect

import (
	"os"
	"strings"
)

// Credentials alone must not expose an unverified Gmail integration to every
// hosted user. Public release is an explicit operator action after Google's
// applicable verification. Self-hosters use their own consent application.
func GoogleMailAccess(address string) bool {
	switch os.Getenv("GOOGLE_MAIL_ACCESS") {
	case "public", "self-hosted":
		return true
	case "", "testing":
		for _, allowed := range strings.Split(os.Getenv("GOOGLE_MAIL_TEST_USERS"), ",") {
			if strings.TrimSpace(allowed) != "" && strings.EqualFold(strings.TrimSpace(allowed), strings.TrimSpace(address)) {
				return true
			}
		}
	}
	return false
}

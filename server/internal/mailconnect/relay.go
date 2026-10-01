package mailconnect

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
)

func RelaySecretAAD(teamID, relayID string) string {
	return fmt.Sprintf("xem:cloudflare-relay:%s:%s:secret", teamID, relayID)
}

func MailboxCanonical(method, pathQuery, timestamp, digest string) string {
	return strings.Join([]string{"v1", strings.ToUpper(method), pathQuery, timestamp, digest}, "\n")
}

func MailboxSignature(secret, canonical string) string {
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = h.Write([]byte(canonical))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

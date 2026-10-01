package mailconnect

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

// This known vector is shared byte-for-byte with the Cloudflare Worker tests.
func TestMailboxSignatureKnownVector(t *testing.T) {
	const (
		method    = "GET"
		pathQuery = "/v1/mailbox/emails?folder=INBOX&limit=20&offset=0"
		timestamp = "1790764200"
		digest    = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
		secret    = "xem-relay-fixture-secret-v1-2026"
		expected  = "XWjZdGs4iMkM5cG5Xzz4BHOyEP1N-n7gw_zXoFI9A2M"
	)
	canonical := MailboxCanonical(method, pathQuery, timestamp, digest)
	if got := MailboxSignature(secret, canonical); got != expected {
		t.Fatalf("signature = %q, want %q", got, expected)
	}
}

func TestMailboxRequestMatchesKnownVector(t *testing.T) {
	request, err := NewMailboxWorkerRequest(context.Background(), "https://mail.example.com", "xem-relay-fixture-secret-v1-2026", "GET", "/v1/mailbox/emails?folder=INBOX&limit=20&offset=0", nil, time.Unix(1790764200, 0))
	if err != nil {
		t.Fatal(err)
	}
	empty := sha256.Sum256(nil)
	if got := request.Header.Get("X-Xem-Mailbox-Content-SHA256"); got != hex.EncodeToString(empty[:]) {
		t.Fatalf("digest=%q", got)
	}
	if got := request.Header.Get("X-Xem-Mailbox-Signature"); got != "XWjZdGs4iMkM5cG5Xzz4BHOyEP1N-n7gw_zXoFI9A2M" {
		t.Fatalf("signature=%q", got)
	}
}

func TestValidateMailboxWorkerURLRejectsInternalDestinations(t *testing.T) {
	for _, raw := range []string{"http://mail.example.com", "https://127.0.0.1", "https://10.0.0.1", "https://100.64.0.1", "https://192.0.2.1", "https://[::1]", "https://mail.example.com/path", "https://user@mail.example.com"} {
		if _, err := ValidateMailboxWorkerURL(raw); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	if _, err := ValidateMailboxWorkerURL("https://mail.example.com"); err != nil {
		t.Fatal(err)
	}
}

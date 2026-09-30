package mailconnect

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const MailboxResponseLimit int64 = 12 * 1024 * 1024

func ValidateMailboxWorkerURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("worker URL must be an HTTPS origin")
	}
	if port := u.Port(); port != "" && port != "443" {
		return nil, errors.New("worker URL must use HTTPS port 443")
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && !publicIP(ip) {
		return nil, errors.New("worker URL must resolve publicly")
	}
	u.Path = ""
	u.RawPath = ""
	return u, nil
}

func publicIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() {
		return false
	}
	for _, raw := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32"} {
		if netip.MustParsePrefix(raw).Contains(addr) {
			return false
		}
	}
	return true
}

func newMailboxHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{Proxy: nil, ForceAttemptHTTP2: true, ResponseHeaderTimeout: 10 * time.Second, DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if publicIP(ip) {
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			}
		}
		return nil, errors.New("worker URL resolved to a non-public address")
	}}
	return &http.Client{Timeout: 15 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

var hardenedMailboxHTTPClient = newMailboxHTTPClient()

func NewMailboxWorkerRequest(ctx context.Context, baseURL, secret, method, pathQuery string, body []byte, now time.Time) (*http.Request, error) {
	base, err := ValidateMailboxWorkerURL(baseURL)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(pathQuery, "/v1/mailbox/") || strings.ContainsAny(pathQuery, "\r\n") {
		return nil, errors.New("invalid mailbox API path")
	}
	digestBytes := sha256.Sum256(body)
	digest := hex.EncodeToString(digestBytes[:])
	timestamp := strconv.FormatInt(now.Unix(), 10)
	req, err := http.NewRequestWithContext(ctx, method, base.String()+pathQuery, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Xem-Mailbox-Timestamp", timestamp)
	req.Header.Set("X-Xem-Mailbox-Content-SHA256", digest)
	req.Header.Set("X-Xem-Mailbox-Signature", MailboxSignature(secret, MailboxCanonical(method, pathQuery, timestamp, digest)))
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

func DoMailboxWorkerRequest(ctx context.Context, baseURL, secret, method, pathQuery string, body []byte) ([]byte, int, error) {
	req, err := NewMailboxWorkerRequest(ctx, baseURL, secret, method, pathQuery, body, time.Now())
	if err != nil {
		return nil, 0, err
	}
	response, err := hardenedMailboxHTTPClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("mailbox worker request failed: %w", err)
	}
	defer response.Body.Close()
	limit := int64(64 * 1024)
	if strings.HasPrefix(pathQuery, "/v1/mailbox/emails?") {
		limit = 5 * 1024 * 1024
	}
	if strings.HasPrefix(pathQuery, "/v1/mailbox/message?") {
		limit = MailboxResponseLimit
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, response.StatusCode, err
	}
	if int64(len(raw)) > limit {
		return nil, response.StatusCode, errors.New("mailbox worker response is too large")
	}
	return raw, response.StatusCode, nil
}

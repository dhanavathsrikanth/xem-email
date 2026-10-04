package ai

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type GatewayProvider struct{ BaseURL, APIKey, Model string }
type Gateway struct {
	Secret            string
	Primary, Fallback GatewayProvider
	Client            *http.Client
}

func NewGateway(secret string, primary, fallback GatewayProvider) (*Gateway, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("AI gateway requires a secret of at least 32 characters")
	}
	for _, p := range []GatewayProvider{primary, fallback} {
		u, err := url.Parse(p.BaseURL)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || p.APIKey == "" || p.Model == "" {
			return nil, fmt.Errorf("AI primary and fallback require HTTPS endpoints, keys and model IDs")
		}
	}
	return &Gateway{secret, primary, fallback, &http.Client{Timeout: 90 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 40 * time.Second, IdleConnTimeout: 90 * time.Second}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// Fallback happens before any response is streamed, so the assistant cannot
// repeat a tool action after partial output. Provider keys remain server-only.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+g.Secret)) != 1 {
		http.Error(w, "Unauthorized", 401)
		return
	}
	if r.Method != "POST" {
		w.Header().Set("Allow", "POST")
		http.Error(w, "Method not allowed", 405)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 512*1024+1))
	if err != nil || len(raw) > 512*1024 {
		http.Error(w, "AI request too large", 413)
		return
	}
	var payload map[string]interface{}
	if json.Unmarshal(raw, &payload) != nil || payload["messages"] == nil {
		http.Error(w, "Invalid AI request", 400)
		return
	}
	var response *http.Response
	for i, p := range []GatewayProvider{g.Primary, g.Fallback} {
		if r.Context().Err() != nil {
			return
		}
		payload["model"] = p.Model
		if i == 1 {
			delete(payload, "extra_body")
			delete(payload, "reasoning_effort")
		}
		body, e := json.Marshal(payload)
		if e != nil {
			http.Error(w, "Invalid AI request", 400)
			return
		}
		req, e := http.NewRequestWithContext(r.Context(), "POST", strings.TrimRight(p.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
		if e != nil {
			http.Error(w, "AI configuration unavailable", 503)
			return
		}
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
		req.Header.Set("Content-Type", "application/json")
		response, err = g.Client.Do(req)
		if err == nil && response.StatusCode == 200 {
			break
		}
		if err == nil {
			status := response.StatusCode
			response.Body.Close()
			response = nil
			if status != 429 && status < 500 {
				http.Error(w, "AI provider rejected this request", 502)
				return
			}
		}
	}
	if response == nil || err != nil {
		http.Error(w, "AI providers unavailable or quota exceeded", 503)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	w.WriteHeader(200)
	buffer := make([]byte, 16*1024)
	for {
		n, e := response.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				return
			}
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
		if e != nil {
			return
		}
	}
}

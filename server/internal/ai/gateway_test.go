package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGatewayFallbackKeepsPayloadAndUsesSeparateCredential(t *testing.T) {
	primaryCalls, fallbackCalls := 0, 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path == "/primary/chat/completions" {
			primaryCalls++
			if r.Header.Get("Authorization") != "Bearer primary-key" || body["model"] != "gemini" {
				t.Error("wrong primary configuration")
			}
			w.WriteHeader(429)
			return
		}
		fallbackCalls++
		if r.Header.Get("Authorization") != "Bearer fallback-key" || body["model"] != "deepseek:free" || body["stream"] != true || body["tools"] == nil {
			t.Error("fallback lost tools, stream or changed credential incorrectly")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()
	g, err := NewGateway(strings.Repeat("x", 32), GatewayProvider{server.URL + "/primary", "primary-key", "gemini"}, GatewayProvider{server.URL + "/fallback", "fallback-key", "deepseek:free"})
	if err != nil {
		t.Fatal(err)
	}
	g.Client = server.Client()
	r := httptest.NewRequest("POST", "/internal/ai/chat/completions", strings.NewReader(`{"messages":[{"role":"user","content":"test"}],"tools":[],"stream":true}`))
	r.Header.Set("Authorization", "Bearer "+g.Secret)
	w := httptest.NewRecorder()
	g.ServeHTTP(w, r)
	if w.Code != 200 || w.Body.String() != "data: [DONE]\n\n" || primaryCalls != 1 || fallbackCalls != 1 {
		t.Fatalf("unexpected fallback result: %d %d %d", w.Code, primaryCalls, fallbackCalls)
	}
}

func TestGatewayRejectsUnauthenticatedRequestsBeforeProviderCall(t *testing.T) {
	g, _ := NewGateway(strings.Repeat("x", 32), GatewayProvider{"https://primary.example/v1", "key", "model"}, GatewayProvider{"https://fallback.example/v1", "key", "model:free"})
	w := httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest("POST", "/", strings.NewReader(`{}`)))
	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

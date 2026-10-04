package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompatibleGatewayCompletionPreservesContextAndTokenLimit(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Error("incorrect endpoint or authentication")
		}
		var input struct {
			Model     string    `json:"model"`
			Messages  []Message `json:"messages"`
			MaxTokens int       `json:"max_tokens"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || input.Model != "fixture-model" || input.MaxTokens != 128 || len(input.Messages) != 2 || input.Messages[0].Role != "system" || input.Messages[0].Content != "Stay scoped" {
			t.Error("prompt configuration was lost")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}],"usage":{"total_tokens":4}}`))
	}))
	defer server.Close()
	client, err := NewOpenAICompatibleClient(server.URL+"/v1", "fixture-key", "fixture-model")
	if err != nil {
		t.Fatal(err)
	}
	client.httpClient = server.Client()
	result, err := client.Complete(context.Background(), CompletionRequest{Prompt: "Test", SystemPrompt: "Stay scoped", MaxTokens: 128})
	if err != nil || result.Content != "OK" || result.TokensUsed != 4 || result.Model != "fixture-model" {
		t.Fatalf("unexpected completion: %v %v", result, err)
	}
}

func TestCompatibleGatewayRejectsUnsafeURLAndProviderFailure(t *testing.T) {
	for _, endpoint := range []string{"http://example.com/v1", "https://key@example.com/v1", "https://example.com/v1?key=secret"} {
		if _, err := NewOpenAICompatibleClient(endpoint, "key", "model"); err == nil {
			t.Fatalf("accepted unsafe endpoint %s", endpoint)
		}
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		w.Write([]byte(`{"error":"private upstream details"}`))
	}))
	defer server.Close()
	client, _ := NewOpenAICompatibleClient(server.URL, "key", "model")
	client.httpClient = server.Client()
	if _, err := client.CompleteWithMessages(context.Background(), []Message{{Role: "user", Content: "test"}}, 128); err == nil || err.Error() != "AI gateway returned HTTP 429" {
		t.Fatalf("unexpected provider error: %v", err)
	}
}

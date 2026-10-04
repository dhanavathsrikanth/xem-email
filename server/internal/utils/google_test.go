package utils

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGoogleUserInfoRejectsInvalidTokenAndKeepsTokenOutOfURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("Google token must be in the authorization header")
		}
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"invalid_token"}`))
	}))
	defer server.Close()
	if _, err := getGoogleUserData(server.Client(), server.URL, "test-token"); err == nil {
		t.Fatal("invalid tokens must fail before account handling")
	}
}

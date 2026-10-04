package api

import (
	"github.com/labstack/echo/v4"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMCPProxyPreservesCredentialAndPublicHost(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mcp" || r.Host != "api.example.com" || r.Header.Get("Authorization") != "Bearer fixture-grant" {
			t.Error("MCP credential, path or public host lost")
		}
		w.WriteHeader(401)
	}))
	defer upstream.Close()
	h, err := mcpProxy(upstream.URL, "https://api.example.com")
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/mcp", nil)
	r.Header.Set("Authorization", "Bearer fixture-grant")
	w := httptest.NewRecorder()
	if err = h(echo.New().NewContext(r, w)); err != nil || w.Code != 401 {
		t.Fatalf("MCP response changed: %d %v", w.Code, err)
	}
}

func TestMCPProxyRejectsInvalidServiceOrigin(t *testing.T) {
	for _, endpoint := range []string{"file:///etc/passwd", "http://user:secret@service:3000", "http://service:3000/mcp", "http://service:3000?target=other"} {
		if _, err := mcpProxy(endpoint, "https://api.example.com"); err == nil {
			t.Fatalf("accepted invalid service origin %s", endpoint)
		}
	}
}

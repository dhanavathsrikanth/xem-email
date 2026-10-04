package routes

import (
	"github.com/labstack/echo/v4"
	"kori/internal/api/middleware"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSubscriptionReadRoutesRequireAuthentication(t *testing.T) {
	e := echo.New()
	api := e.Group("/api/v1")
	api.Use(middleware.NewAuthMiddleware("test-only-secret").Middleware())
	SetupSubscriptionReadRoutes(api, nil)
	for _, path := range []string{"/api/v1/plans", "/api/v1/subscriptions"} {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s: status %d, want 401", path, rec.Code)
		}
	}
	// Read-only configuration must not activate purchase or unverified webhook routes.
	for _, route := range e.Routes() {
		if route.Method == http.MethodPost && (route.Path == "/api/v1/subscriptions" || route.Path == "/api/v1/subscriptions/webhook") {
			t.Fatalf("unexpectedly enabled payment route: %s", route.Path)
		}
	}
}

package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"kori/internal/config"
)

func billingTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { sqlDB.Close() })
	return db
}

func TestBillingEmptyPlansUseExistingColumns(t *testing.T) {
	db := billingTestDB(t)
	db.Exec("CREATE TABLE products (id TEXT, is_deleted BOOLEAN)")
	db.Exec("INSERT INTO products VALUES (?, ?)", "deleted-product", true)
	e := echo.New()
	rec := httptest.NewRecorder()
	c := e.NewContext(httptest.NewRequest(http.MethodGet, "/plans", nil), rec)
	if err := NewSubscriptionHandler(db).GetPlans(c); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var data map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &data)
	if plans, ok := data["plans"].([]interface{}); !ok || len(plans) != 0 {
		t.Fatalf("expected empty array: %s", rec.Body)
	}
}

func TestBillingDatabaseFailureIsNotMissingSubscription(t *testing.T) {
	db := billingTestDB(t) // No subscriptions table: deliberately simulate a database failure.
	e := echo.New()
	rec := httptest.NewRecorder()
	c := e.NewContext(httptest.NewRequest(http.MethodGet, "/subscriptions", nil), rec)
	c.Set("teamID", "workspace")
	NewSubscriptionHandler(db).GetSubscription(c)
	if rec.Code != 500 {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestAIScopedResourcesRejectOtherWorkspaceBeforeModelCall(t *testing.T) {
	db := billingTestDB(t)
	for _, table := range []string{"campaigns", "automations"} {
		db.Exec("CREATE TABLE " + table + " (id TEXT, team_id TEXT, is_deleted BOOLEAN)")
		db.Exec("INSERT INTO "+table+" VALUES (?, ?, ?)", "11111111-1111-4111-8111-111111111111", "other-workspace", false)
	}
	cfg := &config.Config{}
	cfg.AI.Enabled = true
	h := NewAIHandler(db, nil, cfg) // A model call would panic: rejected requests must never reach it.
	for _, tc := range []struct {
		path, body string
		handler    echo.HandlerFunc
	}{
		{"/ai/query", `{"query":"Show stats","scope":{"campaignId":"11111111-1111-4111-8111-111111111111"}}`, h.QueryAnalytics},
		{"/ai/optimize", `{"automationId":"11111111-1111-4111-8111-111111111111"}`, h.OptimizeAutomation},
	} {
		t.Run(tc.path, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			c := e.NewContext(req, httptest.NewRecorder())
			c.Set("teamID", "current-workspace")
			err := tc.handler(c)
			if httpErr, ok := err.(*echo.HTTPError); !ok || httpErr.Code != 404 {
				t.Fatalf("expected 404, got %v", err)
			}
		})
	}
}

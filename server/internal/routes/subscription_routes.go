package routes

import (
	"os"

	"kori/internal/api/middleware"
	"kori/internal/handlers"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// Read-only billing is available independently of the unfinished payment flow.
// The caller supplies the authenticated API group.
func SetupSubscriptionReadRoutes(api *echo.Group, db *gorm.DB) {
	handler := handlers.NewSubscriptionHandler(db)
	api.GET("/plans", handler.GetPlans)
	api.GET("/subscriptions", handler.GetSubscription)
}

func SetupSubscriptionRoutes(e *echo.Echo, db *gorm.DB) {
	subscriptionHandler := handlers.NewSubscriptionHandler(db)
	authMiddleware := middleware.NewAuthMiddleware(os.Getenv("JWT_SECRET"))

	base := e.Group("/api/v1")

	// Public plans routes
	plans := base.Group("/plans")
	plans.GET("", subscriptionHandler.GetPlans)

	// Public subscription routes
	subscriptions := base.Group("/subscriptions")
	subscriptions.POST("/webhook", subscriptionHandler.HandleWebhook)

	// Protected subscription routes
	protected := subscriptions.Group("")
	protected.Use(authMiddleware.Middleware())
	protected.POST("", subscriptionHandler.CreateSubscription)
	protected.GET("", subscriptionHandler.GetSubscription)
	protected.GET("/portal", subscriptionHandler.GetManagementPortal)
	protected.GET("/features", subscriptionHandler.GetFeatures)
}

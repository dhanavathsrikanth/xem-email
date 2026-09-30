package routes

import (
	"github.com/labstack/echo/v4"
	echoMiddleware "github.com/labstack/echo/v4/middleware"
	"gorm.io/gorm"
	"kori/internal/api/middleware"
	"kori/internal/config"
	"kori/internal/handlers"
)

func SetupMailConnectionRoutes(e *echo.Echo, cfg *config.Config, db *gorm.DB) {
	h := &handlers.MailConnectionsHandler{DB: db}
	relays := handlers.NewCloudflareRelaysHandler(db, cfg)
	g := e.Group("/api/v1/mail-connections", echoMiddleware.BodyLimit("16K"), middleware.NewAuthMiddleware(cfg.JWT.Secret).Middleware())
	g.GET("/mailboxes", h.Mailboxes, middleware.RequirePermissions(db, "imap_configs:read"))
	g.GET("/senders", h.Senders, middleware.RequirePermissions(db, "smtp_configs:read"))
	g.GET("", h.List, handlers.MailConnectionAdmin)
	g.POST("/google/start", h.GoogleStart, handlers.MailConnectionAdmin)
	g.POST("/google/complete", h.GoogleComplete, handlers.MailConnectionAdmin)
	g.POST("/cloudflare", h.CloudflareCreate, handlers.MailConnectionAdmin)
	g.GET("/cloudflare-relays", relays.List, handlers.MailConnectionAdmin)
	g.POST("/cloudflare-relays", relays.Create, handlers.MailConnectionAdmin)
	g.GET("/cloudflare-relays/:id", relays.Get, handlers.MailConnectionAdmin)
	g.POST("/cloudflare-relays/:id/test", relays.Test, handlers.MailConnectionAdmin)
	g.POST("/cloudflare-relays/:id/secret", relays.RotateSecret, handlers.MailConnectionAdmin)
	g.DELETE("/cloudflare-relays/:id", relays.Delete, handlers.MailConnectionAdmin)
	g.DELETE("/:id", h.Disconnect, handlers.MailConnectionAdmin)
}

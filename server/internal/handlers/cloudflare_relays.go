package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/lib/pq"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"kori/internal/config"
	"kori/internal/mailconnect"
	"kori/internal/models"
	"kori/internal/utils/crypto"
)

type CloudflareRelaysHandler struct{ DB *gorm.DB }
type cloudflareRelayView struct {
	ID        string `json:"id"`
	MailboxID string `json:"mailboxId"`
	Address   string `json:"address"`
	WorkerURL string `json:"workerUrl"`
	Enabled   bool   `json:"enabled"`
}

var doMailboxWorkerRequest = mailconnect.DoMailboxWorkerRequest

func NewCloudflareRelaysHandler(db *gorm.DB, _ *config.Config) *CloudflareRelaysHandler {
	return &CloudflareRelaysHandler{DB: db}
}
func relayView(row models.CloudflareRelay) cloudflareRelayView {
	return cloudflareRelayView{row.ID, row.IMAPConfigID, row.Address, row.WorkerURL, row.Enabled}
}

func relayConflict(err error) bool {
	if err == nil {
		return false
	}
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "23505" || strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}

func validateWorkerMailbox(c echo.Context, workerURL, address, secret string) (string, string, error) {
	worker, err := mailconnect.ValidateMailboxWorkerURL(strings.TrimSpace(workerURL))
	if err != nil {
		return "", "", echo.NewHTTPError(400, err.Error())
	}
	parsed, err := mail.ParseAddress(strings.TrimSpace(address))
	if err != nil || parsed.Address != strings.TrimSpace(address) {
		return "", "", echo.NewHTTPError(400, "Enter a valid mailbox address")
	}
	address = strings.ToLower(parsed.Address)
	if len(secret) < 32 || len(secret) > 4096 || strings.ContainsAny(secret, "\r\n") {
		return "", "", echo.NewHTTPError(400, "Mailbox API secret must be between 32 and 4096 characters")
	}
	raw, status, err := doMailboxWorkerRequest(c.Request().Context(), worker.String(), secret, http.MethodGet, "/v1/mailbox/identity", nil)
	if err != nil {
		return "", "", echo.NewHTTPError(502, "Unable to reach mailbox Worker")
	}
	if status == 401 || status == 403 {
		return "", "", echo.NewHTTPError(400, "Mailbox Worker rejected the API secret")
	}
	if status != 200 {
		return "", "", echo.NewHTTPError(502, "Mailbox Worker identity check failed")
	}
	var identity struct {
		Version int    `json:"version"`
		Address string `json:"address"`
	}
	if len(raw) > 4096 || json.Unmarshal(raw, &identity) != nil || identity.Version != 1 || !strings.EqualFold(identity.Address, address) {
		return "", "", echo.NewHTTPError(400, "Mailbox Worker address does not match the configured address")
	}
	return worker.String(), address, nil
}

func (h *CloudflareRelaysHandler) Create(c echo.Context) error {
	var input struct {
		WorkerURL string `json:"workerUrl"`
		Address   string `json:"address"`
		Secret    string `json:"secret"`
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 16*1024)
	if c.Bind(&input) != nil {
		return echo.NewHTTPError(400, "Worker URL, mailbox address, and API secret are required")
	}
	workerURL, address, err := validateWorkerMailbox(c, input.WorkerURL, input.Address, input.Secret)
	if err != nil {
		return err
	}
	row := models.CloudflareRelay{Base: models.Base{ID: uuid.NewString()}, TeamID: c.Get("teamID").(string), Address: address, WorkerURL: workerURL, IMAPConfigID: uuid.NewString(), Enabled: true}
	row.Secret, err = crypto.SealSecret([]byte(input.Secret), mailconnect.RelaySecretAAD(row.TeamID, row.ID))
	if err != nil {
		return echo.NewHTTPError(500, "Unable to protect mailbox credential")
	}
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		u, _ := url.Parse(workerURL)
		mailbox := models.IMAPConfig{Base: models.Base{ID: row.IMAPConfigID}, Host: u.Hostname(), Port: 443, Username: address, IsActive: true, TeamID: row.TeamID}
		if err := tx.Session(&gorm.Session{SkipHooks: true}).Create(&mailbox).Error; err != nil {
			return err
		}
		return tx.Create(&row).Error
	})
	if relayConflict(err) {
		return echo.NewHTTPError(409, "A mailbox connection for this address already exists")
	}
	if err != nil {
		return echo.NewHTTPError(500, "Unable to save mailbox connection")
	}
	return c.JSON(201, relayView(row))
}
func (h *CloudflareRelaysHandler) List(c echo.Context) error {
	var rows []models.CloudflareRelay
	if err := h.DB.Where("team_id = ?", c.Get("teamID")).Order("created_at DESC").Find(&rows).Error; err != nil {
		return echo.NewHTTPError(500, "Unable to load mailbox connections")
	}
	views := make([]cloudflareRelayView, 0, len(rows))
	for _, r := range rows {
		views = append(views, relayView(r))
	}
	return c.JSON(200, map[string]any{"relays": views})
}
func (h *CloudflareRelaysHandler) Get(c echo.Context) error {
	var row models.CloudflareRelay
	err := h.DB.Where("id = ? AND team_id = ?", c.Param("id"), c.Get("teamID")).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Mailbox connection not found")
	}
	if err != nil {
		return echo.NewHTTPError(500, "Unable to load mailbox connection")
	}
	return c.JSON(200, relayView(row))
}

func (h *CloudflareRelaysHandler) Test(c echo.Context) error {
	var row models.CloudflareRelay
	err := h.DB.Where("id = ? AND team_id = ? AND enabled = true", c.Param("id"), c.Get("teamID")).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Mailbox connection not found")
	}
	if err != nil {
		return echo.NewHTTPError(500, "Unable to load mailbox connection")
	}
	secret, err := crypto.OpenSecret(row.Secret, mailconnect.RelaySecretAAD(row.TeamID, row.ID))
	if err != nil {
		return echo.NewHTTPError(500, "Unable to open mailbox credential")
	}
	if _, _, err := validateWorkerMailbox(c, row.WorkerURL, row.Address, string(secret)); err != nil {
		return err
	}
	return c.JSON(200, map[string]string{"status": "connected"})
}
func (h *CloudflareRelaysHandler) RotateSecret(c echo.Context) error {
	var input struct {
		Secret string `json:"secret"`
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 8*1024)
	if c.Bind(&input) != nil {
		return echo.NewHTTPError(400, "Mailbox API secret is required")
	}
	var row models.CloudflareRelay
	if err := h.DB.Where("id = ? AND team_id = ?", c.Param("id"), c.Get("teamID")).First(&row).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Mailbox connection not found")
	} else if err != nil {
		return echo.NewHTTPError(500, "Unable to load mailbox connection")
	}
	if _, _, err := validateWorkerMailbox(c, row.WorkerURL, row.Address, input.Secret); err != nil {
		return err
	}
	sealed, err := crypto.SealSecret([]byte(input.Secret), mailconnect.RelaySecretAAD(row.TeamID, row.ID))
	if err != nil {
		return echo.NewHTTPError(500, "Unable to protect mailbox credential")
	}
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND team_id = ?", row.ID, row.TeamID).First(&row).Error; err != nil {
			return err
		}
		row.Secret = sealed
		row.Enabled = true
		if err := tx.Model(&row).Updates(map[string]any{"secret": sealed, "enabled": true}).Error; err != nil {
			return err
		}
		return tx.Model(&models.IMAPConfig{}).Where("id = ? AND team_id = ?", row.IMAPConfigID, row.TeamID).UpdateColumn("is_active", true).Error
	})
	if err != nil {
		return echo.NewHTTPError(500, "Unable to rotate mailbox credential")
	}
	return c.JSON(200, relayView(row))
}
func (h *CloudflareRelaysHandler) Delete(c echo.Context) error {
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var row models.CloudflareRelay
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND team_id = ?", c.Param("id"), c.Get("teamID")).First(&row).Error; err != nil {
			return err
		}
		if err := tx.Model(&row).Updates(map[string]any{"enabled": false, "secret": ""}).Error; err != nil {
			return err
		}
		return tx.Model(&models.IMAPConfig{}).Where("id = ? AND team_id = ?", row.IMAPConfigID, row.TeamID).UpdateColumn("is_active", false).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Mailbox connection not found")
	}
	if err != nil {
		return echo.NewHTTPError(500, "Unable to remove mailbox connection")
	}
	return c.NoContent(204)
}

// mailcheck runs the real mail API and workers against a dedicated local
// database. Storage uploads and marketing automation are intentionally absent.
// Every delivery is restricted to MAILCHECK_RECIPIENT, including CC and BCC.
package main

import (
	"context"
	"fmt"
	"log"
	"net/mail"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"kori/internal/api"
	"kori/internal/config"
	"kori/internal/db"
	"kori/internal/services"
	"kori/internal/tasks"
	"kori/internal/utils"
	"kori/internal/utils/crypto"
	"kori/internal/utils/logger"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	recipient, err := mail.ParseAddress(os.Getenv("MAILCHECK_RECIPIENT"))
	if err != nil || recipient.Address != os.Getenv("MAILCHECK_RECIPIENT") {
		log.Fatal("MAILCHECK_RECIPIENT must be an address you control")
	}
	if cfg.Database.Host != "127.0.0.1" || !strings.HasPrefix(cfg.Database.Name, "xem_mailcheck_") || !strings.HasPrefix(cfg.Redis.Addr, "127.0.0.1:") || len(cfg.JWT.Secret) < 32 {
		log.Fatal("mailcheck requires a local xem_mailcheck_ database, local Redis, and a random JWT_SECRET of at least 32 characters")
	}
	cfg.Server.Host = "127.0.0.1"
	if err := crypto.InitializeKeys(cfg.Crypto.PrivateKey); err != nil {
		log.Fatal(err)
	}
	if err := db.Connect(cfg); err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	services.Initialize(cfg)
	utils.RecipientPolicy = func(_ string, recipients []string) error {
		for _, raw := range recipients {
			address, err := mail.ParseAddress(raw)
			if err != nil || !strings.EqualFold(address.Address, recipient.Address) {
				return fmt.Errorf("local mailcheck only sends to its configured test recipient")
			}
		}
		return nil
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	logger := logger.New("mailcheck")
	handler := tasks.NewTaskHandler(db.DB, cfg)
	worker := tasks.NewServer(cfg.Redis.Addr, cfg.Redis.Username, cfg.Redis.Password, cfg.Redis.DB, cfg.Redis.UseTLS, handler, logger)
	go func() {
		if err := worker.Start(ctx); err != nil {
			log.Printf("worker stopped: %v", err)
		}
	}()
	scheduler := tasks.NewScheduler(cfg.Redis.Addr, cfg.Redis.Username, cfg.Redis.Password, cfg.Redis.DB, logger, cfg.Redis.UseTLS)
	go func() {
		if err := scheduler.Start(); err != nil {
			log.Printf("scheduler stopped: %v", err)
		}
	}()
	server := api.NewServer(cfg, db.DB)
	go func() {
		if err := server.Start(); err != nil {
			log.Printf("API stopped: %v", err)
			cancel()
		}
	}()
	log.Printf("Local mailcheck: http://127.0.0.1:%d; real sends are restricted to %s", cfg.Server.Port, recipient.Address)
	<-ctx.Done()
	scheduler.Stop()
	worker.Shutdown()
	shutdown, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	_ = server.Shutdown(shutdown)
}

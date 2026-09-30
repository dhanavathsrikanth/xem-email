package models

import (
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSeedSuperAdminSystemTemplatesPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{DisableForeignKeyConstraintWhenMigrating: true})
	require.NoError(t, err)
	tx := db.Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { require.NoError(t, tx.Rollback().Error) })
	schema := "test_system_templates_" + uuid.NewString()[:8]
	quotedSchema := pq.QuoteIdentifier(schema)
	require.NoError(t, tx.Exec("CREATE SCHEMA "+quotedSchema).Error)
	require.NoError(t, tx.Exec("SET LOCAL search_path = "+quotedSchema).Error)
	require.NoError(t, tx.AutoMigrate(&User{}, &EmailCategory{}, &Template{}))
	teamID, userID := uuid.NewString(), uuid.NewString()
	require.NoError(t, tx.Session(&gorm.Session{SkipHooks: true}).Create(&User{Base: Base{ID: userID}, TeamID: teamID, Email: "root-" + userID + "@example.com", Role: UserRoleSuperAdmin}).Error)
	require.NoError(t, SeedSuperAdminSystemTemplates(tx))
	require.NoError(t, SeedSuperAdminSystemTemplates(tx))
	var count int64
	require.NoError(t, tx.Model(&Template{}).Where("team_id = ? AND is_deleted = false", teamID).Count(&count).Error)
	require.EqualValues(t, 18, count)
	var row Template
	require.NoError(t, tx.Where("team_id = ? AND starter_key = ?", teamID, "xem-welcome").First(&row).Error)
	require.NotEmpty(t, row.Variables)
	require.NotEmpty(t, row.DesignJSON)
	require.NotEmpty(t, row.HTMLBody)
}

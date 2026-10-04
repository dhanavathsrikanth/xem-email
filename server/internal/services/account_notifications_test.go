package services

import (
	"os"
	"testing"
)

func TestExplicitServiceNotificationSettingDisablesLegacyDelivery(t *testing.T) {
	for _, value := range []string{"false", "true", ""} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("SERVICE_NOTIFICATIONS_ENABLED", value)
			if legacyAccountEmailsEnabled() {
				t.Fatal("explicit settings must not fall back to legacy SMTP")
			}
		})
	}
}

func TestUnsetServiceNotificationSettingPreservesLegacyDelivery(t *testing.T) {
	t.Setenv("SERVICE_NOTIFICATIONS_ENABLED", "")
	if err := os.Unsetenv("SERVICE_NOTIFICATIONS_ENABLED"); err != nil {
		t.Fatal(err)
	}
	if !legacyAccountEmailsEnabled() {
		t.Fatal("older installations retain their legacy account-email behavior")
	}
}

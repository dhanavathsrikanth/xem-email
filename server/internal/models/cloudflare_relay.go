package models

// CloudflareRelay connects an existing customer-owned mailbox Worker. Xem
// stores only encrypted API credentials; messages remain in customer R2/D1.
type CloudflareRelay struct {
	Base
	TeamID       string `gorm:"type:uuid;not null;index;uniqueIndex:idx_cf_relay_team_address" json:"-"`
	Address      string `gorm:"not null;uniqueIndex:idx_cf_relay_team_address" json:"address"`
	WorkerURL    string `gorm:"not null" json:"workerUrl"`
	IMAPConfigID string `gorm:"type:uuid;not null;uniqueIndex" json:"mailboxId"`
	Enabled      bool   `gorm:"not null;default:true" json:"enabled"`
	Secret       string `gorm:"type:text" json:"-"`
}

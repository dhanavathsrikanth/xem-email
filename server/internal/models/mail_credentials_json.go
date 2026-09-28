package models

import "encoding/json"

// Passwords remain accepted on input, but never leave the server through a
// settings response, a relationship preload, or an error's JSON model.
func (s SMTPConfig) MarshalJSON() ([]byte, error) {
	type plain SMTPConfig
	return json.Marshal(struct {
		plain
		Password *string `json:"password,omitempty"`
	}{plain: plain(s)})
}

func (s IMAPConfig) MarshalJSON() ([]byte, error) {
	type plain IMAPConfig
	return json.Marshal(struct {
		plain
		Password *string `json:"password,omitempty"`
	}{plain: plain(s)})
}

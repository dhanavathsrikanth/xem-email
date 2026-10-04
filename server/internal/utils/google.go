package utils

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

const oauthGoogleUrlAPI = "https://www.googleapis.com/oauth2/v2/userinfo"

func GetUserDataFromGoogle(accessToken string) ([]byte, error) {

	return getGoogleUserData(&http.Client{Timeout: 15 * time.Second}, oauthGoogleUrlAPI, accessToken)
}

func getGoogleUserData(client *http.Client, endpoint, accessToken string) ([]byte, error) {
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("invalid Google user info endpoint")
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Google user info unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Google rejected access token")
	}
	contents, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if len(contents) > 64*1024 {
		return nil, fmt.Errorf("Google user info too large")
	}
	if err != nil {
		return nil, fmt.Errorf("failed read response: %s", err.Error())
	}

	return contents, nil
}

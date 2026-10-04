package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// OpenAICompatibleClient lets analytics and workflow AI use the same gateway
// as the dashboard assistant and content editors.
type OpenAICompatibleClient struct {
	endpoint, apiKey, model string
	httpClient              *http.Client
}

func NewOpenAICompatibleClient(endpoint, apiKey, model string) (*OpenAICompatibleClient, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.TrimSpace(apiKey) == "" || strings.TrimSpace(model) == "" {
		return nil, fmt.Errorf("AI gateway requires an HTTPS base URL, API key and model")
	}
	return &OpenAICompatibleClient{strings.TrimRight(endpoint, "/"), apiKey, model, &http.Client{
		Timeout:       90 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func (c *OpenAICompatibleClient) Complete(ctx context.Context, in CompletionRequest) (*CompletionResponse, error) {
	messages := []Message{}
	if in.SystemPrompt != "" {
		messages = append(messages, Message{Role: "system", Content: in.SystemPrompt})
	}
	messages = append(messages, Message{Role: "user", Content: in.Prompt})
	return c.complete(ctx, messages, in.MaxTokens, in.Temperature, in.StopSequences)
}

func (c *OpenAICompatibleClient) CompleteWithMessages(ctx context.Context, messages []Message, maxTokens int) (*CompletionResponse, error) {
	return c.complete(ctx, messages, maxTokens, 0, nil)
}

func (c *OpenAICompatibleClient) complete(ctx context.Context, messages []Message, maxTokens int, temperature float64, stop []string) (*CompletionResponse, error) {
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	payload := map[string]interface{}{"model": c.model, "messages": messages, "max_tokens": maxTokens}
	if temperature != 0 {
		payload["temperature"] = temperature
	}
	if len(stop) > 0 {
		payload["stop"] = stop
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("AI gateway unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("AI gateway returned HTTP %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 1024*1024+1))
	if err != nil || len(data) > 1024*1024 {
		return nil, fmt.Errorf("invalid AI gateway response")
	}
	var result struct {
		Model   string `json:"model"`
		Choices []struct {
			Message      Message `json:"message"`
			FinishReason string  `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			TotalTokens int `json:"total_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(data, &result) != nil || len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" || result.Choices[0].FinishReason == "length" {
		return nil, fmt.Errorf("AI gateway returned an empty or incomplete completion")
	}
	if result.Model == "" {
		result.Model = c.model
	}
	choice := result.Choices[0]
	return &CompletionResponse{Content: choice.Message.Content, StopReason: choice.FinishReason, FinishReason: choice.FinishReason, TokensUsed: result.Usage.TotalTokens, Model: result.Model}, nil
}

func (c *OpenAICompatibleClient) Stream(ctx context.Context, in CompletionRequest) (<-chan StreamChunk, error) {
	chunks := make(chan StreamChunk, 1)
	go func() {
		defer close(chunks)
		result, err := c.Complete(ctx, in)
		if err != nil {
			chunks <- StreamChunk{Error: err, Done: true}
			return
		}
		chunks <- StreamChunk{Content: result.Content, Done: true}
	}()
	return chunks, nil
}

func (c *OpenAICompatibleClient) GetModel() string { return c.model }

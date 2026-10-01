package utils

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"time"

	"github.com/DusanKasan/parsemail"
	"golang.org/x/net/html/charset"
)

// EmailAttachment represents a single attachment in an email.
type EmailAttachment struct {
	Filename     string // The original filename of the attachment.
	Data         []byte // The raw byte data of the attachment.
	MIMEType     string // The MIME type of the attachment (e.g., "application/pdf").
	Size         int64
	AttachmentID string
}

// ParsedMail represents the structured data extracted from an email.
type ParsedMail struct {
	BodyText      string                   // Plain text version of the email body.
	BodyHTML      string                   // HTML version of the email body.
	ReplyTo       []*mail.Address          // List of Reply-To addresses.
	Cc            []*mail.Address          // List of CC'd addresses.
	To            []*mail.Address          // List of To addresses.
	Bcc           []*mail.Address          // List of BCC'd addresses (usually not available in received mail).
	From          []*mail.Address          // List of From addresses.
	Subject       string                   // The subject of the email.
	Date          time.Time                // The date the email was sent.
	MessageID     string                   // The unique Message-ID of the email.
	Attachments   []EmailAttachment        // A slice of attachments found in the email.
	EmbeddedFiles []parsemail.EmbeddedFile // A slice of embedded images found in the email.
	Limited       bool                     // MIME content was only partially decoded.
}

const UnavailableMailBody = "This message body is unavailable because its MIME format could not be decoded."
const LimitedMailNotice = "Some message content could not be decoded."
const EmptyMailBody = "This message has no visible text or HTML body."

const maxMIMEParts = 128
const maxMIMEDepth = 20
const maxRawMailBytes = 25 * 1024 * 1024
const maxDecodedPartBytes = 10 * 1024 * 1024
const maxDecodedMailBytes = 12 * 1024 * 1024

var errMIMELimit = fmt.Errorf("MIME structure exceeds supported limits")

// ParseEmail takes an io.Reader containing raw email data and parses it
// into a ParsedMail struct.
func ParseEmail(emailReader io.Reader) (*ParsedMail, error) {
	parsedMail := &ParsedMail{} // Use a pointer to modify it
	raw, err := io.ReadAll(io.LimitReader(emailReader, maxRawMailBytes+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read email message: %w", err)
	}
	if len(raw) > maxRawMailBytes {
		return parseEmailFallback(raw), nil
	}

	// Walk the MIME tree under explicit depth, part-count, and decoded-size
	// limits before invoking the legacy recursive parser.
	textBody, htmlBody, attachments, canonicalErr := extractMIMEParts(raw)
	if canonicalErr == errMIMELimit {
		return parseEmailFallback(raw), nil
	}

	msg, err := parsemail.Parse(bytes.NewReader(raw))
	if err != nil {
		fallback := parseEmailFallback(raw)
		if canonicalErr == nil {
			fallback.BodyText = textBody
			fallback.BodyHTML = htmlBody
			fallback.Attachments = attachments
			ensureVisibleBody(fallback)
		}
		return fallback, nil
	}

	// Parse basic headers
	parsedMail.Subject = msg.Header.Get("Subject")
	parsedMail.MessageID = msg.Header.Get("Message-ID")

	dateStr := msg.Header.Get("Date")
	if dateStr != "" {
		parsedMail.Date, err = mail.ParseDate(dateStr)
		if err != nil {
			// Malformed optional headers do not make the body unreadable. Do not
			// log their raw values: mailbox content may contain secrets or control
			// characters.
			parsedMail.Date = time.Time{}
		}
	}

	fromStr := msg.Header.Get("From")
	if fromStr != "" {
		parsedMail.From, err = mail.ParseAddressList(fromStr)
		if err != nil {
			parsedMail.From = nil
		}
	}

	toStr := msg.Header.Get("To")
	if toStr != "" {
		parsedMail.To, err = mail.ParseAddressList(toStr)
		if err != nil {
			parsedMail.To = nil
		}
	}

	ccStr := msg.Header.Get("Cc")
	if ccStr != "" {
		parsedMail.Cc, err = mail.ParseAddressList(ccStr)
		if err != nil {
			parsedMail.Cc = nil
		}
	}

	replyToStr := msg.Header.Get("Reply-To")
	if replyToStr != "" {
		parsedMail.ReplyTo, err = mail.ParseAddressList(replyToStr)
		if err != nil {
			parsedMail.ReplyTo = nil
		}
	}

	body := msg.Content

	if msg.HTMLBody != "" {
		parsedMail.BodyHTML = msg.HTMLBody
	} else if msg.TextBody != "" {
		parsedMail.BodyText = msg.TextBody
	} else if body != nil {
		bodyBytes, err := io.ReadAll(body)
		if err != nil {
			return nil, fmt.Errorf("failed to read email body: %w", err)
		}
		parsedMail.BodyText = string(bodyBytes)
	}

	for _, attachment := range msg.Attachments {
		data, err := io.ReadAll(attachment.Data)
		if err != nil {
			parsedMail.Limited = true
			continue
		}
		parsedMail.Attachments = append(parsedMail.Attachments, EmailAttachment{
			Filename: attachment.Filename,
			Data:     data,
			MIMEType: attachment.ContentType,
		})
	}
	// parsemail classifies text/plain and text/html parts before consulting
	// Content-Disposition, which drops legitimate text attachments. Re-read the
	// bounded raw MIME with the standard library and use its attachment view.
	if canonicalErr == nil {
		parsedMail.BodyText = textBody
		parsedMail.BodyHTML = htmlBody
		parsedMail.Attachments = attachments
	} else {
		parsedMail.Limited = true
		if parsedMail.BodyHTML != "" {
			parsedMail.BodyHTML += "<p>" + LimitedMailNotice + "</p>"
		} else {
			parsedMail.BodyText += "\n\n" + LimitedMailNotice
		}
	}
	ensureVisibleBody(parsedMail)

	parsedMail.EmbeddedFiles = msg.EmbeddedFiles
	return parsedMail, nil
}

func ensureVisibleBody(parsed *ParsedMail) {
	if parsed.BodyText == "" && parsed.BodyHTML == "" {
		parsed.BodyText = EmptyMailBody
	}
}

func extractMIMEParts(raw []byte) (string, string, []EmailAttachment, error) {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return "", "", nil, err
	}
	state := mimeWalkState{}
	err = collectMIMEParts(textprotoHeader(msg.Header), msg.Body, 0, &state)
	return state.text, state.html, state.attachments, err
}

type textprotoHeader mail.Header
type mimeWalkState struct {
	text, html          string
	attachments         []EmailAttachment
	parts, decodedBytes int
}

func collectMIMEParts(header textprotoHeader, body io.Reader, depth int, state *mimeWalkState) error {
	if depth > maxMIMEDepth || state.parts >= maxMIMEParts {
		return errMIMELimit
	}
	state.parts++
	rawContentType := mail.Header(header).Get("Content-Type")
	if rawContentType == "" {
		rawContentType = "text/plain"
	}
	contentType, params, err := mime.ParseMediaType(rawContentType)
	if err != nil {
		return err
	}
	disposition, dispositionParams, _ := mime.ParseMediaType(mail.Header(header).Get("Content-Disposition"))
	filename := dispositionParams["filename"]
	if filename == "" {
		filename = params["name"]
	}
	if filename != "" || strings.EqualFold(disposition, "attachment") {
		data, readErr := readDecodedMIMEBody(header, body, state)
		if readErr != nil {
			return readErr
		}
		if value, decodeErr := new(mime.WordDecoder).DecodeHeader(filename); decodeErr == nil {
			filename = value
		}
		state.attachments = append(state.attachments, EmailAttachment{Filename: filename, Data: data, MIMEType: contentType})
		return nil
	}
	if !strings.HasPrefix(contentType, "multipart/") {
		if contentType != "text/plain" && contentType != "text/html" {
			return nil
		}
		data, readErr := readDecodedMIMEBody(header, body, state)
		if readErr != nil {
			return readErr
		}
		decodedText, decodeErr := decodeMIMEText(data, params["charset"])
		if decodeErr != nil {
			return decodeErr
		}
		if contentType == "text/html" {
			state.html += decodedText
		} else {
			state.text += decodedText
		}
		return nil
	}
	reader := multipart.NewReader(body, params["boundary"])
	for {
		part, nextErr := reader.NextRawPart()
		if nextErr == io.EOF {
			return nil
		}
		if nextErr != nil {
			return nextErr
		}
		if partErr := collectMIMEParts(textprotoHeader(part.Header), part, depth+1, state); partErr != nil {
			return partErr
		}
	}
}

func readDecodedMIMEBody(header textprotoHeader, body io.Reader, state *mimeWalkState) ([]byte, error) {
	decoded := body
	switch strings.ToLower(strings.TrimSpace(mail.Header(header).Get("Content-Transfer-Encoding"))) {
	case "base64":
		decoded = base64.NewDecoder(base64.StdEncoding, body)
	case "quoted-printable":
		decoded = quotedprintable.NewReader(body)
	}
	data, err := io.ReadAll(io.LimitReader(decoded, maxDecodedPartBytes+1))
	state.decodedBytes += len(data)
	if err != nil {
		return nil, err
	}
	if len(data) > maxDecodedPartBytes || state.decodedBytes > maxDecodedMailBytes {
		return nil, errMIMELimit
	}
	return data, nil
}

func decodeMIMEText(data []byte, label string) (string, error) {
	if strings.TrimSpace(label) == "" || strings.EqualFold(strings.TrimSpace(label), "utf-8") || strings.EqualFold(strings.TrimSpace(label), "us-ascii") {
		return string(data), nil
	}
	decoded, err := charset.NewReaderLabel(label, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	result, err := io.ReadAll(io.LimitReader(decoded, maxDecodedPartBytes+1))
	if err != nil {
		return "", err
	}
	if len(result) > maxDecodedPartBytes {
		return "", errMIMELimit
	}
	return string(result), nil
}

// parseEmailFallback preserves safe identity headers when a MIME structure or
// transfer encoding is unsupported. It never returns raw message content as a
// body, because that could render MIME headers or undecoded binary data.
func parseEmailFallback(raw []byte) *ParsedMail {
	parsed := &ParsedMail{BodyText: UnavailableMailBody, Limited: true}
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return parsed
	}
	decode := func(name string) string {
		value := msg.Header.Get(name)
		if decoded, decodeErr := new(mime.WordDecoder).DecodeHeader(value); decodeErr == nil {
			return decoded
		}
		return value
	}
	parsed.Subject = decode("Subject")
	parsed.MessageID = strings.TrimSpace(msg.Header.Get("Message-ID"))
	if value := msg.Header.Get("Date"); value != "" {
		parsed.Date, _ = mail.ParseDate(value)
	}
	parseAddresses := func(name string) []*mail.Address {
		addresses, parseErr := mail.ParseAddressList(msg.Header.Get(name))
		if parseErr != nil {
			return nil
		}
		return addresses
	}
	parsed.From = parseAddresses("From")
	parsed.To = parseAddresses("To")
	parsed.Cc = parseAddresses("Cc")
	parsed.Bcc = parseAddresses("Bcc")
	parsed.ReplyTo = parseAddresses("Reply-To")
	return parsed
}

// Helper function to format addresses for printing (optional)
func FormatAddresses(addrs []*mail.Address) string {
	if len(addrs) == 0 {
		return "N/A"
	}
	var out []string
	for _, a := range addrs {
		out = append(out, a.String())
	}
	return strings.Join(out, ", ")
}

// Helper function to truncate strings for printing (optional)
func Truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "..."
}

package services

import (
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/joho/godotenv"
)

// This opt-in test creates one random object and deletes only that object.
func TestR2LiveStorage(t *testing.T) {
	if os.Getenv("XEM_R2_LIVE_TEST") != "1" {
		t.Skip("set XEM_R2_LIVE_TEST=1 and XEM_R2_ENV_FILE to test a real R2 bucket")
	}
	env, err := godotenv.Read(os.Getenv("XEM_R2_ENV_FILE"))
	if err != nil {
		t.Fatal("could not read the configured R2 env file")
	}
	for _, name := range []string{"S3_ENDPOINT_URL", "S3_BUCKET_NAME", "S3_ACCESS_KEY", "S3_SECRET_KEY"} {
		if env[name] == "" {
			t.Fatalf("missing %s", name)
		}
		t.Setenv(name, env[name])
	}
	t.Setenv("STORAGE_PROVIDER", "r2")
	svc, err := NewS3Service(env["S3_BUCKET_NAME"], "", "auto", env["S3_ACCESS_KEY"], env["S3_SECRET_KEY"])
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	const contents = "Xem R2 storage connection check"
	objectURL, err := svc.UploadFile(ctx, []byte(contents), "codex-r2-check.txt", types.ObjectCannedACLPublicRead, "text/plain")
	if err != nil {
		t.Fatal(err)
	}
	key := objectURL[strings.LastIndex(objectURL, "/")+1:]
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := svc.client.DeleteObject(cleanupCtx, &s3.DeleteObjectInput{Bucket: aws.String(svc.bucketName), Key: aws.String(key)}); err != nil {
			t.Errorf("could not remove the test object %s: %v", key, err)
		}
	})
	signed, err := svc.GetSignedURL(ctx, key, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, signed, nil)
	if err != nil {
		t.Fatal("could not construct signed download request")
	}
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		t.Fatal("signed download request failed")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1024))
	if err != nil || response.StatusCode != http.StatusOK || string(body) != contents {
		t.Fatalf("signed download did not return the uploaded content (HTTP %d)", response.StatusCode)
	}
	t.Log("R2 bucket listing, upload without ACLs, and signed download passed")
}

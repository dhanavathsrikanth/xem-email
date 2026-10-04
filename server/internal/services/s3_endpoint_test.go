package services

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func TestExplicitS3Endpoint(t *testing.T) {
	t.Setenv("STORAGE_PROVIDER", "s3")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/xem" {
			t.Errorf("expected path-style bucket, got %s", r.URL.Path)
		}
		if !strings.Contains(r.Header.Get("Authorization"), "/us-east-1/s3/aws4_request") {
			t.Error("incorrect signing region")
		}
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>xem</Name></ListBucketResult>`))
	}))
	defer server.Close()
	t.Setenv("S3_ENDPOINT_URL", server.URL)
	svc, err := NewS3Service("xem", "", "us-east-1", "test", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	signed, err := svc.GetSignedURL(context.Background(), "file.png", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(signed, server.URL+"/xem/file.png?") {
		t.Fatalf("unexpected signed URL: %s", signed)
	}
}

func TestStorageUploadCompatibility(t *testing.T) {
	for _, tc := range []struct {
		provider string
		region   string
		wantACL  string
	}{
		{provider: "r2", region: "auto", wantACL: ""},
		{provider: "s3", region: "us-east-1", wantACL: "public-read"},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			t.Setenv("STORAGE_PROVIDER", tc.provider)
			var uploadedPath string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.Contains(r.Header.Get("Authorization"), "/"+tc.region+"/s3/aws4_request") {
					t.Error("incorrect signing region")
				}
				switch r.Method {
				case http.MethodGet:
					if r.URL.Path != "/xem" || r.URL.Query().Get("list-type") != "2" {
						t.Error("bucket verification must use the path-style ListObjectsV2 API")
					}
					w.Header().Set("Content-Type", "application/xml")
					_, _ = w.Write([]byte(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>xem</Name></ListBucketResult>`))
				case http.MethodPut:
					uploadedPath = r.URL.Path
					if r.Header.Get("X-Amz-Acl") != tc.wantACL {
						t.Errorf("unexpected ACL header: %q", r.Header.Get("X-Amz-Acl"))
					}
					if tc.provider == "r2" && (r.Header.Get("X-Amz-Sdk-Checksum-Algorithm") != "" || r.Header.Get("X-Amz-Trailer") != "") {
						t.Error("R2 upload must not send optional SDK checksum or trailer headers")
					}
					body, err := io.ReadAll(r.Body)
					if err != nil || string(body) != "file contents" || r.Header.Get("Content-Type") != "text/plain" {
						t.Error("upload payload or content type changed")
					}
					w.Header().Set("ETag", `"test-etag"`)
				default:
					t.Errorf("unexpected method: %s", r.Method)
					w.WriteHeader(http.StatusMethodNotAllowed)
				}
			}))
			defer server.Close()
			t.Setenv("S3_ENDPOINT_URL", server.URL)
			// R2 must use auto even if an old configuration supplied another region.
			svc, err := NewS3Service("xem", "", "us-east-1", "test", "test-secret")
			if err != nil {
				t.Fatal(err)
			}
			objectURL, err := svc.UploadFile(context.Background(), []byte("file contents"), "file.txt", types.ObjectCannedACLPublicRead, "text/plain")
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(uploadedPath, "/xem/") || !strings.HasSuffix(uploadedPath, ".txt") || objectURL != server.URL+uploadedPath {
				t.Fatal("uploaded object URL does not match its storage key")
			}
			key := strings.TrimPrefix(uploadedPath, "/xem/")
			signed, err := svc.GetSignedURL(context.Background(), key, time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(signed, objectURL+"?") || !strings.Contains(signed, "%2F"+tc.region+"%2Fs3%2Faws4_request") || !strings.Contains(signed, "X-Amz-Expires=60") {
				t.Fatal("private download URL has incorrect endpoint, region or expiration")
			}
		})
	}
}

func TestR2RequiresExplicitEndpoint(t *testing.T) {
	t.Setenv("STORAGE_PROVIDER", "r2")
	t.Setenv("S3_ENDPOINT_URL", "")
	if _, err := NewS3Service("xem", "", "auto", "test", "test-secret"); err == nil || !strings.Contains(err.Error(), "S3_ENDPOINT_URL") {
		t.Fatal("R2 must require its exact S3 API endpoint")
	}
}

func TestResolveS3Endpoint(t *testing.T) {
	endpoint, region, pathStyle, err := resolveS3Endpoint("example.com", "apac", "")
	if err != nil || endpoint != "https://apac.example.com" || region != "apac" || pathStyle {
		t.Fatal("legacy endpoint changed")
	}
	for _, invalid := range []string{"ftp://host", "http://user:pass@host", "http://host/path", "http://host?key=value", "http://host#fragment", "://"} {
		if _, _, _, err := resolveS3Endpoint("", "us-east-1", invalid); err == nil {
			t.Errorf("accepted %s", invalid)
		}
	}
	if _, _, _, err := resolveS3Endpoint("", "", "http://storage:9000"); err == nil {
		t.Error("accepted missing signing region")
	}
}

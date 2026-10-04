package api

import (
	"fmt"
	"github.com/labstack/echo/v4"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

// The MCP service authenticates each request against Xem; this proxy keeps it
// behind the existing API hostname and never substitutes a shared credential.
func mcpProxy(endpoint, publicURL string) (echo.HandlerFunc, error) {
	u, err := url.Parse(endpoint)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("MCP_INTERNAL_URL must be a fixed service origin")
	}
	public, err := url.Parse(publicURL)
	if err != nil || public.Scheme != "https" || public.Host == "" || public.User != nil {
		return nil, fmt.Errorf("MCP requires an HTTPS PUBLIC_URL")
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	direct := proxy.Director
	proxy.Director = func(r *http.Request) { direct(r); r.Host = public.Host }
	proxy.Transport = &http.Transport{Proxy: nil, ResponseHeaderTimeout: 30 * time.Second, IdleConnTimeout: 90 * time.Second, MaxIdleConnsPerHost: 8}
	proxy.FlushInterval = -1
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "Workspace tools temporarily unavailable", http.StatusServiceUnavailable)
	}
	return func(c echo.Context) error { proxy.ServeHTTP(c.Response(), c.Request()); return nil }, nil
}

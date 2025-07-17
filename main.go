package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	http "github.com/bogdanfinn/fhttp"

	tls_client "github.com/bogdanfinn/tls-client"
	"github.com/bogdanfinn/tls-client/profiles"
)

type Config struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Cookie  string            `json:"cookie"`
}

func main() {
	if len(os.Args) < 2 {
		log.Fatal("Usage: go run main.go <config_json>")
	}

	configJSON := os.Args[1]

	var config Config
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		log.Fatalf("Error parsing config JSON: %v", err)
	}

	log.Printf("got request: %+v", config)

	// Create custom TLS config to mimic modern browsers
	jar := tls_client.NewCookieJar()
	options := []tls_client.HttpClientOption{
		tls_client.WithTimeoutSeconds(30),
		tls_client.WithClientProfile(profiles.Chrome_133),
		// tls_client.WithNotFollowRedirects(),
		tls_client.WithCookieJar(jar), // create cookieJar instance and pass it as argument
	}

	client, err := tls_client.NewHttpClient(tls_client.NewNoopLogger(), options...)
	if err != nil {
		log.Fatalf("Error creating HTTP client: %v", err)
	}

	// Create request
	method := config.Method
	if method == "" {
		method = "GET"
	}

	req, err := http.NewRequest(method, config.URL, nil)
	if err != nil {
		log.Fatalf("Error creating request: %v", err)
	}

	// Set default headers that match Chrome
	defaultHeaders := map[string]string{
		"Accept":                    "*/*",
		"Accept-Language":           "en-US,en;q=0.9",
		"Accept-Encoding":           "gzip, deflate, br",
		"DNT":                       "1",
		"Connection":                "keep-alive",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest":            "empty",
		"Sec-Fetch-Mode":            "cors",
		"Sec-Fetch-Site":            "same-origin",
		"User-Agent":                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		"sec-ch-ua":                 `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`,
		"sec-ch-ua-mobile":          "?0",
		"sec-ch-ua-platform":        `"Linux"`,
	}

	// Set default headers first
	for key, value := range defaultHeaders {
		req.Header.Set(key, value)
	}

	// Override with custom headers
	for key, value := range config.Headers {
		req.Header.Set(key, value)
	}

	// Add cookie if provided
	if config.Cookie != "" {
		log.Printf("Adding cookies: %s", config.Cookie)
		cookies := strings.Split(config.Cookie, ";")
		for _, cookie := range cookies {
			cookieParts := strings.Split(cookie, "=")
			if len(cookieParts) == 2 {
				key := strings.TrimSpace(cookieParts[0])
				value := strings.TrimSpace(cookieParts[1])
				log.Printf("Adding cookie: [%s=%s]", key, value)
				jar.SetCookies(req.URL, []*http.Cookie{
					{
						Name:  cookieParts[0],
						Value: cookieParts[1],
					},
				})
			}
		}
	}

	// Send request with retries
	var resp *http.Response
	var lastErr error

	for attempt := 1; attempt <= 3; attempt++ {
		resp, lastErr = client.Do(req)
		if lastErr == nil {
			break
		}

		if attempt < 3 {
			log.Printf("Attempt %d failed: %v, retrying...", attempt, lastErr)
			time.Sleep(time.Duration(attempt) * time.Second)
		}
	}

	if lastErr != nil {
		log.Fatalf("Error sending request after 3 attempts: %v", lastErr)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatalf("Error reading response body: %v", err)
	}

	// Create response object
	response := map[string]interface{}{
		"status":     resp.StatusCode,
		"statusText": resp.Status,
		"headers":    resp.Header,
		"body":       string(body),
	}

	// Output JSON response
	responseJSON, err := json.Marshal(response)
	if err != nil {
		log.Fatalf("Error marshaling response: %v", err)
	}

	fmt.Print(string(responseJSON))
}

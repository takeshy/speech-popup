package main

import "testing"

func TestParseVertexOAuthClient(t *testing.T) {
	client, err := parseVertexOAuthClient([]byte(`{"installed":{"client_id":"desktop-client","client_secret":"secret","project_id":"cloud-project"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if client.ClientID != "desktop-client" || client.ClientSecret != "secret" || client.ProjectID != "cloud-project" {
		t.Fatalf("unexpected parsed OAuth fields")
	}
	for _, data := range []string{
		`{"type":"service_account","client_email":"account@example.com"}`,
		`{"web":{"client_id":"web-client"}}`,
		`{"installed":{"client_id":"  "}}`,
		`{"installed":{}}`, `null`, `{`,
	} {
		if _, err := parseVertexOAuthClient([]byte(data)); err == nil {
			t.Errorf("accepted invalid client JSON: %s", data)
		}
	}
}

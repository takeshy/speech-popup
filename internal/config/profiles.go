package config

import (
	"fmt"
	"sort"
	"strings"
)

// SpeechProfile remembers connection and recognition settings for one service.
// Shared recording controls remain in SpeechConfig. Inactive profiles may be
// incomplete; the selected settings are validated before saving and recording.
type SpeechProfile struct {
	BaseURL         string `json:"baseUrl"`
	APIKey          string `json:"apiKey"`
	Model           string `json:"model"`
	Language        string `json:"language"`
	VertexProjectID string `json:"vertexProjectId"`
}

func cloneProfiles(profiles map[string]SpeechProfile) map[string]SpeechProfile {
	if len(profiles) == 0 {
		return nil
	}
	result := make(map[string]SpeechProfile)
	for name, profile := range profiles {
		if validEndpointType(name) {
			result[name] = profile
		}
	}
	return result
}

func (s *SpeechConfig) applyProfile(name, key, value string) {
	if !validEndpointType(name) {
		return
	}
	if s.Profiles == nil {
		s.Profiles = make(map[string]SpeechProfile)
	}
	p := s.Profiles[name]
	switch key {
	case "base_url":
		p.BaseURL = value
	case "api_key":
		p.APIKey = value
	case "model":
		p.Model = value
	case "language":
		p.Language = value
	case "vertex_project_id":
		p.VertexProjectID = value
	default:
		return
	}
	s.Profiles[name] = p
}

func (s *SpeechConfig) marshalProfiles(b *strings.Builder) {
	names := make([]string, 0, len(s.Profiles))
	for name := range s.Profiles {
		if validEndpointType(name) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		p := s.Profiles[name]
		fmt.Fprintf(b, "\n[speech.profiles.%s]\n", name)
		fmt.Fprintf(b, "base_url = %s\napi_key = %s\nmodel = %s\nlanguage = %s\nvertex_project_id = %s\n", quote(p.BaseURL), quote(p.APIKey), quote(p.Model), quote(p.Language), quote(p.VertexProjectID))
	}
}

// Language keys are validated before they become bare TOML keys.
func cloneSendPhrases(profiles map[string]string) map[string]string {
	if len(profiles) == 0 {
		return nil
	}
	result := make(map[string]string)
	for language, phrase := range profiles {
		if languagePattern.MatchString(language) {
			result[language] = phrase
		}
	}
	return result
}

func marshalPhraseMap(b *strings.Builder, section string, values map[string]string) {
	profiles := cloneSendPhrases(values)
	if len(profiles) == 0 {
		return
	}
	names := make([]string, 0, len(profiles))
	for language := range profiles {
		names = append(names, language)
	}
	sort.Strings(names)
	fmt.Fprintf(b, "\n[speech.%s]\n", section)
	for _, language := range names {
		fmt.Fprintf(b, "%s = %s\n", language, quote(profiles[language]))
	}
}

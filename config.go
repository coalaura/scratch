package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/goccy/go-yaml"
)

type ConfigServer struct {
	URL   string `yaml:"url"`
	Port  int    `yaml:"port"`
	Token string `yaml:"token"`
}

type Config struct {
	Server ConfigServer `yaml:"server"`
}

func NewDefaultConfig() Config {
	return Config{
		Server: ConfigServer{
			URL:   "http://localhost:8080/",
			Port:  8080,
			Token: "p4$$w0rd",
		},
	}
}

func LoadConfig() (*Config, error) {
	cfg := NewDefaultConfig()

	file, err := OpenFileForReading("config.yml")
	if !os.IsNotExist(err) {
		if err != nil {
			return nil, err
		}

		defer file.Close()

		err = yaml.NewDecoder(file).Decode(&cfg)
		if err != nil {
			return nil, err
		}
	}

	err = cfg.Validate()
	if err != nil {
		return nil, err
	}

	return &cfg, cfg.Store()
}

func (c *Config) Validate() error {
	// server
	if c.Server.URL == "" {
		return fmt.Errorf("server.url is empty")
	} else if !strings.HasSuffix(c.Server.URL, "/") {
		c.Server.URL += "/"
	}

	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("server.port must be 1-65535, got %d", c.Server.Port)
	}

	if c.Server.Token == "" {
		return fmt.Errorf("server.token is empty")
	}

	return nil
}

func (c *Config) Addr() string {
	return fmt.Sprintf(":%d", c.Server.Port)
}

func (e *Config) Store() error {
	def := NewDefaultConfig()

	comments := yaml.CommentMap{
		"$.server.url":   {yaml.HeadComment(fmt.Sprintf(" base url of your instance (default: %v)", def.Server.URL))},
		"$.server.port":  {yaml.HeadComment(fmt.Sprintf(" port to run scratch on (default: %v)", def.Server.Port))},
		"$.server.token": {yaml.HeadComment(fmt.Sprintf(" token for authentication, leave empty to disable auth (default: %v)", def.Server.Token))},
	}

	file, err := OpenFileForWriting("config.yml")
	if err != nil {
		return err
	}

	defer file.Close()

	return yaml.NewEncoder(file, yaml.WithComment(comments)).Encode(e)
}

# Scratch

A minimalist, self-hosted markdown note-taking application.

## Features

- **Focus First**: Clean, dark-themed interface (Catppuccin palette).
- **Live Preview**: Split-pane toggle to view rendered Markdown as you type.
- **Organization**: Simple tagging system to keep track of your notes.
- **Reliable**: Auto-saves changes instantly so you never lose work.
- **Self-Hosted**: Built with Go and SQLite for easy deployment and data ownership.

## Getting Started

1. **Download** the latest binary for your platform from the [Releases](https://github.com/coalaura/scratch/releases) page.
2. **Run** the application:
   ```bash
   ./scratch
   ```
3. **Open** `http://localhost:8080` in your browser.
4. **Log in** using the default access token: `p4$$w0rd`.

## Configuration

A `config.yml` file is generated on the first run. You should edit this to set your own security token:

```yaml
server:
  url: "http://localhost:8080/"
  port: 8080
  token: "change-me-to-something-secure"
```

## Building from Source

If you prefer to build it yourself, you will need Go installed.

```bash
git clone https://github.com/coalaura/scratch.git
cd scratch
go build -o scratch
```
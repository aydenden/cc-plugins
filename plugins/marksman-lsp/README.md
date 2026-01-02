# Marksman LSP Plugin

Markdown language server for Claude Code that provides enhanced editing capabilities.

## Features

Marksman LSP provides the following features for Markdown files:

- **Completion**: Auto-complete links and references
- **Go to Definition**: Navigate to linked files and headings
- **Find References**: Search for reference locations in documents
- **Rename**: Bulk rename links and headings
- **Diagnostics**: Detect broken links, duplicate/ambiguous headings

## Supported Link Formats

- Markdown inline links: `[text](/path.md#heading)`
- Markdown reference links: `[ref]` + `[ref]: /url`
- Wiki links: `[[other-doc]]`, `[[doc#heading]]`

## Installation

### 1. Install Marksman

**macOS (Homebrew)**:
```bash
brew install marksman
```

**Linux (Snap)**:
```bash
snap install marksman
```

**Direct Download**:
Download the binary from [Marksman Releases](https://github.com/artempyanykh/marksman/releases)

### 2. Install Plugin

Add this plugin to your Claude Code marketplace or install directly:

```bash
claude --plugin-dir ./plugins/marksman-lsp
```

## Requirements

- Marksman LSP server must be installed and available in PATH
- Applies to `.md` files

## References

- [Marksman GitHub Repository](https://github.com/artempyanykh/marksman)
- Official Marksman documentation

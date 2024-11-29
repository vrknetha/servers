# FireCrawl MCP Server

An MCP server implementation that integrates with FireCrawl API, providing advanced web scraping capabilities with support for JavaScript-rendered sites, PDFs, and dynamic content.

## Features

- **Single URL Scraping**: Scrape individual URLs with advanced options
- **Batch Scraping**: Process multiple URLs simultaneously
- **JavaScript Support**: Handle JavaScript-rendered content
- **PDF Parsing**: Extract content from PDF files
- **Rate Limiting**: Built-in rate limiting to prevent API abuse
- **Clean Output**: Returns clean markdown optimized for LLM applications

## Tools

- **fire_crawl_scrape**
  - Scrape a single URL with advanced options
  - Inputs:
    - `url` (string): Target URL to scrape
    - `parsePDF` (boolean, optional): Enable/disable PDF parsing (default: true)
    - `waitForSelector` (string, optional): CSS selector to wait for before scraping
    - `javascript` (boolean, optional): Enable/disable JavaScript execution (default: true)
    - `timeout` (number, optional): Maximum time to wait for page load (ms) (default: 30000)

- **fire_crawl_batch**
  - Scrape multiple URLs simultaneously
  - Inputs:
    - `urls` (string[]): List of URLs to scrape
    - `options` (object, optional):
      - `parsePDF` (boolean, optional): Enable/disable PDF parsing (default: true)
      - `javascript` (boolean, optional): Enable/disable JavaScript execution (default: true)
      - `timeout` (number, optional): Maximum time to wait for page load (ms) (default: 30000)

## Configuration

### Getting an API Key
1. Sign up for a FireCrawl API account
2. Generate your API key from the developer dashboard
3. Set the API key in your environment

### Usage with Claude Desktop
Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fire-crawl": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-fire-crawl"
      ],
      "env": {
        "FIRE_CRAWL_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

## Rate Limiting

The server implements rate limiting to prevent API abuse:
- 2 requests per second
- 60 requests per minute

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository. 
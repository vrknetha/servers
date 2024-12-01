#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  Tool,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Tool definitions
const SCRAPE_TOOL: Tool = {
  name: "fire_crawl_scrape",
  description:
    "Scrape a single webpage with advanced options for content extraction. " +
    "Supports various formats including markdown, HTML, and screenshots. " +
    "Can execute custom actions like clicking or scrolling before scraping.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to scrape",
      },
      formats: {
        type: "array",
        items: {
          type: "string",
          enum: ["markdown", "html", "rawHtml", "screenshot", "links"],
        },
        description: "Content formats to extract (default: ['markdown'])",
      },
      onlyMainContent: {
        type: "boolean",
        description:
          "Extract only the main content, filtering out navigation, footers, etc.",
      },
      includeTags: {
        type: "array",
        items: { type: "string" },
        description: "HTML tags to specifically include in extraction",
      },
      excludeTags: {
        type: "array",
        items: { type: "string" },
        description: "HTML tags to exclude from extraction",
      },
      waitFor: {
        type: "number",
        description: "Time in milliseconds to wait for dynamic content to load",
      },
      timeout: {
        type: "number",
        description:
          "Maximum time in milliseconds to wait for the page to load",
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["wait", "click", "scroll", "type", "select"],
              description: "Type of action to perform",
            },
            selector: {
              type: "string",
              description: "CSS selector for the target element",
            },
            milliseconds: {
              type: "number",
              description: "Time to wait in milliseconds (for wait action)",
            },
            text: {
              type: "string",
              description: "Text to type (for type action)",
            },
            value: {
              type: "string",
              description: "Value to select (for select action)",
            },
            x: {
              type: "number",
              description: "X coordinate for scroll",
            },
            y: {
              type: "number",
              description: "Y coordinate for scroll",
            },
            behavior: {
              type: "string",
              enum: ["smooth", "auto"],
              description: "Scroll behavior",
            },
          },
          required: ["type"],
        },
        description: "List of actions to perform before scraping",
      },
      extract: {
        type: "object",
        properties: {
          schema: {
            type: "object",
            description: "Schema for structured data extraction",
          },
          systemPrompt: {
            type: "string",
            description: "System prompt for LLM extraction",
          },
          prompt: {
            type: "string",
            description: "User prompt for LLM extraction",
          },
        },
        description: "Configuration for structured data extraction",
      },
    },
    required: ["url"],
  },
};

const MAP_TOOL: Tool = {
  name: "fire_crawl_map",
  description:
    "Discover URLs from a starting point. Can use both sitemap.xml and HTML link discovery.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Starting URL for URL discovery",
      },
      search: {
        type: "string",
        description: "Optional search term to filter URLs",
      },
      ignoreSitemap: {
        type: "boolean",
        description: "Skip sitemap.xml discovery and only use HTML links",
      },
      sitemapOnly: {
        type: "boolean",
        description: "Only use sitemap.xml for discovery, ignore HTML links",
      },
      includeSubdomains: {
        type: "boolean",
        description: "Include URLs from subdomains in results",
      },
      limit: {
        type: "number",
        description: "Maximum number of URLs to return",
      },
    },
    required: ["url"],
  },
};

const CRAWL_TOOL: Tool = {
  name: "fire_crawl_crawl",
  description:
    "Start an asynchronous crawl of multiple pages from a starting URL. " +
    "Supports depth control, path filtering, and webhook notifications.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Starting URL for the crawl",
      },
      excludePaths: {
        type: "array",
        items: { type: "string" },
        description: "URL paths to exclude from crawling",
      },
      includePaths: {
        type: "array",
        items: { type: "string" },
        description: "Only crawl these URL paths",
      },
      maxDepth: {
        type: "number",
        description: "Maximum link depth to crawl",
      },
      ignoreSitemap: {
        type: "boolean",
        description: "Skip sitemap.xml discovery",
      },
      limit: {
        type: "number",
        description: "Maximum number of pages to crawl",
      },
      allowBackwardLinks: {
        type: "boolean",
        description: "Allow crawling links that point to parent directories",
      },
      allowExternalLinks: {
        type: "boolean",
        description: "Allow crawling links to external domains",
      },
      webhook: {
        type: "string",
        description: "Webhook URL to notify when crawl is complete",
      },
      scrapeOptions: {
        type: "object",
        properties: {
          formats: {
            type: "array",
            items: {
              type: "string",
              enum: ["markdown", "html", "rawHtml", "screenshot", "links"],
            },
          },
          onlyMainContent: {
            type: "boolean",
          },
          includeTags: {
            type: "array",
            items: { type: "string" },
          },
          excludeTags: {
            type: "array",
            items: { type: "string" },
          },
          waitFor: {
            type: "number",
          },
        },
        description: "Options for scraping each page",
      },
    },
    required: ["url"],
  },
};

// Type definitions
interface ScrapeAction {
  type: "wait" | "click" | "scroll" | "type" | "select";
  selector?: string;
  milliseconds?: number;
  text?: string;
  value?: string;
  x?: number;
  y?: number;
  behavior?: "smooth" | "auto";
}

interface ExtractOptions {
  schema?: object;
  systemPrompt?: string;
  prompt?: string;
}

interface ScrapeOptions {
  url: string;
  formats?: Array<"markdown" | "html" | "rawHtml" | "screenshot" | "links">;
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  waitFor?: number;
  timeout?: number;
  actions?: ScrapeAction[];
  extract?: ExtractOptions;
}

interface MapOptions {
  url: string;
  search?: string;
  ignoreSitemap?: boolean;
  sitemapOnly?: boolean;
  includeSubdomains?: boolean;
  limit?: number;
}

interface CrawlOptions {
  url: string;
  excludePaths?: string[];
  includePaths?: string[];
  maxDepth?: number;
  ignoreSitemap?: boolean;
  limit?: number;
  allowBackwardLinks?: boolean;
  allowExternalLinks?: boolean;
  webhook?: string;
  scrapeOptions?: {
    formats?: string[];
    onlyMainContent?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
    waitFor?: number;
  };
}

// Response interfaces
interface ScrapeResponse {
  success: boolean;
  data: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    screenshot?: string;
    links?: string[];
    metadata: {
      title?: string;
      description?: string;
      sourceURL: string;
      statusCode: number;
    };
  };
}

interface MapResponse {
  success: boolean;
  links: string[];
}

interface CrawlResponse {
  success: boolean;
  id: string;
  url: string;
}

// Type guards
function isScrapeOptions(args: unknown): args is ScrapeOptions {
  return (
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof (args as { url: unknown }).url === "string"
  );
}

function isMapOptions(args: unknown): args is MapOptions {
  return (
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof (args as { url: unknown }).url === "string"
  );
}

function isCrawlOptions(args: unknown): args is CrawlOptions {
  return (
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof (args as { url: unknown }).url === "string"
  );
}

// Server implementation
const server = new Server(
  {
    name: "fire-crawl",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Check for API key
const FIRE_CRAWL_API_KEY = process.env.FIRE_CRAWL_API_KEY!;
if (!FIRE_CRAWL_API_KEY) {
  console.error("Error: FIRE_CRAWL_API_KEY environment variable is required");
  process.exit(1);
}

// Rate limiting
const RATE_LIMIT = {
  perSecond: 2,
  perMinute: 60,
};

let requestCount = {
  second: 0,
  minute: 0,
  lastReset: Date.now(),
};

function checkRateLimit() {
  const now = Date.now();
  if (now - requestCount.lastReset > 1000) {
    requestCount.second = 0;
    requestCount.lastReset = now;
  }
  if (now - requestCount.lastReset > 60000) {
    requestCount.minute = 0;
  }
  if (
    requestCount.second >= RATE_LIMIT.perSecond ||
    requestCount.minute >= RATE_LIMIT.perMinute
  ) {
    throw new Error("Rate limit exceeded");
  }
  requestCount.second++;
  requestCount.minute++;
}

// API functions
async function performScrape(options: ScrapeOptions): Promise<string> {
  checkRateLimit();

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRE_CRAWL_API_KEY}`,
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `FireCrawl API error: ${response.status} ${
        response.statusText
      }\n${JSON.stringify(errorData)}`
    );
  }

  const data = (await response.json()) as ScrapeResponse;

  if (!data.success || !data.data) {
    throw new Error("Invalid response from FireCrawl API");
  }

  const content = data.data.markdown || data.data.html || data.data.rawHtml;
  if (!content) {
    throw new Error("No content received from FireCrawl API");
  }

  return content.trim();
}

async function performMap(options: MapOptions): Promise<string[]> {
  checkRateLimit();

  const response = await fetch("https://api.firecrawl.dev/v1/map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRE_CRAWL_API_KEY}`,
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `FireCrawl API error: ${response.status} ${
        response.statusText
      }\n${JSON.stringify(errorData)}`
    );
  }

  const data = (await response.json()) as MapResponse;

  if (!data.success || !data.links) {
    throw new Error("Invalid response from FireCrawl API");
  }

  return data.links;
}

async function performCrawl(options: CrawlOptions): Promise<string> {
  checkRateLimit();

  const response = await fetch("https://api.firecrawl.dev/v1/crawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRE_CRAWL_API_KEY}`,
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `FireCrawl API error: ${response.status} ${
        response.statusText
      }\n${JSON.stringify(errorData)}`
    );
  }

  const data = (await response.json()) as CrawlResponse;

  if (!data.success || !data.id) {
    throw new Error("Invalid response from FireCrawl API");
  }

  return `Started crawl ${data.id} for ${data.url}`;
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SCRAPE_TOOL, MAP_TOOL, CRAWL_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error("No arguments provided");
    }

    switch (name) {
      case "fire_crawl_scrape": {
        if (!isScrapeOptions(args)) {
          throw new Error("Invalid arguments for fire_crawl_scrape");
        }
        const content = await performScrape(args);
        return {
          content: [{ type: "text", text: content }],
          isError: false,
        };
      }

      case "fire_crawl_map": {
        if (!isMapOptions(args)) {
          throw new Error("Invalid arguments for fire_crawl_map");
        }
        const links = await performMap(args);
        return {
          content: [{ type: "text", text: links.join("\n") }],
          isError: false,
        };
      }

      case "fire_crawl_crawl": {
        if (!isCrawlOptions(args)) {
          throw new Error("Invalid arguments for fire_crawl_crawl");
        }
        const result = await performCrawl(args);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
});

// Server startup
async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("FireCrawl MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error running server:", error);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});

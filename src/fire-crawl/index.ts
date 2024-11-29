#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  Tool,
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// Tool definitions
const SINGLE_SCRAPE_TOOL: Tool = {
  name: "fire_crawl_scrape",
  description: 
    "Scrapes a single URL and converts it to markdown or structured data. " +
    "Handles JavaScript-rendered sites, PDFs, and dynamic content. " +
    "Returns clean markdown optimized for LLM applications.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Target URL to scrape"
      },
      parsePDF: {
        type: "boolean",
        description: "Enable/disable PDF parsing",
        default: true
      },
      waitForSelector: {
        type: "string",
        description: "CSS selector to wait for before scraping"
      },
      javascript: {
        type: "boolean",
        description: "Enable/disable JavaScript execution",
        default: true
      },
      timeout: {
        type: "number",
        description: "Maximum time to wait for page load (ms)",
        default: 30000
      }
    },
    required: ["url"]
  }
};

const BATCH_SCRAPE_TOOL: Tool = {
  name: "fire_crawl_batch",
  description:
    "Scrapes multiple URLs simultaneously in batch mode. " +
    "Supports all single scrape options plus batch-specific controls. " +
    "Efficiently handles multiple pages while respecting rate limits.",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "List of URLs to scrape"
      },
      options: {
        type: "object",
        properties: {
          parsePDF: { type: "boolean", default: true },
          javascript: { type: "boolean", default: true },
          timeout: { type: "number", default: 30000 }
        }
      }
    },
    required: ["urls"]
  }
};

// Rate limiting configuration
const RATE_LIMIT = {
  perSecond: 2,
  perMinute: 60
};

interface RateLimit {
  count: number;
  lastReset: number;
}

let rateLimits = {
  second: { count: 0, lastReset: Date.now() } as RateLimit,
  minute: { count: 0, lastReset: Date.now() } as RateLimit
};

function checkRateLimit() {
  const now = Date.now();
  
  // Reset second counter
  if (now - rateLimits.second.lastReset > 1000) {
    rateLimits.second.count = 0;
    rateLimits.second.lastReset = now;
  }
  
  // Reset minute counter
  if (now - rateLimits.minute.lastReset > 60000) {
    rateLimits.minute.count = 0;
    rateLimits.minute.lastReset = now;
  }
  
  if (rateLimits.second.count >= RATE_LIMIT.perSecond ||
      rateLimits.minute.count >= RATE_LIMIT.perMinute) {
    throw new Error('Rate limit exceeded');
  }
  
  rateLimits.second.count++;
  rateLimits.minute.count++;
}

// Response interfaces
interface FireCrawlResponse {
  url: string;
  title?: string;
  markdown: string;
  metadata?: {
    lastModified?: string;
    contentType?: string;
  };
  next?: string;
}

interface BatchResponse {
  results: FireCrawlResponse[];
  failed: string[];
}

// Type guards
function isFireCrawlScrapeArgs(args: unknown): args is { 
  url: string; 
  parsePDF?: boolean;
  waitForSelector?: string;
  javascript?: boolean;
  timeout?: number;
} {
  return (
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof (args as { url: string }).url === "string"
  );
}

function isFireCrawlBatchArgs(args: unknown): args is {
  urls: string[];
  options?: {
    parsePDF?: boolean;
    javascript?: boolean;
    timeout?: number;
  };
} {
  return (
    typeof args === "object" &&
    args !== null &&
    "urls" in args &&
    Array.isArray((args as { urls: string[] }).urls)
  );
}

// Tool handlers
async function performSingleScrape(url: string, options: {
  parsePDF?: boolean;
  waitForSelector?: string;
  javascript?: boolean;
  timeout?: number;
}, apiKey: string): Promise<FireCrawlResponse> {
  checkRateLimit();
  
  const apiUrl = new URL('https://api.firecrawl.dev/scrape');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url,
      ...options
    })
  });

  if (!response.ok) {
    throw new Error(`FireCrawl API error: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return await response.json() as FireCrawlResponse;
}

async function performBatchScrape(urls: string[], options: {
  parsePDF?: boolean;
  javascript?: boolean;
  timeout?: number;
} | undefined, apiKey: string): Promise<BatchResponse> {
  checkRateLimit();
  
  const apiUrl = new URL('https://api.firecrawl.dev/scrape/batch');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      urls,
      options
    })
  });

  if (!response.ok) {
    throw new Error(`FireCrawl API error: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return await response.json() as BatchResponse;
}

// Server implementation
export async function createServer() {
  // Check for API key
  const FIRE_CRAWL_API_KEY = process.env.FIRE_CRAWL_API_KEY;
  if (!FIRE_CRAWL_API_KEY) {
    throw new Error("FIRE_CRAWL_API_KEY environment variable is required");
  }

  const server = new Server(
    {
      name: "example-servers/fire-crawl",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {
          fire_crawl_scrape: SINGLE_SCRAPE_TOOL,
          fire_crawl_batch: BATCH_SCRAPE_TOOL
        },
      },
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [SINGLE_SCRAPE_TOOL, BATCH_SCRAPE_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      if (!args) {
        return {
          content: [{ type: "text", text: "Error: No arguments provided" }],
          isError: true
        };
      }

      if (name === "fire_crawl_scrape") {
        if (!isFireCrawlScrapeArgs(args)) {
          return {
            content: [{ type: "text", text: "Error: Invalid arguments for single scrape" }],
            isError: true
          };
        }

        try {
          const result = await performSingleScrape(args.url, {
            parsePDF: args.parsePDF,
            waitForSelector: args.waitForSelector,
            javascript: args.javascript,
            timeout: args.timeout
          }, FIRE_CRAWL_API_KEY);

          return {
            content: [{ type: "text", text: result.markdown }],
            isError: false
          };
        } catch (error: unknown) {
          const err = error as Error;
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true
          };
        }
      }

      if (name === "fire_crawl_batch") {
        if (!isFireCrawlBatchArgs(args)) {
          return {
            content: [{ type: "text", text: "Error: Invalid arguments for batch scrape" }],
            isError: true
          };
        }

        try {
          const result = await performBatchScrape(args.urls, args.options, FIRE_CRAWL_API_KEY);
          return {
            content: [{ type: "text", text: result.results.map(r => r.markdown).join("\n\n") }],
            isError: false
          };
        } catch (error: unknown) {
          const err = error as Error;
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true
          };
        }
      }

      return {
        content: [{ type: "text", text: "Error: Unknown tool" }],
        isError: true
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true
      };
    }
  });

  return server;
}

// Start server if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const server = await createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await transport.start();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
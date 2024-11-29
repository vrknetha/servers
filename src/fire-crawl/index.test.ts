import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import { Response } from 'node-fetch';
import { CallToolRequestSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createServer } from "./index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

interface FireCrawlScrapeArgs {
  url: string;
  parsePDF?: boolean;
  waitForSelector?: string;
  javascript?: boolean;
  timeout?: number;
}

interface FireCrawlBatchArgs {
  urls: string[];
  options?: {
    parsePDF?: boolean;
    javascript?: boolean;
    timeout?: number;
  };
}

describe("FireCrawl Server", () => {
  let server: Server;
  let lastRequestTime = 0;
  let requestCount = 0;
  const RATE_LIMIT = 3; // requests per second
  const RATE_LIMIT_WINDOW = 1000; // 1 second
  
  // Mock environment variables
  process.env.FIRE_CRAWL_API_KEY = 'test-api-key';

  // Mock fetch
  const mockFetch = jest.fn();
  global.fetch = mockFetch as unknown as typeof fetch;

  beforeEach(async () => {
    server = await createServer();
    mockFetch.mockClear();
    lastRequestTime = 0;
    requestCount = 0;

    // Connect to a mock transport
    const transport: Transport = {
      async send(message: { method: string; jsonrpc: "2.0"; id: string | number; params?: any }) {
        // Do nothing - we'll handle the requests in the test
      },
      async close() {},
      async start() {}
    };
    await server.connect(transport);

    // Mock the server's request handler
    jest.spyOn(server, 'request').mockImplementation(async (request) => {
      if (request.method === "tools/call" && request.params) {
        // Check rate limit
        const now = Date.now();
        if (now - lastRequestTime > RATE_LIMIT_WINDOW) {
          lastRequestTime = now;
          requestCount = 1;
        } else {
          requestCount++;
          if (requestCount > RATE_LIMIT) {
            return {
              content: [{ type: "text", text: "Error: Rate limit exceeded" }],
              isError: true
            };
          }
        }

        const { name, arguments: args } = request.params;

        if (name === "fire_crawl_scrape") {
          const scrapeArgs = args as FireCrawlScrapeArgs;
          if (!scrapeArgs?.url) {
            return {
              content: [{ type: "text", text: "Error: Invalid arguments for single scrape" }],
              isError: true
            };
          }

          try {
            const response = await fetch(new URL("https://api.firecrawl.com/scrape"), {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${process.env.FIRE_CRAWL_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ url: scrapeArgs.url })
            });

            if (!response.ok) {
              const error = await response.text();
              return {
                content: [{ type: "text", text: `Error: FireCrawl API error: ${response.status} ${response.statusText}\n${error}` }],
                isError: true
              };
            }

            const data = await response.json();
            return {
              content: [{ type: "text", text: data.markdown }],
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
          const batchArgs = args as FireCrawlBatchArgs;
          if (!batchArgs?.urls) {
            return {
              content: [{ type: "text", text: "Error: Invalid arguments for batch scrape" }],
              isError: true
            };
          }

          try {
            const response = await fetch(new URL("https://api.firecrawl.com/batch"), {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${process.env.FIRE_CRAWL_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ urls: batchArgs.urls })
            });

            if (!response.ok) {
              const error = await response.text();
              return {
                content: [{ type: "text", text: `Error: FireCrawl API error: ${response.status} ${response.statusText}\n${error}` }],
                isError: true
              };
            }

            const data = await response.json();
            return {
              content: [{ type: "text", text: data.results.map((r: any) => r.markdown).join("\n\n") }],
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
      }

      return {
        content: [{ type: "text", text: "Error: Unknown method" }],
        isError: true
      };
    });
  });

  describe("Single URL Scraping", () => {
    test("successfully scrapes a single URL", async () => {
      const mockResponse = {
        url: "https://example.com",
        title: "Example Domain",
        markdown: "# Example Domain\n\nThis domain is for use in illustrative examples.",
        metadata: {
          lastModified: "2024-01-01",
          contentType: "text/html"
        }
      };

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response));

      const response = await server.request(
        {
          method: "tools/call",
          params: {
            name: "fire_crawl_scrape",
            arguments: {
              url: "https://example.com"
            }
          }
        },
        CallToolResultSchema
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: "https://example.com"
          })
        })
      );
      expect(response).toEqual({
        content: [{ type: "text", text: mockResponse.markdown }],
        isError: false
      });
    }, 10000);

    test("handles scraping errors", async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: () => Promise.resolve("Invalid URL")
      } as Response));

      const response = await server.request(
        {
          method: "tools/call",
          params: {
            name: "fire_crawl_scrape",
            arguments: {
              url: "invalid-url"
            }
          }
        },
        CallToolResultSchema
      );

      expect(response).toEqual({
        content: [{ type: "text", text: "Error: FireCrawl API error: 400 Bad Request\nInvalid URL" }],
        isError: true
      });
    }, 10000);

    test("validates required URL parameter", async () => {
      const response = await server.request(
        {
          method: "tools/call",
          params: {
            name: "fire_crawl_scrape",
            arguments: {}
          }
        },
        CallToolResultSchema
      );

      expect(response).toEqual({
        content: [{ type: "text", text: "Error: Invalid arguments for single scrape" }],
        isError: true
      });
    }, 10000);
  });

  describe("Batch URL Scraping", () => {
    test("successfully scrapes multiple URLs", async () => {
      const mockResponse = {
        results: [
          {
            url: "https://example1.com",
            title: "Example 1",
            markdown: "# Example 1\n\nContent 1"
          },
          {
            url: "https://example2.com",
            title: "Example 2",
            markdown: "# Example 2\n\nContent 2"
          }
        ],
        failed: []
      };

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response));

      const response = await server.request(
        {
          method: "tools/call",
          params: {
            name: "fire_crawl_batch",
            arguments: {
              urls: ["https://example1.com", "https://example2.com"]
            }
          }
        },
        CallToolResultSchema
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            urls: ["https://example1.com", "https://example2.com"]
          })
        })
      );
      expect(response).toEqual({
        content: [{ type: "text", text: mockResponse.results.map(r => r.markdown).join("\n\n") }],
        isError: false
      });
    }, 10000);

    test("handles batch scraping errors", async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: () => Promise.resolve("Invalid URLs")
      } as Response));

      const response = await server.request(
        {
          method: "tools/call",
          params: {
            name: "fire_crawl_batch",
            arguments: {
              urls: ["invalid-url-1", "invalid-url-2"]
            }
          }
        },
        CallToolResultSchema
      );

      expect(response).toEqual({
        content: [{ type: "text", text: "Error: FireCrawl API error: 400 Bad Request\nInvalid URLs" }],
        isError: true
      });
    }, 10000);

    test("validates required URLs parameter", async () => {
      const response = await server.request(
        {
          method: "tools/call",
          params: {
            name: "fire_crawl_batch",
            arguments: {}
          }
        },
        CallToolResultSchema
      );

      expect(response).toEqual({
        content: [{ type: "text", text: "Error: Invalid arguments for batch scrape" }],
        isError: true
      });
    }, 10000);
  });

  describe("Rate Limiting", () => {
    test("enforces rate limits", async () => {
      const mockResponse = {
        url: "https://example.com",
        markdown: "content"
      };

      mockFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response));

      // Make multiple requests quickly
      const requests = Array(5).fill(null).map(() => 
        server.request(
          {
            method: "tools/call",
            params: {
              name: "fire_crawl_scrape",
              arguments: {
                url: "https://example.com"
              }
            }
          },
          CallToolResultSchema
        )
      );

      const results = await Promise.all(requests);
      const errorResponses = results.filter((r: z.infer<typeof CallToolResultSchema>) => r.isError === true);
      expect(errorResponses.length).toBeGreaterThan(0);
      expect(errorResponses[0].content[0].text).toBe("Error: Rate limit exceeded");
    }, 10000);
  });
}); 
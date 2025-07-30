import { main as digestRssFeed } from "./index";
import { Storage } from "@google-cloud/storage";
import Parser from "rss-parser";
import { Request, Response } from "@google-cloud/functions-framework";

jest.mock("@google-cloud/storage");
const mockSave = jest.fn();
const mockDownload = jest.fn();
const mockFile = {
  save: mockSave,
  download: mockDownload,
};
const mockBucket = {
  file: jest.fn(() => mockFile),
};
(Storage as unknown as jest.Mock).mockImplementation(() => ({
  bucket: jest.fn(() => mockBucket),
}));

jest.mock("rss-parser");
const mockParseURL = jest.fn();
(Parser as jest.Mock).mockImplementation(() => ({
  parseURL: mockParseURL,
}));

const MOCK_RAW_HTML_BUCKET_NAME = "test-raw-html-bucket";
const MOCK_RSS_FEED_URL = "http://example.com/feed.xml";

process.env.RAW_HTML_BUCKET_NAME = MOCK_RAW_HTML_BUCKET_NAME;
process.env.RSS_FEED_URL = MOCK_RSS_FEED_URL;

describe("digestRssFeed", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    mockDownload.mockRejectedValueOnce({ code: 404 });
  });

  it("should process new RSS items and save them to storage", async () => {
    const mockRssItems = [
      {
        title: "Test Post 1",
        link: "http://example.com/post1",
        pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
        content: "<p>Content of post 1</p>",
      },
      {
        title: "Test Post 2",
        link: "http://example.com/post2",
        pubDate: "Tue, 02 Jan 2024 00:00:00 GMT",
        content: "<p>Content of post 2</p>",
      },
    ];

    mockParseURL.mockResolvedValueOnce({ items: mockRssItems });

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockParseURL).toHaveBeenCalledWith(MOCK_RSS_FEED_URL);

    expect(mockBucket.file).toHaveBeenCalledTimes(3);
    expect(mockSave).toHaveBeenCalledTimes(3);

    const htmlContent1 = mockSave.mock.calls[0][0];
    expect(htmlContent1).toContain('data-title="Test Post 1"');
    expect(htmlContent1).toContain('data-url="http://example.com/post1"');
    expect(htmlContent1).toContain("<p>Content of post 1</p>");
    expect(mockSave.mock.calls[0][1]).toEqual({ contentType: "text/html" });

    const htmlContent2 = mockSave.mock.calls[1][0];
    expect(htmlContent2).toContain('data-title="Test Post 2"');
    expect(htmlContent2).toContain('data-url="http://example.com/post2"');
    expect(htmlContent2).toContain("<p>Content of post 2</p>");
    expect(mockSave.mock.calls[1][1]).toEqual({ contentType: "text/html" });

    const processedItemsJson = mockSave.mock.calls[2][0];
    expect(JSON.parse(processedItemsJson)).toEqual([
      "http://example.com/post1",
      "http://example.com/post2",
    ]);
    expect(mockSave.mock.calls[2][1]).toEqual({ contentType: "application/json" });

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.send).toHaveBeenCalledWith(
      "New RSS feed digestion completed successfully.",
    );
  });

  it("should not process items if the RSS feed is empty", async () => {
    mockParseURL.mockResolvedValueOnce({ items: [] });

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockParseURL).toHaveBeenCalledWith(MOCK_RSS_FEED_URL);
    expect(mockBucket.file).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.send).toHaveBeenCalledWith("No RSS items to process.");
  });

  it("should not process items if no new items are found", async () => {
    const existingItems = ["http://example.com/post1", "http://example.com/post2"];

    mockDownload.mockResolvedValueOnce([Buffer.from(JSON.stringify(existingItems))]);

    const mockRssItems = [
      {
        title: "Test Post 1",
        link: "http://example.com/post1",
        pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
        content: "<p>Content of post 1</p>",
      },
      {
        title: "Test Post 2",
        link: "http://example.com/post2",
        pubDate: "Tue, 02 Jan 2024 00:00:00 GMT",
        content: "<p>Content of post 2</p>",
      },
    ];
    mockParseURL.mockResolvedValueOnce({ items: mockRssItems });

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockDownload).toHaveBeenCalledWith();
    expect(mockBucket.file).toHaveBeenCalledWith("processed_rss_items.json");

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.send).toHaveBeenCalledWith("No new RSS items to process.");
  });

  it("should handle mixed new and existing items", async () => {
    const existingItems = ["http://example.com/post1"];
    mockDownload.mockResolvedValueOnce([Buffer.from(JSON.stringify(existingItems))]);

    const mockRssItems = [
      {
        title: "Test Post 1",
        link: "http://example.com/post1",
        pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
        content: "<p>Content of post 1</p>",
      },
      {
        title: "Test Post 3",
        link: "http://example.com/post3",
        pubDate: "Wed, 03 Jan 2024 00:00:00 GMT",
        content: "<p>Content of post 3</p>",
      },
    ];
    mockParseURL.mockResolvedValueOnce({ items: mockRssItems });

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockBucket.file).toHaveBeenCalledTimes(2);
    expect(mockSave).toHaveBeenCalledTimes(2);

    const htmlContent = mockSave.mock.calls[0][0];
    expect(htmlContent).toContain('data-title="Test Post 3"');
    expect(htmlContent).toContain('data-url="http://example.com/post3"');

    const processedItemsJson = mockSave.mock.calls[1][0];
    expect(JSON.parse(processedItemsJson)).toEqual([
      "http://example.com/post1",
      "http://example.com/post3",
    ]);

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.send).toHaveBeenCalledWith(
      "New RSS feed digestion completed successfully.",
    );
  });

  it("should handle errors during RSS feed fetching", async () => {
    const errorMessage = "Failed to fetch feed";
    mockParseURL.mockRejectedValueOnce(new Error(errorMessage));

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockParseURL).toHaveBeenCalledWith(MOCK_RSS_FEED_URL);
    expect(mockBucket.file).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.send).toHaveBeenCalledWith(`Error processing RSS feed: ${errorMessage}`);
  });

  it("should handle errors during HTML file saving", async () => {
    const mockRssItems = [
      {
        title: "Test Post 1",
        link: "http://example.com/post1",
        pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
        content: "<p>Content of post 1</p>",
      },
    ];
    mockParseURL.mockResolvedValueOnce({ items: mockRssItems });
    const errorMessage = "Storage write error";
    mockSave.mockRejectedValueOnce(new Error(errorMessage));

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockParseURL).toHaveBeenCalledWith(MOCK_RSS_FEED_URL);

    expect(mockBucket.file).toHaveBeenCalledTimes(2);
    expect(mockBucket.file).toHaveBeenCalledWith("processed_rss_items.json");
    expect(mockBucket.file).toHaveBeenCalledWith(expect.stringContaining("raw-html/Test_Post_1-"));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.send).toHaveBeenCalledWith(`Error processing RSS feed: ${errorMessage}`);
  });
});

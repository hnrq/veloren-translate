jest.mock('@google-cloud/storage');

import { Storage } from '@google-cloud/storage';
import Parser from 'rss-parser';
import { Request, Response } from '@google-cloud/functions-framework';

const mockSave = jest.fn();
const mockDownload = jest.fn();
const mockFile = jest.fn(() => ({
  save: mockSave,
  download: mockDownload,
}));
const mockBucket = jest.fn(() => ({
  file: mockFile,
}));

jest.mocked(Storage).mockImplementation(() => ({ bucket: mockBucket }) as any);

import { main as digestRssFeed } from './index';

describe('digestRssFeed', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  const mockParseURL = jest.spyOn(Parser.prototype, 'parseURL');

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    mockDownload.mockRejectedValueOnce({ code: 404 });
  });

  it('processes new RSS items and save them to storage', async () => {
    const mockRssItems = [
      {
        title: 'Test Post 1',
        link: 'http://example.com/post1',
        pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
        content: '<p>Content of post 1</p>',
      },
      {
        title: 'Test Post 2',
        link: 'http://example.com/post2',
        pubDate: 'Tue, 02 Jan 2024 00:00:00 GMT',
        content: '<p>Content of post 2</p>',
      },
    ];

    mockParseURL.mockResolvedValueOnce({ items: mockRssItems });

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockParseURL).toHaveBeenCalledWith(process.env.RSS_FEED_URL);

    expect(mockFile).toHaveBeenCalledTimes(4);
    expect(mockSave).toHaveBeenCalledTimes(3);

    const htmlContent1 = mockSave.mock.calls[0][0];
    expect(htmlContent1).toContain('data-title="Test Post 1"');
    expect(htmlContent1).toContain('data-url="http://example.com/post1"');
    expect(htmlContent1).toContain('<p>Content of post 1</p>');
    expect(mockSave.mock.calls[0][1]).toEqual({ contentType: 'text/html' });

    const htmlContent2 = mockSave.mock.calls[1][0];
    expect(htmlContent2).toContain('data-title="Test Post 2"');
    expect(htmlContent2).toContain('data-url="http://example.com/post2"');
    expect(htmlContent2).toContain('<p>Content of post 2</p>');
    expect(mockSave.mock.calls[1][1]).toEqual({ contentType: 'text/html' });

    const processedItemsJson = mockSave.mock.calls[2][0];
    expect(JSON.parse(processedItemsJson)).toEqual([
      'http://example.com/post1',
      'http://example.com/post2',
    ]);
    expect(mockSave.mock.calls[2][1]).toEqual({
      contentType: 'application/json',
    });

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.send).toHaveBeenCalledWith(
      'New RSS feed digestion completed successfully.',
    );
  });

  it('does not process items if the RSS feed is empty', async () => {
    mockParseURL.mockResolvedValueOnce({ items: [] });

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockParseURL).toHaveBeenCalledWith(process.env.RSS_FEED_URL);
    expect(mockFile).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.send).toHaveBeenCalledWith('No RSS items to process.');
  });

  it('does not process items if no new items are found', async () => {
    const existingItems = [
      'http://example.com/post1',
      'http://example.com/post2',
    ];

    mockDownload.mockReset();
    mockDownload.mockResolvedValueOnce([
      Buffer.from(JSON.stringify(existingItems)),
    ]);

    const mockRssItems = [
      {
        title: 'Test Post 1',
        link: 'http://example.com/post1',
        pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
        content: '<p>Content of post 1</p>',
      },
      {
        title: 'Test Post 2',
        link: 'http://example.com/post2',
        pubDate: 'Tue, 02 Jan 2024 00:00:00 GMT',
        content: '<p>Content of post 2</p>',
      },
    ];
    mockParseURL.mockResolvedValueOnce({ items: mockRssItems });

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockDownload).toHaveBeenCalledWith();
    expect(mockFile).toHaveBeenCalledWith('processed_rss_items.json');

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.send).toHaveBeenCalledWith(
      'No new RSS items to process.',
    );
  });

  it('handles mixed new and existing items', async () => {
    const existingItems = ['http://example.com/post1'];
    mockDownload.mockReset();
    mockDownload.mockResolvedValueOnce([
      Buffer.from(JSON.stringify(existingItems)),
    ]);

    const mockRssItems = [
      {
        title: 'Test Post 1',
        link: 'http://example.com/post1',
        pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
        content: '<p>Content of post 1</p>',
      },
      {
        title: 'Test Post 3',
        link: 'http://example.com/post3',
        pubDate: 'Wed, 03 Jan 2024 00:00:00 GMT',
        content: '<p>Content of post 3</p>',
      },
    ];
    mockParseURL.mockResolvedValueOnce({ items: mockRssItems });

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockFile).toHaveBeenCalledTimes(3);
    expect(mockSave).toHaveBeenCalledTimes(2);

    const htmlContent = mockSave.mock.calls[0][0];
    expect(htmlContent).toContain('data-title="Test Post 3"');
    expect(htmlContent).toContain('data-url="http://example.com/post3"');

    const processedItemsJson = mockSave.mock.calls[1][0];
    expect(JSON.parse(processedItemsJson)).toEqual([
      'http://example.com/post1',
      'http://example.com/post3',
    ]);

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.send).toHaveBeenCalledWith(
      'New RSS feed digestion completed successfully.',
    );
  });

  it('handles errors during RSS feed fetching', async () => {
    const errorMessage = 'Failed to fetch feed';
    mockParseURL.mockRejectedValueOnce(new Error(errorMessage));

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockParseURL).toHaveBeenCalledWith(process.env.RSS_FEED_URL);
    expect(mockFile).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.send).toHaveBeenCalledWith(
      `Error processing RSS feed: ${errorMessage}`,
    );
  });

  it('handles errors during HTML file saving', async () => {
    const mockRssItems = [
      {
        title: 'Test Post 1',
        link: 'http://example.com/post1',
        pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
        content: '<p>Content of post 1</p>',
      },
    ];
    mockParseURL.mockResolvedValueOnce({ items: mockRssItems });
    const errorMessage = 'Storage write error';
    mockSave.mockRejectedValueOnce(new Error(errorMessage));

    await digestRssFeed(mockRequest as Request, mockResponse as Response);

    expect(mockParseURL).toHaveBeenCalledWith(process.env.RSS_FEED_URL);

    expect(mockFile).toHaveBeenCalledTimes(2);
    expect(mockFile).toHaveBeenCalledWith('processed_rss_items.json');
    expect(mockFile).toHaveBeenCalledWith(
      expect.stringContaining('raw-html/Test_Post_1-'),
    );
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.send).toHaveBeenCalledWith(
      `Error processing RSS feed: ${errorMessage}`,
    );
  });
});

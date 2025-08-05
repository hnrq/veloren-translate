import { main as htmlToContent } from './index';
import { Bucket, Storage } from '@google-cloud/storage';

jest.mock('@google-cloud/storage');

describe('htmlToContent', () => {
  let mockCloudEvent: any;
  const mockSave = jest.fn();
  const mockDownload = jest.fn();
  const mockBucket = {
    file: jest.fn(() => ({ save: mockSave, download: mockDownload })),
  };
  jest
    .spyOn(Storage.prototype, 'bucket')
    .mockImplementation(() => mockBucket as unknown as Bucket);

  beforeEach(() => {
    mockCloudEvent = {
      bucket: process.env.TRANSLATED_HTML_BUCKET_NAME,
      name: 'test-post-123_es_translations.html',
      contentType: 'text/html',
      id: 'test-event-id',
      source:
        '//storage.googleapis.com/projects/_/buckets/test-translated-html-bucket',
      specversion: '1.0',
      type: 'google.cloud.storage.object.v1.finalized',
      time: new Date().toISOString(),
      subject: 'objects/test-post-123_es_translations.html',
    };

    mockDownload.mockResolvedValueOnce([
      Buffer.from(`
      <div style="display:none;"
           data-title="Translated Test Post"
           data-pubdate="2024-07-30T10:00:00Z"
           data-url="http://example.com/original-post"
           data-cover="http://bucket.example/post1">
      </div>
      <h1>Hello World</h1><p>This is a test paragraph.</p>
    `),
    ]);
  });

  it('converts HTML to JSON', async () => {
    const timestamp = new Date('2024-07-30T10:00:00Z');
    jest.useFakeTimers().setSystemTime(timestamp);
    await htmlToContent(mockCloudEvent);

    expect(mockBucket.file).toHaveBeenCalledWith(
      'test-post-123_es_translations.html',
    );
    expect(mockDownload).toHaveBeenCalled();

    expect(mockBucket.file).toHaveBeenCalledWith(
      `es/${timestamp.getTime()}/test-post-123.json`,
    );
    expect(mockSave).toHaveBeenCalledTimes(1);

    const savedJson = JSON.parse(mockSave.mock.calls[0][0]);
    expect(savedJson).toHaveProperty('title', 'Translated Test Post');
    expect(savedJson).toHaveProperty('language', 'es');
    expect(savedJson).toHaveProperty('date', '2024-07-30T10:00:00Z');
    expect(savedJson).toHaveProperty(
      'source_url',
      'http://example.com/original-post',
    );
    expect(savedJson).toHaveProperty('content');
    expect(savedJson).toHaveProperty('cover', 'http://bucket.example/post1');
    expect(savedJson.content).toContain('<h1>Hello World</h1>');
    expect(savedJson).toHaveProperty('slug', 'translated-test-post');
    expect(mockSave.mock.calls[0][1]).toEqual({
      contentType: 'application/json',
    });
  });

  it('ignores files from unexpected buckets', async () => {
    mockCloudEvent.bucket = 'some-other-bucket';

    await htmlToContent(mockCloudEvent);

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips files without a language prefix', async () => {
    mockCloudEvent.name = 'no-language-prefix.html';

    await htmlToContent(mockCloudEvent);

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('handles missing file data in the event', async () => {
    await expect(htmlToContent(null as any)).rejects.toThrow(Error);
  });

  it('handles errors during JSON file saving', async () => {
    const errorMessage = 'Storage save error';
    mockSave.mockRejectedValueOnce(new Error(errorMessage));

    await expect(htmlToContent(mockCloudEvent)).rejects.toThrow(Error);
    expect(mockDownload).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

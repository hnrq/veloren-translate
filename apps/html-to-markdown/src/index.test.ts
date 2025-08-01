import { main as htmlToMarkdown } from './index';
import { Bucket, Storage } from '@google-cloud/storage';
import TurndownService from 'turndown';
import * as yaml from 'js-yaml';
import { CloudEvent } from '@google-cloud/functions-framework';

jest.mock('@google-cloud/storage');

jest.mock('js-yaml', () => ({ dump: jest.fn() }));

describe('htmlToMarkdown', () => {
  let mockCloudEvent: CloudEvent<any>;
  const mockTurndown = jest.spyOn(TurndownService.prototype, 'turndown');
  const mockYamlDump = jest.spyOn(yaml, 'dump');
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
      data: {
        bucket: process.env.TRANSLATED_HTML_BUCKET_NAME,
        name: 'test-post-123_es_translations.html',
        contentType: 'text/html',
      },

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
           data-url="http://example.com/original-post">
      </div>
      <h1>Hello World</h1><p>This is a test paragraph.</p>
    `),
    ]);

    mockTurndown.mockReturnValue(
      '### Translated Test Post\n\nHello World\n\nThis is a test paragraph.',
    );

    mockYamlDump.mockReturnValue(`title: Translated Test Post
date: 2024-07-30T10:00:00Z
source_url: http://example.com/original-post
language: es
`);
  });

  it('converts HTML to Markdown with frontmatter', async () => {
    await htmlToMarkdown(mockCloudEvent);

    expect(mockBucket.file).toHaveBeenCalledWith(
      'test-post-123_es_translations.html',
    );
    expect(mockDownload).toHaveBeenCalled();

    expect(mockTurndown).toHaveBeenCalledWith(
      expect.stringContaining(
        '<h1>Hello World</h1><p>This is a test paragraph.</p>',
      ),
    );

    expect(mockYamlDump).toHaveBeenCalledWith({
      title: 'Translated Test Post',
      date: '2024-07-30T10:00:00Z',
      source_url: 'http://example.com/original-post',
      language: 'es',
    });

    expect(mockBucket.file).toHaveBeenCalledWith('es/test-post-123.md');
    expect(mockSave).toHaveBeenCalledTimes(1);

    const savedMarkdown = mockSave.mock.calls[0][0];
    expect(savedMarkdown).toContain('---');
    expect(savedMarkdown).toContain('title: Translated Test Post');
    expect(savedMarkdown).toContain('language: es');
    expect(savedMarkdown).toContain('### Translated Test Post');
    expect(savedMarkdown).toContain('This is a test paragraph.');
    expect(mockSave.mock.calls[0][1]).toEqual({ contentType: 'text/markdown' });
  });

  it('ignores files from unexpected buckets', async () => {
    mockCloudEvent.data.bucket = 'some-other-bucket';

    await htmlToMarkdown(mockCloudEvent);

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockTurndown).not.toHaveBeenCalled();
    expect(mockYamlDump).not.toHaveBeenCalled();
  });

  it('skips files without a language prefix', async () => {
    mockCloudEvent.data.name = 'no-language-prefix.html';

    await htmlToMarkdown(mockCloudEvent);

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockTurndown).not.toHaveBeenCalled();
    expect(mockYamlDump).not.toHaveBeenCalled();
  });

  it('handles missing file data in the event', async () => {
    const emptyEvent: CloudEvent<any> = {
      data: null,
      id: '1',
      source: 'test',
      specversion: '1.0',
      type: 'test',
    };

    await htmlToMarkdown(emptyEvent);

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('handles errors during Markdown conversion', async () => {
    const errorMessage = 'Turndown error';
    mockTurndown.mockImplementationOnce(() => {
      throw new Error(errorMessage);
    });

    await htmlToMarkdown(mockCloudEvent);

    expect(mockDownload).toHaveBeenCalled();
    expect(mockTurndown).toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockYamlDump).not.toHaveBeenCalled();
  });

  it('handles errors during Markdown file saving', async () => {
    const errorMessage = 'Storage save error';
    mockSave.mockRejectedValueOnce(new Error(errorMessage));

    await htmlToMarkdown(mockCloudEvent);

    expect(mockDownload).toHaveBeenCalled();
    expect(mockTurndown).toHaveBeenCalled();
    expect(mockYamlDump).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

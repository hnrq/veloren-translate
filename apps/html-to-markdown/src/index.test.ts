import { main as htmlToMarkdown } from './index';
import { Storage } from '@google-cloud/storage';
import TurndownService from 'turndown';
import * as yaml from 'js-yaml';
import { CloudEvent } from '@google-cloud/functions-framework';

jest.mock('@google-cloud/storage');
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

jest.mock('turndown');
const mockTurndown = jest.fn();
(TurndownService as jest.Mock).mockImplementation(() => ({
  turndown: mockTurndown,
}));

jest.mock('js-yaml');
const mockYamlDump = jest.fn();
(yaml as any).dump = mockYamlDump;

const MOCK_TRANSLATED_HTML_BUCKET_NAME = 'test-translated-html-bucket';
const MOCK_MARKDOWN_BUCKET_NAME = 'test-markdown-bucket';

process.env.TRANSLATED_HTML_BUCKET_NAME = MOCK_TRANSLATED_HTML_BUCKET_NAME;
process.env.MARKDOWN_BUCKET_NAME = MOCK_MARKDOWN_BUCKET_NAME;

describe('htmlToMarkdown', () => {
  let mockCloudEvent: CloudEvent<any>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCloudEvent = {
      data: {
        bucket: MOCK_TRANSLATED_HTML_BUCKET_NAME,
        name: 'es/test-post-123.html',
        contentType: 'text/html',
      },

      id: 'test-event-id',
      source: '//storage.googleapis.com/projects/_/buckets/test-translated-html-bucket',
      specversion: '1.0',
      type: 'google.cloud.storage.object.v1.finalized',
      time: new Date().toISOString(),
      subject: 'objects/es/test-post-123.html',
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

  it('should convert HTML to Markdown with frontmatter for Spanish', async () => {
    await htmlToMarkdown(mockCloudEvent);

    expect(mockBucket.file).toHaveBeenCalledWith('es/test-post-123.html');
    expect(mockDownload).toHaveBeenCalled();

    expect(mockTurndown).toHaveBeenCalledWith(
      '<h1>Hello World</h1><p>This is a test paragraph.</p>',
    );

    expect(mockYamlDump).toHaveBeenCalledWith({
      title: 'Translated Test Post',
      date: '2024-07-30T10:00:00Z',
      source_url: 'http://example.com/original-post',
      language: 'es',
    });

    expect(mockBucket.file).toHaveBeenCalledWith('markdown/es/test-post-123.md');
    expect(mockSave).toHaveBeenCalledTimes(1);

    const savedMarkdown = mockSave.mock.calls[0][0];
    expect(savedMarkdown).toContain('---');
    expect(savedMarkdown).toContain('title: Translated Test Post');
    expect(savedMarkdown).toContain('language: es');
    expect(savedMarkdown).toContain('### Translated Test Post');
    expect(savedMarkdown).toContain('This is a test paragraph.');
    expect(mockSave.mock.calls[0][1]).toEqual({ contentType: 'text/markdown' });
  });

  it('should convert HTML to Markdown with frontmatter for Portuguese', async () => {
    mockCloudEvent.data.name = 'pt-br/outro-post.html';
    mockDownload.mockResolvedValueOnce([
      Buffer.from(`
      <div style="display:none;"
           data-title="Post Traduzido"
           data-pubdate="2024-07-29T15:30:00Z"
           data-url="http://example.com/original-pt">
      </div>
      <h2>Olá Mundo</h2><p>Este é um parágrafo de teste.</p>
    `),
    ]);
    mockTurndown.mockReturnValue('## Olá Mundo\n\nEste é um parágrafo de teste.');
    mockYamlDump.mockReturnValue(`title: Post Traduzido
date: 2024-07-29T15:30:00Z
source_url: http://example.com/original-pt
language: pt-br
`);

    await htmlToMarkdown(mockCloudEvent);

    expect(mockBucket.file).toHaveBeenCalledWith('pt-br/outro-post.html');
    expect(mockTurndown).toHaveBeenCalledWith(
      '<h2>Olá Mundo</h2><p>Este é um parágrafo de teste.</p>',
    );
    expect(mockYamlDump).toHaveBeenCalledWith({
      title: 'Post Traduzido',
      date: '2024-07-29T15:30:00Z',
      source_url: 'http://example.com/original-pt',
      language: 'pt-br',
    });
    expect(mockBucket.file).toHaveBeenCalledWith('markdown/pt-br/outro-post.md');
    const savedMarkdown = mockSave.mock.calls[0][0];
    expect(savedMarkdown).toContain('language: pt-br');
  });

  it('should ignore files from unexpected buckets', async () => {
    mockCloudEvent.data.bucket = 'some-other-bucket';

    await htmlToMarkdown(mockCloudEvent);

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockTurndown).not.toHaveBeenCalled();
    expect(mockYamlDump).not.toHaveBeenCalled();
  });

  it('should skip files without a language prefix', async () => {
    mockCloudEvent.data.name = 'no-language-prefix.html';

    await htmlToMarkdown(mockCloudEvent);

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockTurndown).not.toHaveBeenCalled();
    expect(mockYamlDump).not.toHaveBeenCalled();
  });

  it('should handle missing file data in the event', async () => {
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

  it('should handle errors during HTML download', async () => {
    const errorMessage = 'File not found';
    mockDownload.mockRejectedValueOnce(new Error(errorMessage));

    await htmlToMarkdown(mockCloudEvent);

    expect(mockDownload).toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockTurndown).not.toHaveBeenCalled();
    expect(mockYamlDump).not.toHaveBeenCalled();
  });

  it('should handle errors during Markdown conversion', async () => {
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

  it('should handle errors during Markdown file saving', async () => {
    const errorMessage = 'Storage save error';
    mockSave.mockRejectedValueOnce(new Error(errorMessage));

    await htmlToMarkdown(mockCloudEvent);

    expect(mockDownload).toHaveBeenCalled();
    expect(mockTurndown).toHaveBeenCalled();
    expect(mockYamlDump).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

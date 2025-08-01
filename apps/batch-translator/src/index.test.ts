import { TranslationServiceClient } from '@google-cloud/translate';
import { main as batchTranslate } from './index';

jest.mock('@google-cloud/translate');

describe('batchTranslate', () => {
  let batchTranslateTextSpy: jest.SpyInstance;

  beforeEach(() => {
    batchTranslateTextSpy = jest.spyOn(
      TranslationServiceClient.prototype,
      'batchTranslateText',
    );
    process.env.GCP_PROJECT = 'test-project';
    process.env.TRANSLATED_HTML_BUCKET_NAME = 'test-translated-bucket';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call batchTranslateText with the correct parameters', async () => {
    const mockOperation = {
      promise: jest.fn().mockResolvedValue(undefined),
      name: 'test-operation',
    };
    batchTranslateTextSpy.mockResolvedValue([mockOperation]);

    const data = { bucket: 'test-raw-bucket', name: 'test-file.html' } as any;
    await batchTranslate(data);

    expect(batchTranslateTextSpy).toHaveBeenCalledWith({
      parent: `projects/test-project/locations/global`,
      sourceLanguageCode: 'en',
      targetLanguageCodes: ['es', 'pt-BR'],
      inputConfigs: [
        {
          gcsSource: {
            inputUri: `gs://test-raw-bucket/test-file.html`,
          },
          mimeType: 'text/html',
        },
      ],
      outputConfig: {
        gcsDestination: {
          outputUriPrefix: `gs://test-translated-bucket/`,
        },
      },
    });
  });

  it('should log an error if batchTranslateText fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const error = new Error('test-error');
    batchTranslateTextSpy.mockRejectedValue(error);

    const data = { bucket: 'test-raw-bucket', name: 'test-file.html' } as any;
    await batchTranslate(data);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error starting batch translation operation:',
      error,
    );
    consoleErrorSpy.mockRestore();
  });
});

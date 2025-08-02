import { TranslationServiceClient } from '@google-cloud/translate';
import { CloudEvent } from '@google-cloud/functions-framework';

const translationClient = new TranslationServiceClient();

export const main = async (
  data: CloudEvent<{ bucket: string; name: string }>,
) => {
  const { bucket, name } = data;

  const projectId = process.env.GCP_PROJECT;
  const location = 'global';
  const outputBucketName = process.env.TRANSLATED_HTML_BUCKET_NAME;
  const outputUriPrefix = `gs://${outputBucketName}/${Date.now()}/`;

  const request = {
    parent: `projects/${projectId}/locations/${location}`,
    sourceLanguageCode: 'en',
    targetLanguageCodes: ['es', 'pt-BR'],
    inputConfigs: [
      {
        gcsSource: {
          inputUri: `gs://${bucket}/${name}`,
        },
        mimeType: 'text/html',
      },
    ],
    outputConfig: {
      gcsDestination: {
        outputUriPrefix,
      },
    },
  };

  try {
    const [operation] = await translationClient.batchTranslateText(request);
    console.log('Batch translation operation started:', operation.name);
    await operation.promise();
    console.log('Batch translation operation finished.');
  } catch (error) {
    console.error('Error starting batch translation operation:', error);
  }
};

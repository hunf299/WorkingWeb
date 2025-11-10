import vision from '@google-cloud/vision';

let client: vision.ImageAnnotatorClient | undefined;

export function getVisionClient() {
  if (!client) {
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!raw) throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS env');

    const credentials = JSON.parse(raw);
    client = new vision.ImageAnnotatorClient({ credentials });
  }
  return client;
}

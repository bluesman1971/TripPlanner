import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import path from 'path';

// ─── Client singleton ─────────────────────────────────────────────────────────

let client: S3Client | null = null;

function getR2Client(): S3Client {
  if (!client) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing Cloudflare R2 credentials (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    }

    client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

const BUCKET = () => {
  const b = process.env.R2_BUCKET_NAME;
  if (!b) throw new Error('R2_BUCKET_NAME is not set');
  return b;
};

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Upload a Buffer to R2.
 * Key format: `bookings/{tripId}/{uuid}{ext}` — never the original filename.
 * Returns the R2 key.
 */
export async function uploadToR2(
  buffer: Buffer,
  originalFilename: string,
  tripId: string,
  contentType: string,
): Promise<string> {
  const ext = path.extname(originalFilename).toLowerCase();
  const key = `bookings/${tripId}/${randomUUID()}${ext}`;

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: { originalFilename },
    }),
  );

  return key;
}

/**
 * Download an R2 object to a temp file and return the temp path.
 * Caller is responsible for deleting the temp file when done.
 */
export async function downloadFromR2ToTemp(r2Key: string): Promise<string> {
  const response = await getR2Client().send(
    new GetObjectCommand({ Bucket: BUCKET(), Key: r2Key }),
  );

  if (!response.Body) throw new Error(`Empty response body for R2 key: ${r2Key}`);

  const ext = path.extname(r2Key);
  const tempPath = path.join(tmpdir(), `ingest-${randomUUID()}${ext}`);

  // Stream to temp file
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  writeFileSync(tempPath, Buffer.concat(chunks));

  return tempPath;
}

/**
 * Delete an object from R2 (used for cleanup on failed ingestion).
 */
export async function deleteFromR2(r2Key: string): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({ Bucket: BUCKET(), Key: r2Key }),
  );
}

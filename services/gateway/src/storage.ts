import { Client } from 'minio'
import type { Config } from './config.js'

export function createStorage(config: Config): Client {
  const [host, portStr] = config.minioEndpoint.split(':')
  return new Client({
    endPoint: host!,
    port: Number(portStr ?? 9000),
    useSSL: config.minioUseSsl,
    accessKey: config.minioAccessKey,
    secretKey: config.minioSecretKey,
  })
}

export async function ensureBucket(client: Client, bucket: string): Promise<void> {
  const exists = await client.bucketExists(bucket)
  if (!exists) {
    await client.makeBucket(bucket)
  }
}

export async function putObject(
  client: Client,
  bucket: string,
  key: string,
  buffer: Buffer,
  size: number,
  mime: string,
): Promise<void> {
  await client.putObject(bucket, key, buffer, size, { 'Content-Type': mime })
}

export async function presignedGetUrl(
  client: Client,
  bucket: string,
  key: string,
  expiresSeconds = 900,
  name?: string,
): Promise<string> {
  // name 存在时附加 response-content-disposition，强制浏览器附件下载（attachment）而非内联预览，并保留原始文件名
  // minio 8.0.7 presignedGetObject(bucket, key, expires, respHeaders) 第 4 参 respHeaders: PreSignRequestParams 支持
  return client.presignedGetObject(
    bucket,
    key,
    expiresSeconds,
    name ? { 'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } : undefined,
  )
}

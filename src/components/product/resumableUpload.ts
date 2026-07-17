import * as tus from "tus-js-client";

export const MAX_FILE_SIZE = 500 * 1024 * 1024;

export function uploadToSupabase(options: {
  file: File;
  supabaseUrl: string;
  accessToken: string;
  objectName: string;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}) {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(options.file, {
      endpoint: `${options.supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${options.accessToken}`, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: "echo-files",
        objectName: options.objectName,
        contentType: options.file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: reject,
      onProgress: (uploaded, total) => options.onProgress(total ? Math.round((uploaded / total) * 100) : 0),
      onSuccess: () => resolve(),
    });
    options.signal?.addEventListener("abort", () => {
      void upload.abort(true);
      reject(new DOMException("上传已取消", "AbortError"));
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });
}

import { z } from 'zod';

import { problemSchema } from './problem.js';

// Contratos de mídia, compartilhados entre a API, o relay, o worker e o front.
// Importe por `@casebook/contracts/media`.

// ─── tipos e limites (RF-UP-4) ──────────────────────────────────────────────

/** Espelha os enums `media_kind` e `media_state` do banco. */
export const MEDIA_KINDS = ['image', 'video'] as const;
export const MEDIA_STATES = ['pending', 'uploaded', 'processing', 'ready', 'failed'] as const;

export const mediaKindSchema = z.enum(MEDIA_KINDS);
export const mediaStateSchema = z.enum(MEDIA_STATES);

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaState = z.infer<typeof mediaStateSchema>;

/** MIMEs aceitos por tipo. HEIF entra junto com HEIC: é o mesmo contêiner. */
export const ACCEPTED_MIME_TYPES = {
  image: [
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'image/tiff',
    'image/webp',
    'image/avif',
  ],
  video: ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'],
} as const satisfies Record<MediaKind, readonly string[]>;

const MiB = 1024 * 1024;

/** Tamanho máximo do original por tipo (RF-UP-4), em bytes. */
export const MEDIA_MAX_BYTES = {
  image: 50 * MiB,
  video: 2 * 1024 * MiB,
} as const satisfies Record<MediaKind, number>;

/** Tamanho de cada parte do multipart (a última pode ser menor). */
export const UPLOAD_PART_SIZE = 10 * MiB;
/** Validade das URLs presigned de upload. */
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;

/** Texto dos formatos aceitos, como aparece na área de soltar arquivos. */
export const ACCEPTED_IMAGE_FORMATS_LABEL = 'JPEG, PNG, TIFF, HEIC, WebP, AVIF';

/**
 * RAW de câmera: fora do MVP. A revelação muda a cor, e o produto promete
 * fidelidade ao que o autor entregou. DNG é TIFF por dentro e passaria pelo
 * sharp, por isso o worker também confere o conteúdo (Sprint 2, parte 2).
 */
export const RAW_EXTENSIONS = [
  '3fr',
  'ari',
  'arw',
  'bay',
  'braw',
  'cr2',
  'cr3',
  'crw',
  'dcr',
  'dng',
  'erf',
  'fff',
  'iiq',
  'k25',
  'kdc',
  'mef',
  'mos',
  'mrw',
  'nef',
  'nrw',
  'orf',
  'pef',
  'raf',
  'raw',
  'rw2',
  'rwl',
  'sr2',
  'srf',
  'srw',
  'x3f',
] as const;

const RAW_EXTENSION_SET: ReadonlySet<string> = new Set(RAW_EXTENSIONS);

/** MIMEs que browsers e sistemas atribuem a RAW (não há padrão; a lista é a prática). */
const RAW_MIME_PATTERN =
  /^image\/(x-)?(adobe-dng|dng|canon-cr[23w]|canon-crw|nikon-nef|nikon-nrw|sony-arw|sony-sr2|sony-srf|fuji-raf|olympus-orf|panasonic-rw2?|pentax-pef|samsung-srw|sigma-x3f|kodak-(dcr|k25|kdc)|minolta-mrw|hasselblad-3fr|phaseone-iiq|leaf-mos|mamiya-mef|epson-erf|raw)$/;

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** RAW pela extensão ou pelo MIME declarado. */
export function isRawFile(filename: string, mime: string): boolean {
  return (
    RAW_EXTENSION_SET.has(fileExtension(filename)) || RAW_MIME_PATTERN.test(mime.toLowerCase())
  );
}

export function mediaKindForMime(mime: string): MediaKind | undefined {
  const normalized = mime.toLowerCase();
  return MEDIA_KINDS.find((kind) =>
    (ACCEPTED_MIME_TYPES[kind] as readonly string[]).includes(normalized),
  );
}

export const RAW_NOT_SUPPORTED_MESSAGE =
  'Arquivos RAW não são aceitos porque a revelação muda a cor. Exporte em TIFF 16 bits ou JPEG do seu revelador.';
export const VIDEO_NOT_AVAILABLE_MESSAGE = 'Vídeo chega em breve.';

/** `type` dos Problem Details de mídia, para o front distinguir os casos. */
export const MEDIA_PROBLEM_TYPES = {
  rawNotSupported: 'urn:casebook:problem:media-raw-not-supported',
  videoNotAvailable: 'urn:casebook:problem:media-video-not-available',
  invalidTransition: 'urn:casebook:problem:media-invalid-transition',
  uploadIncomplete: 'urn:casebook:problem:media-upload-incomplete',
  inUse: 'urn:casebook:problem:media-in-use',
} as const;

export type UploadIntentCheck =
  | { ok: true; kind: MediaKind }
  | { ok: false; reason: 'raw' | 'unsupported_type' | 'video_disabled' }
  | { ok: false; reason: 'too_large'; maxBytes: number };

/**
 * Regras de tipo e tamanho da intenção de upload, na ordem em que a API as
 * aplica. O front usa a mesma função para recusar antes de calcular o hash.
 */
export function checkUploadIntent(
  file: { filename: string; mime: string; size_bytes: number },
  options: { videoEnabled: boolean },
): UploadIntentCheck {
  if (isRawFile(file.filename, file.mime)) return { ok: false, reason: 'raw' };
  const kind = mediaKindForMime(file.mime);
  if (!kind) return { ok: false, reason: 'unsupported_type' };
  if (kind === 'video' && !options.videoEnabled) return { ok: false, reason: 'video_disabled' };
  if (file.size_bytes > MEDIA_MAX_BYTES[kind]) {
    return { ok: false, reason: 'too_large', maxBytes: MEDIA_MAX_BYTES[kind] };
  }
  return { ok: true, kind };
}

// ─── máquina de estados (requisitos §6) ─────────────────────────────────────

/**
 * Transições válidas; qualquer outra é 409. A API implementa as suas em
 * `media-state.ts`; o worker, as dele (parte 2). `retry` volta para `uploaded`
 * e gera evento de outbox novo, como o `complete`: quem leva a `processing` é
 * sempre o worker, ao pegar o job.
 */
export const MEDIA_TRANSITIONS = {
  complete: { from: 'pending', to: 'uploaded' },
  startProcessing: { from: 'uploaded', to: 'processing' },
  finish: { from: 'processing', to: 'ready' },
  fail: { from: 'processing', to: 'failed' },
  retry: { from: 'failed', to: 'uploaded' },
} as const satisfies Record<string, { from: MediaState; to: MediaState }>;

export type MediaTransition = keyof typeof MEDIA_TRANSITIONS;

// ─── entrada ────────────────────────────────────────────────────────────────

/** Sem caractere de controle e sem separador de caminho. */
export const mediaFilenameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome do arquivo')
  .max(255, 'O nome pode ter no máximo 255 caracteres')
  // eslint-disable-next-line no-control-regex
  .refine((name) => !/[\u0000-\u001f\u007f/\\]/.test(name), 'Nome de arquivo inválido');

export const altTextSchema = z
  .string()
  .trim()
  .max(500, 'O texto alternativo pode ter no máximo 500 caracteres')
  .transform((alt) => (alt === '' ? null : alt))
  .nullable();

export const sha256HexSchema = z
  .string()
  .regex(/^[\da-fA-F]{64}$/, 'SHA-256 em hexadecimal, 64 caracteres')
  .transform((hex) => hex.toLowerCase());

/**
 * Intenção de upload (RF-UP-1). O `sha256` é calculado pelo cliente e serve à
 * deduplicação dentro da conta (RF-UP-3); o worker confere o conteúdo.
 */
export const createUploadRequestSchema = z.strictObject({
  filename: mediaFilenameSchema,
  // Vazio é aceito aqui: o browser manda `""` para extensão que não conhece
  // (caso típico de RAW), e a regra de RAW vem antes da de tipo.
  mime: z.string().trim().toLowerCase().max(127),
  size_bytes: z.number().int().positive('Arquivo vazio'),
  sha256: sha256HexSchema,
});

export const completeUploadRequestSchema = z.strictObject({
  parts: z
    .array(
      z.strictObject({
        part_number: z.number().int().min(1).max(10_000),
        etag: z.string().min(1).max(128),
      }),
    )
    .min(1, 'Informe as partes enviadas')
    .max(10_000)
    .refine(
      (parts) => new Set(parts.map((part) => part.part_number)).size === parts.length,
      'Parte repetida',
    ),
});

export const updateMediaSchema = z
  .strictObject({ filename: mediaFilenameSchema, alt_text: altTextSchema })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Informe ao menos um campo');

export const MEDIA_LIST_MAX_LIMIT = 50;

export const mediaListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MEDIA_LIST_MAX_LIMIT).default(MEDIA_LIST_MAX_LIMIT),
  kind: mediaKindSchema.optional(),
  state: mediaStateSchema.optional(),
  /** Busca por nome. Vazio é o mesmo que ausente. */
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((q) => (q === '' ? undefined : q)),
});

export const deleteMediaQuerySchema = z.object({
  confirm: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

// ─── saída ──────────────────────────────────────────────────────────────────

const hexColor = z.string().regex(/^#[\da-f]{6}$/);

/** `media_assets.palette` (requisitos §6). Cores em sRGB, prontas para CSS. */
export const paletteSchema = z.object({
  dominant: hexColor,
  colors: z.array(
    z.object({
      hex: hexColor,
      ratio: z.number().min(0).max(1),
      contrast_white: z.number(),
      contrast_black: z.number(),
    }),
  ),
  suggested: z.object({ bg: hexColor, fg: hexColor, accent: hexColor }),
});

export const mediaDerivativeResponseSchema = z.object({
  kind: z.string(),
  format: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().int(),
  url: z.url(),
  ssim: z.number().nullable(),
  quality: z.number().int().nullable(),
});

export const mediaAssetResponseSchema = z.object({
  id: z.uuid(),
  kind: mediaKindSchema,
  state: mediaStateSchema,
  filename: z.string(),
  alt_text: z.string().nullable(),
  mime: z.string(),
  size_bytes: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  palette: paletteSchema.nullable(),
  /** Menor derivativo WebP, para miniaturas; `null` até o asset ficar pronto. */
  thumbnail_url: z.url().nullable(),
  error_message: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const mediaAssetDetailResponseSchema = mediaAssetResponseSchema.extend({
  derivatives: z.array(mediaDerivativeResponseSchema),
});

export const presignedPartSchema = z.object({
  part_number: z.number().int(),
  url: z.url(),
});

export const createUploadResponseSchema = z.object({
  asset: mediaAssetResponseSchema,
  /** O arquivo já existe na conta: nada a enviar, `upload` é `null`. */
  deduplicated: z.boolean(),
  upload: z
    .object({
      part_size: z.number().int(),
      parts: z.array(presignedPartSchema),
      expires_at: z.iso.datetime(),
    })
    .nullable(),
});

export const mediaListResponseSchema = z.object({
  items: z.array(mediaAssetResponseSchema),
  /** Passe em `cursor` para a próxima página; `null` na última. */
  next_cursor: z.string().nullable(),
});

/** 409 do DELETE de asset usado em blocos, sem `?confirm=true` (RF-LIB-3). */
export const mediaInUseProblemSchema = problemSchema.extend({
  requires_confirmation: z.literal(true),
  projects: z.array(z.object({ id: z.uuid(), title: z.string(), slug: z.string() })),
});

// ─── eventos em tempo real (SSE, parte 2) ───────────────────────────────────

/**
 * Etapa mostrada no card. `hashing` e `uploading` só existem no cliente; as
 * demais vêm do servidor. Texto de cada uma no front: "Calculando…",
 * "Enviando 42%", "Na fila", "Otimizando 68%", "Extraindo paleta".
 */
export const MEDIA_STAGES = ['hashing', 'uploading', 'queued', 'optimizing', 'palette'] as const;
export const SERVER_MEDIA_STAGES = ['queued', 'optimizing', 'palette'] as const;

export const mediaStageSchema = z.enum(MEDIA_STAGES);

export const mediaEventSchema = z.object({
  media_id: z.uuid(),
  state: mediaStateSchema,
  stage: z.enum(SERVER_MEDIA_STAGES).nullable(),
  /** 0–100 dentro da etapa; `null` quando a etapa não mede progresso. */
  progress: z.number().int().min(0).max(100).nullable(),
  error_message: z.string().nullable(),
  at: z.iso.datetime(),
});

export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;
export type Palette = z.infer<typeof paletteSchema>;
export type MediaDerivativeResponse = z.infer<typeof mediaDerivativeResponseSchema>;
export type MediaAssetResponse = z.infer<typeof mediaAssetResponseSchema>;
export type MediaAssetDetailResponse = z.infer<typeof mediaAssetDetailResponseSchema>;
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>;
export type MediaInUseProblem = z.infer<typeof mediaInUseProblemSchema>;
export type MediaStage = z.infer<typeof mediaStageSchema>;
export type MediaEvent = z.infer<typeof mediaEventSchema>;

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  type PipeTransform,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { z } from 'zod';

import {
  type CompleteUploadRequest,
  completeUploadRequestSchema,
  type CreateUploadRequest,
  createUploadRequestSchema,
  type CreateUploadResponse,
  deleteMediaQuerySchema,
  type MediaAssetDetailResponse,
  type MediaAssetResponse,
  type MediaListQuery,
  mediaListQuerySchema,
  type MediaListResponse,
  type UpdateMediaInput,
  updateMediaSchema,
} from '@casebook/contracts/media';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

import { MediaService } from './media.service.js';

import type { AuthUser } from '../auth/auth.types.js';
import type { FastifyReply } from 'fastify';

/** `:id` que não é UUID é tão inexistente quanto um UUID desconhecido: 404. */
class MediaIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!z.uuid().safeParse(value).success) throw new NotFoundException('Mídia não encontrada');
    return value;
  }
}

/** Biblioteca de mídia. Toda rota é do usuário do token (RNF-9). */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** 201 com URLs de upload; 200 quando o arquivo já existe na conta. */
  @Post('uploads')
  async createUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUploadRequestSchema)) body: CreateUploadRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CreateUploadResponse> {
    const result = await this.media.createUpload(user.id, body);
    void reply.status(result.status).header('cache-control', 'no-store');
    return result.body;
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', MediaIdPipe) id: string,
    @Body(new ZodValidationPipe(completeUploadRequestSchema)) body: CompleteUploadRequest,
  ): Promise<MediaAssetResponse> {
    return this.media.complete(user.id, id, body);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  retry(
    @CurrentUser() user: AuthUser,
    @Param('id', MediaIdPipe) id: string,
  ): Promise<MediaAssetResponse> {
    return this.media.retry(user.id, id);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(mediaListQuerySchema)) query: MediaListQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MediaListResponse> {
    void reply.header('cache-control', 'private, no-store');
    return this.media.list(user.id, query);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', MediaIdPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MediaAssetDetailResponse> {
    void reply.header('cache-control', 'private, no-store');
    return this.media.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', MediaIdPipe) id: string,
    @Body(new ZodValidationPipe(updateMediaSchema)) body: UpdateMediaInput,
  ): Promise<MediaAssetResponse> {
    return this.media.update(user.id, id, body);
  }

  /** Soft delete. Mídia usada em blocos exige `?confirm=true` (409 sem ele). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', MediaIdPipe) id: string,
    @Query(new ZodValidationPipe(deleteMediaQuerySchema)) query: { confirm: boolean },
  ): Promise<void> {
    await this.media.remove(user.id, id, query.confirm);
  }
}

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorService } from '../../common/authz/actor.service';
import { testActor } from '../../../test/authz-cases';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

const ACTOR = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('media controller', () => {
  let app: INestApplication;
  let media: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    media = {
      authorizeUpload: vi.fn().mockResolvedValue({ assetId: ID, expiresAt: new Date(), upload: { url: 'u', fields: {} } }),
      completeUpload: vi.fn().mockResolvedValue({ assetId: ID, uploadStatus: 'READY', scanStatus: 'PENDING' }),
      getDeliveryUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://storage.test/x', expiresAt: new Date() }),
    };
    const mod = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        { provide: MediaService, useValue: media },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const body = { category: 'VERIFICATION_DOCUMENT', mimeType: 'application/pdf', bytes: 1024 };

  it('authorizes an upload for the resolved actor', async () => {
    const res = await http().post('/media/uploads').send(body);
    expect(res.status).toBe(201);
    expect(media['authorizeUpload']).toHaveBeenCalledWith(ACTOR, body, expect.any(Object));
  });

  it.each([
    ['an unknown category', { ...body, category: 'EVIDENCE' }],
    ['a zero size', { ...body, bytes: 0 }],
    ['a fractional size', { ...body, bytes: 10.5 }],
    ['an absurd size', { ...body, bytes: 5 * 1024 * 1024 * 1024 }],
    ['an over-long MIME type', { ...body, mimeType: 'x'.repeat(101) }],
    ['a client-chosen public id', { ...body, publicId: 'someone/else/file' }],
    ['a client-chosen owner', { ...body, ownerId: 'someone-else' }],
  ])('rejects %s before reaching the service', async (_label, payload) => {
    expect((await http().post('/media/uploads').send(payload)).status).toBe(400);
    expect(media['authorizeUpload']).not.toHaveBeenCalled();
  });

  it('completes by asset id, never by public id', async () => {
    const res = await http().post(`/media/uploads/${ID}/complete`).send();
    expect(res.status).toBe(200);
    expect(media['completeUpload']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
  });

  it('issues a delivery link that must not be cached', async () => {
    const res = await http().get(`/media/${ID}/delivery-url`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(media['getDeliveryUrl']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
  });

  it.each([
    ['post', '/media/uploads/not-a-uuid/complete'],
    ['get', '/media/not-a-uuid/delivery-url'],
  ] as const)('rejects a malformed id on %s %s', async (method, path) => {
    expect((await http()[method](path)).status).toBe(400);
  });
});

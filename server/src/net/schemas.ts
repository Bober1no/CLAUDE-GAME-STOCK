/**
 * Runtime validation for everything a client sends. TypeScript types mean nothing at
 * runtime — anyone can open devtools and emit garbage — so every payload goes through here.
 */
import { z } from 'zod';
import { CONFIG } from '@warmarket/shared';

const id = z.string().min(1).max(64);
const finiteNum = z.number().finite();
const sector = z.enum(['energy', 'tech', 'food', 'defence']);

const cleanText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim())
    .pipe(z.string().min(1).max(max));

export const nameSchema = cleanText(CONFIG.lobby.maxNameLength);

export const createSchema = z.object({ name: nameSchema }).strict();
export const joinSchema = z.object({ code: z.string().trim().toUpperCase().pipe(z.string().length(CONFIG.lobby.codeLength)), name: nameSchema }).strict();
export const rejoinSchema = z.object({ code: z.string().trim().toUpperCase().pipe(z.string().length(CONFIG.lobby.codeLength)), token: z.string().min(10).max(64) }).strict();
export const settingsSchema = z
  .object({
    sessionMinutes: z.number().int().refine((n) => CONFIG.lobby.sessionMinutesOptions.includes(n)),
    rolesEnabled: z.boolean(),
  })
  .partial()
  .strict();
export const companySchema = z
  .object({
    companyName: z
      .string()
      .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim())
      .pipe(z.string().min(2).max(CONFIG.lobby.maxCompanyNameLength).regex(/[A-Za-z]/, 'needs letters')),
    sector,
  })
  .partial()
  .strict();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('order'),
    assetId: id,
    side: z.enum(['buy', 'sell', 'short', 'cover']),
    orderType: z.enum(['market', 'limit']),
    qty: z.number().int().positive().max(10_000_000),
    limitPrice: finiteNum.positive().max(1e9).optional(),
    leverage: z.number().int().min(1).max(CONFIG.market.maxLeverage).optional(),
  }).strict(),
  z.object({ type: z.literal('cancelOrder'), orderId: id }).strict(),
  z.object({ type: z.literal('corporate'), action: z.enum(['rnd', 'marketing', 'dividend', 'fraud']), amount: finiteNum.positive().max(1e7).optional() }).strict(),
  z.object({ type: z.literal('story'), assetId: id, positive: z.boolean() }).strict(),
  z.object({ type: z.literal('lobby'), assetId: id, up: z.boolean() }).strict(),
  z.object({ type: z.literal('spy'), targetId: id }).strict(),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(CONFIG.chat.maxLength), toId: id.nullable() }).strict(),
  z.object({ type: z.literal('publish'), headline: z.string().min(5).max(120) }).strict(),
]);

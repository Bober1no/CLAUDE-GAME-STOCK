/**
 * Runtime validation for everything a client sends. TypeScript types mean nothing at
 * runtime — anyone can open devtools and emit garbage — so every payload goes through here.
 */
import { z } from 'zod';
import { CONFIG } from '@warmarket/shared';

const id = z.string().min(1).max(64);
const finiteNum = z.number().finite();
const resource = z.enum(['oil', 'food', 'metals', 'tech']);
const flow = z
  .object({ oil: finiteNum.min(0).max(1e5), food: finiteNum.min(0).max(1e5), metals: finiteNum.min(0).max(1e5), tech: finiteNum.min(0).max(1e5), cash: finiteNum.min(0).max(1e7) })
  .partial()
  .strict();

export const nameSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim())
  .pipe(z.string().min(1).max(CONFIG.lobby.maxNameLength));

export const createSchema = z.object({ name: nameSchema }).strict();
export const joinSchema = z.object({ code: z.string().trim().toUpperCase().pipe(z.string().length(CONFIG.lobby.codeLength)), name: nameSchema }).strict();
export const rejoinSchema = z.object({ code: z.string().trim().toUpperCase().pipe(z.string().length(CONFIG.lobby.codeLength)), token: z.string().min(10).max(64) }).strict();
export const settingsSchema = z
  .object({
    sessionMinutes: z.number().int().refine((n) => CONFIG.lobby.sessionMinutesOptions.includes(n)),
    mode: z.enum(['networth', 'domination', 'hegemony', 'lastStanding']),
    rolesEnabled: z.boolean(),
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
  z.object({ type: z.literal('build'), provinceId: z.number().int().min(0).max(1000), kind: z.enum(['farm', 'mine', 'well', 'lab', 'fort', 'port']) }).strict(),
  z.object({ type: z.literal('export'), resource, amount: finiteNum.positive().max(1e6) }).strict(),
  z.object({ type: z.literal('recruit'), provinceId: z.number().int().min(0).max(1000) }).strict(),
  z.object({ type: z.literal('move'), armyId: id, to: z.number().int().min(0).max(1000) }).strict(),
  z.object({ type: z.literal('declareWar'), targetId: id }).strict(),
  z.object({ type: z.literal('proposePeace'), targetId: id }).strict(),
  z.object({ type: z.literal('respondProposal'), proposalId: id, accept: z.boolean() }).strict(),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(CONFIG.diplomacy.chatMaxLength), toId: id.nullable() }).strict(),
  z.object({
    type: z.literal('proposeDeal'),
    targetId: id,
    terms: z.object({ give: flow, receive: flow, durationSec: z.number().int().min(30).max(CONFIG.diplomacy.maxDealDurationSec) }).strict(),
  }).strict(),
  z.object({ type: z.literal('respondDeal'), dealId: id, accept: z.boolean() }).strict(),
  z.object({ type: z.literal('breakDeal'), dealId: id }).strict(),
  z.object({ type: z.literal('proposeAlliance'), targetId: id }).strict(),
  z.object({ type: z.literal('breakAlliance'), targetId: id }).strict(),
  z.object({ type: z.literal('sanction'), targetId: id, on: z.boolean() }).strict(),
  z.object({ type: z.literal('trainSpy') }).strict(),
  z.object({ type: z.literal('spyMission'), spyId: id, targetId: id, mission: z.enum(['vision', 'orderflow', 'stealTech', 'fakeNews']), assetId: id.optional() }).strict(),
  z.object({ type: z.literal('publish'), headline: z.string().min(5).max(120) }).strict(),
]);

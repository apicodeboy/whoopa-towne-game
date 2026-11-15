import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Lobby state, synchronized to clients by Colyseus (delta-encoded).
 * Only slow-changing lobby data lives here: who is in the room, crews, ready flags, settings.
 * The fast in-match data (positions, shots...) travels as explicit snapshot messages instead,
 * because prediction and lag compensation need exact timestamps and input acks.
 */
export const LobbyPlayer = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    team: t.uint8().default(0),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    primary: t.string().default('ar'),
    throwable: t.string().default('grenade'),
    ping: t.uint16().default(0),
  },
  'LobbyPlayer',
);
export type LobbyPlayer = SchemaType<typeof LobbyPlayer>;

export const LobbyState = schema(
  {
    /** 'lobby' | 'playing' */
    phase: t.string().default('lobby'),
    mode: t.string().default('tdm'),
    /** 6-character invite code (also the room id). */
    code: t.string().default(''),
    isPrivate: t.boolean().default(false),
    hostId: t.string().default(''),
    fillBots: t.boolean().default(true),
    botDifficulty: t.string().default('normal'),
    players: t.map(LobbyPlayer),
  },
  'LobbyState',
);
export type LobbyState = SchemaType<typeof LobbyState>;

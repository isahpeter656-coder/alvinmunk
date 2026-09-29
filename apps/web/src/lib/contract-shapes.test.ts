// @vitest-environment node
import { readFileSync } from 'node:fs';
import * as sdk from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  decodeProfile,
  decodeVouch,
  PROFILE_FIELDS,
  VOUCH_FIELDS,
  type Profile,
  type Vouch,
} from '@alvinmunk/shared';

const { scValToNative, xdr } = sdk;

const libRs = readFileSync(
  new URL('../../../../contracts/reputation/src/lib.rs', import.meta.url),
  'utf8',
);

/**
 * Real `ScVal`s as a host function returns them, captured as base64 XDR — the exact form
 * an RPC response carries. Each one was built the way Soroban encodes a `#[contracttype]`
 * struct: `ScVal::Vec` of the fields in DECLARATION order, `Option<T>` as a one-element vec
 * and `BytesN<32>` as a vec of one `Bytes`.
 *
 * `VOUCH_CLAIMED`      `get_vouch(16)` — Option<Vouch>::Some, claimed, stake refunded
 * `VOUCH_UNCLAIMED`    `get_vouch(17)` — Option<Vouch>::Some, unclaimed + slashed
 * `VOUCH_ABSENT`       `get_vouch(999)` — Option<Vouch>::None
 * `PROFILE_VIEW`       `get_profile(GDIS5BDX…)` — Social 120, Earned 75, verified
 */
const VOUCH_CLAIMED =
  'AAAAEAAAAAEAAAABAAAAEAAAAAEAAAAJAAAABQAAAAAAAAAQAAAAEgAAAAAAAAAA0S6Ed5I0MaWzVHL0eY0PbiWxvM+e+L2cjBedvlDWJkgAAAAQAAAAAQAAAAEAAAANAAAAIAMKERgfJi00O0JJUFdeZWxzeoGIj5adpKuyucDHztXcAAAADgAAABdzb2xpZCB3b3JrIG9uIHRoZSBxdWVzdAAAAAAAAAAAAQAAABAAAAABAAAAAQAAABIAAAAAAAAAAL6veDpC9qtAWukrjYYI3Koo2Qlds7j1YQ2AvWb24IiyAAAABQAAAABo0p6AAAAABQAAAAAAAAAFAAAAAAAAAAA=';
const VOUCH_UNCLAIMED =
  'AAAAEAAAAAEAAAABAAAAEAAAAAEAAAAJAAAABQAAAAAAAAARAAAAEgAAAAAAAAAA0S6Ed5I0MaWzVHL0eY0PbiWxvM+e+L2cjBedvlDWJkgAAAAQAAAAAQAAAAEAAAANAAAAIAMKERgfJi00O0JJUFdeZWxzeoGIj5adpKuyucDHztXcAAAADgAAAAAAAAAAAAAAAAAAABAAAAABAAAAAQAAAAEAAAAFAAAAAGjSrJAAAAAFAAAAAAAAAAUAAAAAAAAAAQ==';
const VOUCH_ABSENT = 'AAAAEAAAAAEAAAABAAAAAQ==';
const PROFILE_VIEW = 'AAAAEAAAAAEAAAADAAAABQAAAAAAAAB4AAAABQAAAAAAAABLAAAAAAAAAAE=';

const FROM = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';
const CLAIMER = 'GC7K66B2IL3KWQC25EVY3BQI3SVCRWIJLWZ3R5LBBWAL2ZXW4CELFFGU';
/** sha256 of the claim secret, as the contract stores it — `(i * 7 + 3) & 0xff`. */
const CLAIM_HASH = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);

/** The fixture exactly as a client sees it: an RPC `ScVal` through `scValToNative`. */
const decodeFixture = (b64: string): unknown => scValToNative(xdr.ScVal.fromXDR(b64, 'base64'));

/** The field names of a `#[contracttype]` struct, in declaration order, straight from lib.rs. */
function rustFields(struct: string): string[] {
  const body = libRs.slice(
    libRs.indexOf(`pub struct ${struct} {`),
    libRs.indexOf('}', libRs.indexOf(`pub struct ${struct} {`)),
  );
  return [...body.matchAll(/pub\s+(\w+)\s*:/g)].map((m) => m[1]);
}

describe('the shared mirrors match contracts/reputation/src/lib.rs', () => {
  it('names every Vouch field, in the order the contract declares it', () => {
    expect([...VOUCH_FIELDS]).toEqual(rustFields('Vouch'));
  });

  it('names every Profile field, in the order the contract declares it', () => {
    expect([...PROFILE_FIELDS]).toEqual(rustFields('Profile'));
  });

  it('gives every Vouch field on the type — so the field list cannot fall behind it', () => {
    // Annotated as a Vouch, so TS itself rejects a missing or extra key here.
    const vouch: Vouch = {
      id: 16n,
      from: FROM,
      claim_hash: CLAIM_HASH,
      note: 'solid work on the quest',
      claimed: true,
      claimer: CLAIMER,
      created: 1_758_633_600n,
      stake: 5n,
      slashed: false,
    };
    expect(Object.keys(vouch)).toEqual([...VOUCH_FIELDS]);
  });

  it('gives every Profile field on the type — so the field list cannot fall behind it', () => {
    const profile: Profile = { social: 120n, earned: 75n, verified: true };
    expect(Object.keys(profile)).toEqual([...PROFILE_FIELDS]);
  });

  it('has no field the contract lost — Profile never carried a subject or attestations', () => {
    const profile = decodeProfile(decodeFixture(PROFILE_VIEW));
    expect(profile).toEqual({ social: 120n, earned: 75n, verified: true });
    expect(Object.keys(profile)).not.toContain('address');
    expect(Object.keys(profile)).not.toContain('attestations');
  });
});

describe('decodeVouch', () => {
  it('decodes a claimed half-card, field for field', () => {
    const vouch = decodeVouch(decodeFixture(VOUCH_CLAIMED));
    expect(vouch).not.toBeNull();
    expect(vouch).toEqual({
      id: 16n,
      from: FROM,
      claim_hash: CLAIM_HASH,
      note: 'solid work on the quest',
      claimed: true,
      claimer: CLAIMER,
      created: 1_758_633_600n,
      stake: 5n,
      slashed: false,
    } satisfies Vouch);
  });

  it('decodes an unclaimed, slashed half-card: a null claimer and an empty note', () => {
    const vouch = decodeVouch(decodeFixture(VOUCH_UNCLAIMED));
    expect(vouch).toEqual({
      id: 17n,
      from: FROM,
      claim_hash: CLAIM_HASH,
      note: '',
      claimed: false,
      claimer: null,
      created: 1_758_637_200n,
      stake: 5n,
      slashed: true,
    } satisfies Vouch);
  });

  it('reads None as null, not as an empty half-card', () => {
    expect(decodeVouch(decodeFixture(VOUCH_ABSENT))).toBeNull();
  });

  it('keeps a u64 as a bigint instead of silently narrowing it to a double', () => {
    const vouch = decodeVouch(decodeFixture(VOUCH_CLAIMED))!;
    for (const field of ['id', 'created', 'stake'] as const) {
      expect(typeof vouch[field], field).toBe('bigint');
    }
  });

  it('hands back the claim hash as a 32-byte Uint8Array', () => {
    const vouch = decodeVouch(decodeFixture(VOUCH_CLAIMED))!;
    expect(vouch.claim_hash).toBeInstanceOf(Uint8Array);
    expect(vouch.claim_hash).toHaveLength(32);
    expect(Array.from(vouch.claim_hash)).toEqual(Array.from(CLAIM_HASH));
  });

  it('refuses a struct with the wrong number of fields rather than reading off-by-one', () => {
    // A contract that appended a tenth field: same first nine, one more.
    const [option] = decodeFixture(VOUCH_CLAIMED) as [unknown[]];
    expect(() => decodeVouch([[...option, true]])).toThrow(
      /contract returned 10 fields, expected 9/,
    );
    expect(() => decodeVouch([option.slice(0, -1)])).toThrow(
      /contract returned 8 fields, expected 9/,
    );
  });

  it('refuses a value that is not a struct vec at all', () => {
    expect(() => decodeVouch({ id: 16n, from: FROM })).toThrow(/Soroban struct vec/);
    expect(() => decodeVouch(undefined)).toThrow(/Soroban struct vec/);
  });
});

describe('decodeProfile', () => {
  it('decodes the aggregate view, field for field', () => {
    const profile = decodeProfile(decodeFixture(PROFILE_VIEW));
    expect(profile).toEqual({ social: 120n, earned: 75n, verified: true } satisfies Profile);
    expect(typeof profile.social).toBe('bigint');
    expect(typeof profile.earned).toBe('bigint');
    expect(typeof profile.verified).toBe('boolean');
  });

  it('refuses a struct with the wrong number of fields', () => {
    expect(() => decodeProfile([120n, 75n, true, 3n])).toThrow(
      /contract returned 4 fields, expected 3/,
    );
  });
});

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import replayCases from "../../../../contract/cases/game-replay.json";
import fileCases from "../../../../contract/cases/session-files.json";
import schema from "../../../../contract/session-v1.schema.json";
import schemaV2 from "../../../../contract/session-v2.schema.json";
import { GameError, replay, summarize } from "./game/engine";
import {
  decodeSessionBytes,
  exportSession,
  parseSession,
  validateSession,
  type Session,
} from "./session";

const matchesV1 = new Ajv2020({ allErrors: true }).compile(schema);
const matchesV2 = new Ajv2020({ allErrors: true }).compile(schemaV2);
const matchesSchema = (session: Session) =>
  (session.sessionVersion === 1 ? matchesV1 : matchesV2)(session);
const schemaErrors = (session: Session) =>
  (session.sessionVersion === 1 ? matchesV1 : matchesV2).errors;

type ReplayCase = {
  name: string;
  session: Session;
  expect: Record<string, unknown> & { error?: { at: number }; absent?: string[] };
};
describe("contract: game-replay", () => {
  const list = replayCases.cases as unknown as ReplayCase[];
  it("has cases", () => expect(list.length).toBeGreaterThan(0));
  for (const item of list)
    it(item.name, () => {
      // Schema rejections belong in session-files.json.
      expect(matchesSchema(item.session), JSON.stringify(schemaErrors(item.session))).toBe(true);
      const session = structuredClone(item.session);
      if (item.expect.error) {
        let thrown: unknown;
        try {
          replay(session);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(GameError);
        expect((thrown as GameError).actionIndex, (thrown as Error).message).toBe(
          item.expect.error.at,
        );
        expect(() => validateSession(session)).toThrow();
        return;
      }
      const summary = summarize(replay(session));
      const { absent = [], ...members } = item.expect;
      // `absent` lists summary members that must not be present.
      for (const member of absent) {
        expect(members, `${member} is both compared and absent`).not.toHaveProperty(member);
        expect(Object.hasOwn(summary, member), `${member} must be absent`).toBe(false);
      }
      for (const [member, value] of Object.entries(members))
        expect(summary[member], member).toEqual(value);
      const exported = parseSession(exportSession(validateSession(session)));
      expect(exported.actions).toEqual(item.session.actions);
      expect(exported.sessionVersion).toBe(item.session.sessionVersion);
    });
});

type FileCase = {
  name: string;
  valid: boolean;
  session?: unknown;
  json?: string;
  base64?: string;
  padToBytes?: number;
};
describe("contract: session-files", () => {
  const list = fileCases.cases as FileCase[];
  it("has cases", () => expect(list.length).toBeGreaterThan(0));
  for (const item of list)
    it(item.name, () => {
      const forms = [item.session, item.json, item.base64].filter(
        (form) => form !== undefined,
      );
      expect(forms, "exactly one of session, json, base64").toHaveLength(1);
      const run = () => {
        if (item.json !== undefined) {
          let json = item.json;
          if (item.padToBytes !== undefined)
            json += " ".repeat(item.padToBytes - new TextEncoder().encode(json).byteLength);
          return parseSession(json);
        }
        if (item.base64 !== undefined)
          return decodeSessionBytes(new Uint8Array(Buffer.from(item.base64, "base64")));
        return validateSession(structuredClone(item.session));
      };
      if (!item.valid) return expect(run).toThrow();
      const session = run();
      const exported = parseSession(exportSession(session));
      expect(exported.actions).toEqual(session.actions);
      expect(exported.sessionVersion).toBe(session.sessionVersion);
    });
});

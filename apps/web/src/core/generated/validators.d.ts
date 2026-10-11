import type { ValidateFunction } from "ajv";
import type { Deck } from "../deck";
import type { Session } from "../session";
import type { Candidate } from "../playlist";

export const deckV1: ValidateFunction<Deck>;
export const deckV2: ValidateFunction<Deck>;
export const sessionV1: ValidateFunction<Session>;
export const sessionV2: ValidateFunction<Session>;
export const candidateV1: ValidateFunction<Candidate>;

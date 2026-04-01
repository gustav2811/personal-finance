import { registerParser, getParser } from "./registry.js";
import { bankZeroParser } from "./bank-zero.js";

registerParser("bank_zero", bankZeroParser);

export { getParser, getRegisteredBanks } from "./registry.js";
export type { CanonicalTransaction, ParserContext, BankParser } from "./types.js";
export { bankZeroParser } from "./bank-zero.js";
export {
  detectBank,
  pickBestAttachment,
  getParserForBank,
  parseDomainFromFromHeader,
} from "./detection.js";

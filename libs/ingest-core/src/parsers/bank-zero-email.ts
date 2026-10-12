/** Deterministic parser for Bank Zero notification email templates. */

export type BankZeroMessageClass =
  | "money_received"
  | "paid"
  | "card_purchase"
  | "card_refund"
  | "payment_returned"
  | "fee"
  | "proof_of_payment"
  | "statement"
  | "banking_status"
  | "non_transaction"
  | "unknown";

export type BankZeroFinancialObservation = {
  parserVersion: "bank-zero-email-v1";
  messageClass: BankZeroMessageClass;
  outcome: "movement_candidate" | "evidence" | "balance_snapshot" | "no_movement" | "review";
  direction?: "credit" | "debit";
  amountMinor?: number;
  attemptedAmountMinor?: number;
  currency: "ZAR";
  paymentMethod?: "ordinary_payment" | "immediate_payment" | "card" | "fee";
  counterparty?: string;
  reference?: string;
  accountAlias?: string;
  eventAt?: string;
  postedOn?: string;
  balanceMinor?: number;
  sourceFields: Record<string, "subject" | "body" | "attachment">;
  conflict?: string;
  reason?: string;
};

export type BankZeroEmailInput = {
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; mimetype: string }>;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function decodeHtml(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>|<\/tr\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(input: BankZeroEmailInput): string {
  const body = [input.text ?? "", input.html ? decodeHtml(input.html) : ""]
    .filter(Boolean)
    .join(" ");
  return body.replace(/\s+/g, " ").trim();
}

function amountMinor(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^(?:ZAR|R)\s*/i, "").replace(/[\s,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return undefined;
  const [whole, fraction = ""] = cleaned.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : undefined;
}

const MONEY = String.raw`(?:ZAR\s*|R\s*)?\d[\d\s,]*(?:\.\d{1,2})?`;

function readDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /\b(\d{1,2})\s+([A-Za-z]{3})-(\d{2,4})\s+(?:[A-Za-z]{3}\s+)?(\d{1,2})h(\d{2})\b/i.exec(value);
  if (!match) return undefined;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return undefined;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const day = match[1].padStart(2, "0");
  const hour = match[4].padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${match[5]}:00+02:00`;
}

type ParsedText = Omit<BankZeroFinancialObservation, "parserVersion" | "sourceFields"> & {
  sourceFields: Record<string, "subject" | "body" | "attachment">;
};

function capture(text: string, regex: RegExp): string | undefined {
  return regex.exec(text)?.[1]?.trim();
}

function transactionFromText(text: string): ParsedText | undefined {
  const accountAlias = capture(text, /\(([^()]*(?:transactional|savings|notice|gifts)[^()]*)\)\s*\.?\s*$/i);
  const eventText = capture(text, /\bon\s+(\d{1,2}\s+[A-Za-z]{3}-\d{2,4}\s+(?:[A-Za-z]{3}\s+)?\d{1,2}h\d{2})\b/i);
  const balanceText = capture(text, new RegExp(String.raw`\bbalance\s+(${MONEY})`, "i"));
  const eventAt = readDate(eventText);
  const balanceMinor = amountMinor(balanceText);
  const sourceFields: ParsedText["sourceFields"] = {};
  if (accountAlias) sourceFields.accountAlias = "body";
  if (eventAt) sourceFields.eventAt = "body";
  if (balanceMinor !== undefined) sourceFields.balanceMinor = "body";

  const received = new RegExp(String.raw`\bMoney\s+Immediately\s+Received|\bMoney\s+Received\s+(${MONEY})\s+from\s+(.+?)(?:\s+with\s+reference\s+['’](.*?)['’])?(?:\s+on\s+|,?\s+balance\s+|\s+\([^()]+\))`, "i");
  const receivedMatch = received.exec(text);
  if (receivedMatch) {
    const immediate = /\bMoney\s+Immediately\s+Received\b/i.test(text);
    const amountMatch = new RegExp(String.raw`\bMoney\s+(?:Immediately\s+)?Received\s+(${MONEY})`, "i").exec(text);
    const counterparty = new RegExp(String.raw`\bfrom\s+(.+?)(?:\s+with\s+reference\b|\s+on\s+\d|,?\s+balance\b|\s+\([^()]+\))`, "i").exec(text)?.[1]?.trim();
    const reference = capture(text, /\bwith\s+reference\s+['’](.*?)['’]/i);
    const amount = amountMinor(amountMatch?.[1]);
    if (amount === undefined) return { messageClass: "unknown", outcome: "review", currency: "ZAR", sourceFields, reason: "Could not parse received amount" };
    sourceFields.amountMinor = "body";
    if (counterparty) sourceFields.counterparty = "body";
    if (reference) sourceFields.reference = "body";
    return {
      messageClass: "money_received", outcome: "movement_candidate", direction: "credit",
      amountMinor: amount, paymentMethod: immediate ? "immediate_payment" : undefined,
      counterparty, reference, accountAlias, eventAt, balanceMinor, currency: "ZAR", sourceFields,
    };
  }

  const paid = new RegExp(String.raw`\b(Pay\s+Immediately|Paid)\s+(${MONEY})\s+to\s+(.+?)(?:\s+with\s+reference\s+['’](.*?)['’])?(?:\s+on\s+|,?\s+balance\s+|\s+\([^()]+\))`, "i").exec(text);
  if (paid) {
    const amount = amountMinor(paid[2]);
    if (amount === undefined) return { messageClass: "unknown", outcome: "review", currency: "ZAR", sourceFields, reason: "Could not parse payment amount" };
    const counterparty = paid[3].trim();
    const reference = paid[4]?.trim();
    sourceFields.amountMinor = "body";
    sourceFields.counterparty = "body";
    if (reference) sourceFields.reference = "body";
    return {
      messageClass: "paid", outcome: "movement_candidate", direction: "debit", amountMinor: amount,
      paymentMethod: paid[1].toLowerCase().startsWith("pay") ? "immediate_payment" : "ordinary_payment",
      counterparty, reference, accountAlias, eventAt, balanceMinor, currency: "ZAR", sourceFields,
    };
  }

  const returned = new RegExp(String.raw`\b(?:Pay\s+Immediately\s+)?Returned\s+(${MONEY})\s+from\s+(.+?)(?:\s+with\s+reference\s+['’](.*?)['’])?(?:\s+on\s+|,?\s+balance\s+|\s+\([^()]+\))`, "i").exec(text);
  if (returned) {
    const amount = amountMinor(returned[1]);
    if (amount === undefined) return { messageClass: "unknown", outcome: "review", currency: "ZAR", sourceFields, reason: "Could not parse returned amount" };
    const reference = returned[3]?.trim();
    sourceFields.amountMinor = "body";
    sourceFields.counterparty = "body";
    if (reference) sourceFields.reference = "body";
    return {
      messageClass: "payment_returned", outcome: "movement_candidate", direction: "credit", amountMinor: amount,
      paymentMethod: /Immediately/i.test(text) ? "immediate_payment" : undefined,
      counterparty: returned[2].trim(), reference, accountAlias, eventAt, balanceMinor,
      currency: "ZAR", sourceFields,
    };
  }

  const refund = new RegExp(String.raw`\bCard\s+Refund\s+(${MONEY})\s+at\s+(.+?)(?:\s*,\s*[^,]+)?\s+on\s+(\d{1,2}\s+[A-Za-z]{3}-\d{2,4}\s+(?:[A-Za-z]{3}\s+)?\d{1,2}h\d{2})`, "i").exec(text);
  if (refund) {
    const amount = amountMinor(refund[1]);
    if (amount === undefined) return { messageClass: "unknown", outcome: "review", currency: "ZAR", sourceFields, reason: "Could not parse card refund amount" };
    const refundAt = readDate(refund[3]);
    sourceFields.amountMinor = "body";
    sourceFields.counterparty = "body";
    if (refundAt) sourceFields.eventAt = "body";
    return { messageClass: "card_refund", outcome: "movement_candidate", direction: "credit", amountMinor: amount, paymentMethod: "card", counterparty: refund[2].trim(), accountAlias, eventAt: refundAt ?? eventAt, balanceMinor, currency: "ZAR", sourceFields };
  }

  const fee = new RegExp(String.raw`\b(?:Card\s+)?Fee:\s*[^:]+?\s+(${MONEY})\s+for\s+(${MONEY})(?:\s+@\s+(.+?))?(?:\s+on\s+(\d{1,2}\s+[A-Za-z]{3}-\d{2,4}\s+(?:[A-Za-z]{3}\s+)?\d{1,2}h\d{2}))?(?:,?\s+balance\b|\s+\([^()]+\))`, "i").exec(text);
  if (fee) {
    const feeAmount = amountMinor(fee[1]);
    const attemptedAmount = amountMinor(fee[2]);
    if (feeAmount === undefined || attemptedAmount === undefined) return { messageClass: "unknown", outcome: "review", currency: "ZAR", sourceFields, reason: "Could not parse fee amounts" };
    sourceFields.amountMinor = "body";
    sourceFields.attemptedAmountMinor = "body";
    if (fee[3]) sourceFields.counterparty = "body";
    return {
      messageClass: "fee", outcome: feeAmount === 0 ? "no_movement" : "movement_candidate",
      ...(feeAmount > 0 ? { direction: "debit" as const, amountMinor: feeAmount } : {}),
      attemptedAmountMinor: attemptedAmount, paymentMethod: "fee", counterparty: fee[3]?.trim(),
      accountAlias, eventAt: readDate(fee[4]) ?? eventAt, balanceMinor, currency: "ZAR", sourceFields,
      ...(feeAmount === 0 ? { reason: "Zero fee" } : {}),
    };
  }

  const card = new RegExp(String.raw`\bCard\s+(?:Purchase|Online\s+Purchase|Apple\s+Pay|Subscription)\s+(${MONEY})\s+at\s+(.+?)(?:\s*,\s*[^,]+)?\s+on\s+(\d{1,2}\s+[A-Za-z]{3}-\d{2,4}\s+(?:[A-Za-z]{3}\s+)?\d{1,2}h\d{2})`, "i").exec(text);
  if (card) {
    const amount = amountMinor(card[1]);
    if (amount === undefined) return { messageClass: "unknown", outcome: "review", currency: "ZAR", sourceFields, reason: "Could not parse card purchase amount" };
    sourceFields.amountMinor = "body";
    sourceFields.counterparty = "body";
    return { messageClass: "card_purchase", outcome: "movement_candidate", direction: "debit", amountMinor: amount, paymentMethod: "card", counterparty: card[2].trim(), accountAlias, eventAt: readDate(card[3]), balanceMinor, currency: "ZAR", sourceFields };
  }

  return undefined;
}

function materiallyDifferent(a: ParsedText, b: ParsedText): string | undefined {
  for (const key of ["messageClass", "direction", "amountMinor", "counterparty", "reference", "accountAlias", "eventAt"] as const) {
    const av = a[key];
    const bv = b[key];
    if (av !== undefined && bv !== undefined && String(av).toLowerCase() !== String(bv).toLowerCase()) {
      return `${key} differs between subject and body`;
    }
  }
  return undefined;
}

function classifyNonMovement(text: string, attachments: BankZeroEmailInput["attachments"]): ParsedText | undefined {
  const filenames = (attachments ?? []).map((a) => a.filename.toLowerCase());
  if (/\bbank\s+statement\b/i.test(text) || filenames.some((name) => /\.(xlsx?|csv)$/.test(name))) {
    return { messageClass: "statement", outcome: "evidence", currency: "ZAR", sourceFields: {}, reason: "Statement evidence requires row parsing" };
  }
  if (/\bbanking\s+status\s+as\s+at\b/i.test(text)) {
    const accountAlias = capture(text, /\(([^()]*(?:transactional|savings|notice|gifts)[^()]*)\)\s*\.?\s*$/i);
    const balanceText = capture(text, new RegExp(String.raw`\b(?:available\s+)?balance\s+(?:is\s+)?(${MONEY})`, "i"));
    const balanceMinor = amountMinor(balanceText);
    const eventText = capture(text, /\bas\s+at\s+(\d{1,2}\s+[A-Za-z]{3}-\d{2,4}\s+(?:[A-Za-z]{3}\s+)?\d{1,2}h\d{2})\b/i);
    const eventAt = readDate(eventText);
    if (!accountAlias || balanceMinor === undefined || !eventAt) {
      return {
        messageClass: "banking_status", outcome: "review", currency: "ZAR",
        sourceFields: {}, reason: "Balance snapshot needs a clear account alias, exact balance, and observation time",
      };
    }
    return {
      messageClass: "banking_status", outcome: "balance_snapshot", currency: "ZAR",
      accountAlias, balanceMinor, eventAt,
      sourceFields: { accountAlias: "body", balanceMinor: "body", eventAt: "body" },
      reason: "Balance snapshot; does not create a transaction",
    };
  }
  if (/\bpayment\s+of\s+(?:R|ZAR)\s*[\d\s,.]+\s+from\b/i.test(text) && filenames.some((name) => /proof|payment/i.test(name))) {
    const amountText = capture(text, new RegExp(String.raw`\bpayment\s+of\s+(${MONEY})`, "i"));
    const amount = amountMinor(amountText);
    const counterparty = capture(text, /\bto\s+(.+?)(?:\s+with\s+reference\b|\s+on\s+\d|\s+\([^()]+\)|$)/i);
    const reference = capture(text, /\bwith\s+reference\s+['’](.*?)['’]/i);
    const accountAlias = capture(text, /\(([^()]*(?:transactional|savings|notice|gifts)[^()]*)\)\s*\.?\s*$/i);
    const eventText = capture(text, /\bon\s+(\d{1,2}\s+[A-Za-z]{3}-\d{2,4}\s+(?:[A-Za-z]{3}\s+)?\d{1,2}h\d{2})\b/i);
    const eventAt = readDate(eventText);
    if (amount === undefined || !counterparty) {
      return { messageClass: "proof_of_payment", outcome: "review", currency: "ZAR", sourceFields: {}, reason: "Proof details are incomplete for automatic matching" };
    }
    return {
      messageClass: "proof_of_payment", outcome: "evidence", direction: "debit",
      amountMinor: amount, counterparty: counterparty.trim(), reference, accountAlias,
      eventAt, currency: "ZAR",
      sourceFields: {
        amountMinor: "subject", direction: "subject", counterparty: "subject",
        ...(reference ? { reference: "subject" as const } : {}),
        ...(accountAlias ? { accountAlias: "subject" as const } : {}),
        ...(eventAt ? { eventAt: "subject" as const } : {}),
      },
      reason: "Proof enriches a uniquely matched movement",
    };
  }
  if (/\b(?:timeout|declined|decline|incomplete|tried\b|authorization|authorisation|subscription\s+is\s+disabled)\b/i.test(text)) {
    return { messageClass: "non_transaction", outcome: "no_movement", currency: "ZAR", sourceFields: {}, reason: "Unsuccessful or incomplete attempt" };
  }
  if (/\b(?:beneficiar(?:y|ies)|recipient\s+.+\s+added|account\s+confirmation|security|settings|tax|marketing|password|profile)\b/i.test(text)) {
    return { messageClass: "non_transaction", outcome: "no_movement", currency: "ZAR", sourceFields: {}, reason: "Account or informational notice" };
  }
  return undefined;
}

function parseOne(text: string, attachments: BankZeroEmailInput["attachments"]): ParsedText {
  const parsed = transactionFromText(text);
  const isProofAttachment = (attachments ?? []).some((item) => /proof|payment/i.test(item.filename));
  if (parsed) {
    return isProofAttachment && parsed.outcome === "movement_candidate"
      ? { ...parsed, messageClass: "proof_of_payment", outcome: "evidence" }
      : parsed;
  }
  const noMovement = classifyNonMovement(text, attachments);
  if (noMovement) return noMovement;
  return { messageClass: "unknown", outcome: "review", currency: "ZAR", sourceFields: {}, reason: "Unknown Bank Zero message template" };
}

export function parseBankZeroEmail(input: BankZeroEmailInput): BankZeroFinancialObservation {
  const subject = input.subject.trim();
  const body = cleanText(input);
  const subjectParsed = parseOne(subject, input.attachments);
  const bodyParsed = body ? parseOne(body, input.attachments) : undefined;

  if (bodyParsed && subjectParsed.outcome === "movement_candidate" && bodyParsed.outcome === "movement_candidate") {
    const conflict = materiallyDifferent(subjectParsed, bodyParsed);
    if (conflict) {
      return {
        parserVersion: "bank-zero-email-v1", messageClass: "unknown", outcome: "review", currency: "ZAR",
        sourceFields: {}, conflict, reason: "Subject and body contain conflicting movement details",
      };
    }
  }

  const selected = bodyParsed && bodyParsed.outcome === "movement_candidate" ? bodyParsed : subjectParsed;
  const source = selected === subjectParsed ? "subject" : "body";
  const sourceFields = { ...selected.sourceFields };
  for (const key of ["amountMinor", "counterparty", "reference", "accountAlias", "eventAt", "balanceMinor", "attemptedAmountMinor"] as const) {
    if (selected[key] !== undefined) sourceFields[key] = source;
  }
  if (selected.messageClass === "unknown") {
    return { ...selected, parserVersion: "bank-zero-email-v1", sourceFields };
  }
  return { ...selected, parserVersion: "bank-zero-email-v1", sourceFields };
}

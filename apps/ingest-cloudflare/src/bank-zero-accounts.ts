import type { BankZeroAccountMapping } from "@investments/ingest-core";

// First matching row wins. "Wedding Gifts Savings" stays above "Gifts", and
// "Euro Trip" stays above "32-day notice", so a broader pattern cannot take
// those statements.
export const bankZeroAccountMap: BankZeroAccountMapping[] = [
  {
    pattern: "Emergency Savings",
    accountId: "b2af8a9f-6d02-4878-abdc-b6064edbc22e",
  },
  {
    pattern: "Wedding Gifts Savings",
    accountId: "0df59676-4a8a-4975-a263-af69687de2e8",
  },
  {
    pattern: "Gifts",
    accountId: "43dc381f-4322-4702-b7df-2a9a67e97211",
  },
  {
    pattern: "Travel Savings",
    accountId: "e42ac63e-6246-45a7-8cea-bf7e57a14b64",
  },
  {
    pattern: "Loft space",
    accountId: "c5b35700-298e-4a9f-bbc2-95314a59b827",
  },
  {
    pattern: "Transaction",
    accountNumber: "80204387707",
    accountId: "1660ce38-4b44-4812-8123-26f3514dbc49",
  },
  {
    pattern: "Transaction",
    accountNumber: "80204621122",
    accountId: "258f9b35-a32a-4a6f-97cd-fba0d08d1aca",
  },
  {
    pattern: "Short-term Savings",
    accountId: "2e606b26-df00-4298-b3f5-8b6feffcc16d",
  },
  {
    pattern: "Coffee Machine Savings",
    accountId: "68e0a2b8-2708-4600-bd04-218b295e27ea",
  },
  {
    pattern: "Euro Trip",
    accountId: "80d18c07-c69a-4354-bbb1-0773aef4b83a",
  },
  {
    pattern: "32-day notice",
    accountId: "a2aaf332-69d5-4c06-a91d-bfde03a5dd1a",
  },
  {
    pattern: "Gods Money",
    accountId: "17619d86-3062-4f0a-a097-636b15f89f19",
  },
  {
    pattern: "Personal Care",
    accountId: "12eadee4-2b92-4642-9ae2-10fd3fd0a39d",
  },
];

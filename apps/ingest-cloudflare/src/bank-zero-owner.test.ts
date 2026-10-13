import { describe, expect, it } from "vitest";
import { resolveBankZeroOwner } from "./bank-zero-owner.js";

const enabled = "gustav";

describe("Bank Zero shared receiver ownership", () => {
  it("resolves a manual forward from Gustav", () => {
    expect(resolveBankZeroOwner({
      rawEmail: "From: Gustav <gustav@klingbiel.org>\r\nTo: bankzero@automations.klingbiel.org\r\n\r\nPaid R10",
      enabledProfiles: enabled,
    })).toMatchObject({ observedProfile: "gustav", basis: "from", status: "resolved", routeKey: "gustav" });
  });

  it("resolves Cara from a manual forward but leaves her disabled", () => {
    expect(resolveBankZeroOwner({
      rawEmail: "From: Cara <cara@klingbiel.org>\r\nTo: bankzero@automations.klingbiel.org\r\n\r\nPaid R10",
      enabledProfiles: enabled,
    })).toMatchObject({ observedProfile: "cara", basis: "from", status: "disabled" });
  });

  it("uses delivered headers when the bank sender is retained by automatic forwarding", () => {
    expect(resolveBankZeroOwner({
      rawEmail: "From: e-services@bankzerosa.co.za\r\nTo: bankzero@automations.klingbiel.org\r\n\r\nPaid R10",
      transportHeaders: "Delivered-To: gustav+bankzero@klingbiel.org\r\n",
      enabledProfiles: enabled,
    })).toMatchObject({ observedProfile: "gustav", basis: "delivered-to", routeKey: "gustav" });
  });

  it("recognizes Gmail's whitespace-separated X-Forwarded-For mailbox list", () => {
    expect(resolveBankZeroOwner({
      rawEmail: "From: e-services@bankzerosa.co.za\r\nTo: external@example.net\r\n\r\nPaid R10",
      transportHeaders: [
        "X-Forwarded-For: gustav+bankzero@klingbiel.org bankzero@automations.klingbiel.org",
        "Delivered-To: bankzero@automations.klingbiel.org",
        "X-Original-To: external@example.net",
      ].join("\r\n"),
      enabledProfiles: enabled,
    })).toMatchObject({ observedProfile: "gustav", basis: "forwarded", routeKey: "gustav" });
  });

  it("uses the original recipient when delivery headers are absent", () => {
    expect(resolveBankZeroOwner({
      rawEmail: "From: e-services@bankzerosa.co.za\r\nTo: gustav@klingbiel.org\r\n\r\nPaid R10",
      enabledProfiles: enabled,
    })).toMatchObject({ observedProfile: "gustav", basis: "recipient", routeKey: "gustav" });
  });

  it("holds conflicting explicit token and observed owner", () => {
    expect(resolveBankZeroOwner({
      routeKey: "gustav",
      rawEmail: "From: Cara <cara@klingbiel.org>\r\nTo: bankzero@automations.klingbiel.org\r\n\r\nPaid R10",
      enabledProfiles: enabled,
    })).toMatchObject({ observedProfile: "cara", basis: "from", status: "conflict" });
  });

  it("holds messages addressed to both profiles", () => {
    expect(resolveBankZeroOwner({
      rawEmail: "From: e-services@bankzerosa.co.za\r\nTo: gustav@klingbiel.org, cara@klingbiel.org\r\n\r\nPaid R10",
      enabledProfiles: enabled,
    })).toMatchObject({ status: "ambiguous" });
  });

  it("does not inspect quoted body text or display names", () => {
    expect(resolveBankZeroOwner({
      rawEmail: "From: Bank Zero <e-services@bankzerosa.co.za>\r\nTo: bankzero@automations.klingbiel.org\r\n\r\nFrom: Cara <cara@klingbiel.org>\r\nPaid R10",
      enabledProfiles: enabled,
    })).toMatchObject({ status: "unverified" });
    expect(resolveBankZeroOwner({
      rawEmail: 'From: "cara@klingbiel.org" <e-services@bankzerosa.co.za>\r\nTo: bankzero@automations.klingbiel.org\r\n\r\nPaid R10',
      enabledProfiles: enabled,
    })).toMatchObject({ status: "unverified" });
  });

  it("honours folded recipient headers and plus aliases", () => {
    expect(resolveBankZeroOwner({
      rawEmail: "From: e-services@bankzerosa.co.za\r\nTo: Gustav <gustav+bankzero@klingbiel.org>,\r\n Cara Finance <cara.finance@klingbiel.org>\r\n\r\nPaid R10",
      enabledProfiles: enabled,
    })).toMatchObject({ status: "ambiguous" });
  });
});

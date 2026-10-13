export type BankZeroOwnerProfile = "gustav" | "cara";

export type BankZeroOwnerResolution = {
  observedProfile?: BankZeroOwnerProfile;
  basis?: "from" | "forwarded" | "delivered-to" | "original-to" | "recipient";
  status: "resolved" | "disabled" | "ambiguous" | "conflict" | "unverified";
  routeKey?: BankZeroOwnerProfile;
};

const PROFILE_ALIASES: Record<BankZeroOwnerProfile, readonly string[]> = {
  gustav: ["gustav@klingbiel.org", "gustav+bankzero@klingbiel.org"],
  cara: ["cara@klingbiel.org", "cara.finance@klingbiel.org"],
};

const KNOWN_PROFILES = Object.entries(PROFILE_ALIASES) as Array<[
  BankZeroOwnerProfile,
  readonly string[],
]>;

type HeaderName =
  | "from"
  | "x-forwarded-for"
  | "delivered-to"
  | "x-original-to"
  | "to"
  | "cc"
  | "bcc";

function unfoldHeaders(raw: string): Map<HeaderName, string[]> {
  const head = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const lines = head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  const result = new Map<HeaderName, string[]>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase() as HeaderName;
    if (!["from", "x-forwarded-for", "delivered-to", "x-original-to", "to", "cc", "bcc"].includes(name)) continue;
    const value = line.slice(separator + 1).trim();
    const values = result.get(name) ?? [];
    values.push(value);
    result.set(name, values);
  }
  return result;
}

function aliasesIn(value: string, allowWhitespaceList = false): Set<BankZeroOwnerProfile> {
  const normalized = value.toLowerCase();
  const bareValues = normalized.replace(/<[^>]*>/g, "").split(allowWhitespaceList ? /[,\s]+/ : ",").map((part) => part.trim());
  const mailboxes = [
    ...Array.from(normalized.matchAll(/<([^>]+)>/g), (match) => match[1].trim()),
    ...bareValues,
  ];
  const found = new Set<BankZeroOwnerProfile>();
  for (const [profile, aliases] of KNOWN_PROFILES) {
    for (const alias of aliases) {
      // Only accept the complete mailbox portion. This deliberately ignores
      // display names such as "cara@klingbiel.org (finance)".
      if (mailboxes.some((mailbox) => mailbox === alias)) {
        found.add(profile);
      }
    }
  }
  return found;
}

function profilesFor(headers: Map<HeaderName, string[]>, names: HeaderName[]): Set<BankZeroOwnerProfile> {
  const found = new Set<BankZeroOwnerProfile>();
  for (const name of names) {
    for (const value of headers.get(name) ?? []) {
      for (const profile of aliasesIn(value, name === "x-forwarded-for")) found.add(profile);
    }
  }
  return found;
}

function enabledProfiles(raw: string | undefined): Set<BankZeroOwnerProfile> {
  const enabled = new Set<BankZeroOwnerProfile>();
  for (const value of (raw ?? "").split(",")) {
    const profile = value.trim();
    if (profile === "gustav" || profile === "cara") {
      enabled.add(profile);
    }
  }
  return enabled;
}

export function resolveBankZeroOwner(options: {
  rawEmail?: string;
  transportHeaders?: string;
  routeKey?: string;
  enabledProfiles?: string;
}): BankZeroOwnerResolution {
  // The stored MIME is the source of truth. Transport headers supplement it
  // when a forwarding hop carries owner evidence outside the original MIME.
  const rawHeaders = unfoldHeaders(options.rawEmail || "");
  const transportHeaders = unfoldHeaders(options.transportHeaders || "");
  let profiles = profilesFor(rawHeaders, ["from"]);
  if (!profiles.size) profiles = profilesFor(transportHeaders, ["from"]);
  let basis: BankZeroOwnerResolution["basis"] = profiles.size ? "from" : undefined;
  if (!profiles.size) {
    profiles = profilesFor(rawHeaders, ["x-forwarded-for"]);
    if (!profiles.size) profiles = profilesFor(transportHeaders, ["x-forwarded-for"]);
    basis = profiles.size ? "forwarded" : undefined;
  }
  if (!profiles.size) {
    profiles = profilesFor(rawHeaders, ["delivered-to"]);
    if (!profiles.size) profiles = profilesFor(transportHeaders, ["delivered-to"]);
    basis = profiles.size ? "delivered-to" : undefined;
  }
  if (!profiles.size) {
    profiles = profilesFor(rawHeaders, ["x-original-to"]);
    if (!profiles.size) profiles = profilesFor(transportHeaders, ["x-original-to"]);
    basis = profiles.size ? "original-to" : undefined;
  }
  if (!profiles.size) {
    profiles = profilesFor(rawHeaders, ["to", "cc", "bcc"]);
    if (!profiles.size) profiles = profilesFor(transportHeaders, ["to", "cc", "bcc"]);
    basis = profiles.size ? "recipient" : undefined;
  }

  const tokenProfile = options.routeKey === "gustav" || options.routeKey === "cara"
    ? options.routeKey
    : undefined;
  const observedProfile = profiles.size === 1 ? [...profiles][0] : undefined;
  const enabled = enabledProfiles(options.enabledProfiles);

  if (profiles.size > 1 || (tokenProfile && observedProfile && tokenProfile !== observedProfile)) {
    return { ...(observedProfile ? { observedProfile } : {}), ...(basis ? { basis } : {}), status: profiles.size > 1 ? "ambiguous" : "conflict" };
  }
  if (observedProfile) {
    return {
      observedProfile,
      ...(basis ? { basis } : {}),
      status: enabled.has(observedProfile) ? "resolved" : "disabled",
      ...(enabled.has(observedProfile) ? { routeKey: observedProfile } : {}),
    };
  }
  // Keep the pre-owner-routing behavior for explicitly configured route
  // tokens when the optional owner profile variable is absent.
  if (tokenProfile && (options.enabledProfiles === undefined || enabled.has(tokenProfile))) {
    return { status: "resolved", routeKey: tokenProfile };
  }
  return { status: "unverified" };
}

export const EASY_EQUITIES_TFSA_ID = "5ef9fec22bf5880ae4853706" as const;
export const EASY_EQUITIES_RSA_ID = "5ef9fec22bf5880ae4853705" as const;
export const SYGNIA_ALCHEMY_RA_ID = "65c517986f0734bcdef80857" as const;

// Banking accounts

export const DISCOVERY_TRANSACTIONAL_ACCOUNT_ID = "641836c1506a2843d6bc32d3";
export const DISCOVERY_CREDIT_ACCOUNT_ID = "65b53d9db63eb3b84a121f62";

export const ACCOUNT_IDS = [
  { key: "easy_equities_tfsa", id: EASY_EQUITIES_TFSA_ID },
  { key: "easy_equities_rsa", id: EASY_EQUITIES_RSA_ID },
  { key: "sygnia_alchemy_ra", id: SYGNIA_ALCHEMY_RA_ID },
] as const;

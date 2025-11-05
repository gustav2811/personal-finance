import "dotenv/config";

export type AppConfig = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  twentyTwoSevenUsername: string;
  twentyTwoSevenPassword: string;
};

export function getConfig(): AppConfig {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY ?? "";
  const twentyTwoSevenUsername = process.env.MY_22SEVEN_USERNAME ?? "";
  const twentyTwoSevenPassword = process.env.MY_22SEVEN_PASSWORD ?? "";

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceKey) missing.push("SUPABASE_SERVICE_KEY");
  if (!twentyTwoSevenUsername) missing.push("MY_22SEVEN_USERNAME");
  if (!twentyTwoSevenPassword) missing.push("MY_22SEVEN_PASSWORD");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return {
    supabaseUrl,
    supabaseServiceKey,
    twentyTwoSevenUsername,
    twentyTwoSevenPassword,
  };
}

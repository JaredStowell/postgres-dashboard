interface HyperdriveBinding {
  connectionString: string;
}

interface CloudflareBindings {
  CONTROL_DB: HyperdriveBinding;
  TARGET_LOCAL: HyperdriveBinding;
  INDEX_ANALYZER_TARGETS: string;
  OPENAI_API_KEY?: string;
  OPENAI_BALANCED_MODEL?: string;
  OPENAI_DEEP_MODEL?: string;
  AI_MOCK_MODE?: string;
  EXPLAIN_CONFIRMATION_SECRET?: string;
  [key: string]: unknown;
}

declare module "cloudflare:workers" {
  export const env: CloudflareBindings;
}

/**
 * Redaction Utility
 * 
 * Helper functions to redact sensitive information from logs and data.
 * Never log Authorization headers, Stripe keys (sk_*, whsec_*), or emails in clear text.
 */

/**
 * Redact email addresses, preserving domain for debugging
 * Example: "user@example.com" → "***@example.com"
 */
export function redactEmail(email: string | undefined): string | undefined {
  if (!email) return email;
  
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  
  return `***@${parts[1]}`;
}

/**
 * Redact Stripe secret keys
 * Example: "sk_test_abc123..." → "sk_***"
 */
export function redactStripeKey(key: string | undefined): string | undefined {
  if (!key) return key;
  
  if (key.startsWith('sk_test_') || key.startsWith('sk_live_')) {
    return 'sk_***';
  }
  
  return key;
}

/**
 * Redact Stripe webhook secrets
 * Example: "whsec_abc123..." → "whsec_***"
 */
export function redactWebhookSecret(secret: string | undefined): string | undefined {
  if (!secret) return secret;
  
  if (secret.startsWith('whsec_')) {
    return 'whsec_***';
  }
  
  return secret;
}

/**
 * Redact Authorization headers
 * Example: "Bearer abc123..." → "Bearer ***"
 */
export function redactAuthHeader(auth: string | undefined): string | undefined {
  if (!auth) return auth;
  
  if (auth.toLowerCase().startsWith('bearer ')) {
    return 'Bearer ***';
  }
  
  if (auth.toLowerCase().startsWith('basic ')) {
    return 'Basic ***';
  }
  
  return '***';
}

/**
 * Redact sensitive data from a string
 * Replaces sk_*, whsec_*, emails, and Authorization headers
 */
export function redactString(input: string): string {
  let result = input;
  
  // Redact Stripe secret keys (sk_test_* or sk_live_*)
  result = result.replace(/sk_(test|live)_[a-zA-Z0-9]+/g, 'sk_***');
  
  // Redact webhook secrets
  result = result.replace(/whsec_[a-zA-Z0-9]+/g, 'whsec_***');
  
  // Redact emails (preserve domain)
  result = result.replace(/\b[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, '***@$1');
  
  // Redact Bearer tokens
  result = result.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer ***');
  
  // Redact Basic auth
  result = result.replace(/Basic\s+[a-zA-Z0-9_\-\.=]+/gi, 'Basic ***');
  
  return result;
}

/**
 * Redact sensitive fields from an object for logging
 */
export function redactObject(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }
  
  const redacted: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Redact authorization headers
    if (lowerKey === 'authorization') {
      redacted[key] = redactAuthHeader(value as string);
      continue;
    }
    
    // Redact email fields
    if (lowerKey === 'email' || lowerKey.includes('email')) {
      redacted[key] = redactEmail(value as string);
      continue;
    }
    
    // Redact API key fields
    if (lowerKey.includes('apikey') || lowerKey.includes('api_key') || lowerKey.includes('secret')) {
      if (typeof value === 'string' && value.startsWith('sk_')) {
        redacted[key] = redactStripeKey(value);
        continue;
      }
      if (typeof value === 'string' && value.startsWith('whsec_')) {
        redacted[key] = redactWebhookSecret(value);
        continue;
      }
      redacted[key] = '***';
      continue;
    }
    
    // Recursively redact nested objects
    if (typeof value === 'object' && value !== null) {
      redacted[key] = redactObject(value);
    } else if (typeof value === 'string') {
      redacted[key] = redactString(value);
    } else {
      redacted[key] = value;
    }
  }
  
  return redacted;
}

/**
 * Create a safe log metadata object with redacted sensitive fields
 */
export function createSafeLogMetadata(metadata: Record<string, any>): Record<string, any> {
  return redactObject(metadata);
}

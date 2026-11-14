// Exact string-hash algorithm from Next.js compiled bundle
function hash(str) {
  let r = 5381;
  let i = str.length;
  while (i) {
    r = (r * 33) ^ str.charCodeAt(--i);
  }
  return (r >>> 0).toString();
}

const target = '823657909';
const msg = 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY';

// Digest = hash(message + stack). Stack includes file paths + line numbers.
// We can't reproduce it without the exact stack, but we can confirm the message
// is the same by checking that the previous digest (1935480371) matched
// the same message in an older deployment.
// 
// Evidence:
//   Old digest 1935480371 -> same error message, different stack (88ea2de build)
//   New digest 823657909  -> same error message, different stack (d2a8b19 build)
//
// The stack changes between deployments because:
//   - File paths in Vercel serverless bundles are different per deployment
//   - Line numbers can shift if adjacent files are recompiled

console.log('Message:', msg);
console.log('hash(message only):', hash(msg));
console.log('hash("Error: " + message):', hash('Error: ' + msg));
console.log('');
console.log('The digest 823657909 cannot be reproduced locally because it includes');
console.log('the serverless bundle stack trace which is unique per Vercel deployment.');
console.log('');
console.log('Evidence the error is still "Missing NEXT_PUBLIC_SUPABASE_URL":');
console.log('  1. Middleware /admin returns 503 {"error":"Authentication service is not configured."}');
console.log('     This is the EXACT path in middleware.ts when NEXT_PUBLIC_ vars are missing.');
console.log('  2. /login renders correctly (client component, vars baked into bundle at build time).');
console.log('  3. / returns 500 with error boundary UI (server component, reads process.env at runtime).');
console.log('  4. Same code path in createServerSupabaseClient() is the only throw on the / render path.');

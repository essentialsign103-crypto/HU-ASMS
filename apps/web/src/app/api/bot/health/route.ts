// HU-ASMS: Production Health & Diagnostic Endpoint
// Returns subsystem status WITHOUT exposing secrets, tokens, or PII.
// Protected by TELEGRAM_WEBHOOK_SECRET to prevent public probing.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  // Require the webhook secret in a query param so random crawlers can't probe.
  // This is not a security boundary — it just reduces noise.
  const { searchParams } = new URL(request.url);
  const probe = searchParams.get('probe');
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret || probe !== expectedSecret.substring(0, 16)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    env: {
      TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_WEBHOOK_SECRET: !!process.env.TELEGRAM_WEBHOOK_SECRET,
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      tokenPrefix: process.env.TELEGRAM_BOT_TOKEN
        ? process.env.TELEGRAM_BOT_TOKEN.substring(0, 10) + '...'
        : 'MISSING',
    },
  };

  // 1. Test Supabase admin client init
  try {
    const { getSupabaseAdminClient } = await import('@hu-asms/database');
    const client = getSupabaseAdminClient();
    report.supabaseClientInit = 'ok';

    // 2. Test a simple Supabase query
    const { data, error } = await client
      .from('bot_sessions')
      .select('session_key')
      .limit(1);
    if (error) {
      report.supabaseQuery = { ok: false, error: error.message, code: error.code };
    } else {
      report.supabaseQuery = { ok: true, rowCount: data?.length ?? 0 };
    }

    // 3. Test rate-limit RPC
    const { data: rpcData, error: rpcErr } = await client.rpc('check_and_increment_rate_limit', {
      p_key: 'health:check',
      p_max_requests: 100,
      p_window_ms: 60000,
    });
    if (rpcErr) {
      report.rateLimitRpc = { ok: false, error: rpcErr.message };
    } else {
      report.rateLimitRpc = { ok: true, allowed: rpcData?.[0]?.allowed };
    }
  } catch (err: any) {
    report.supabaseClientInit = { ok: false, error: err?.message };
  }

  // 4. Test Telegram token validity (getMe)
  try {
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!tgToken) {
      report.telegramGetMe = { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
    } else {
      const tgResp = await fetch(`https://api.telegram.org/bot${tgToken}/getMe`);
      const tgJson = await tgResp.json() as any;
      if (tgJson.ok) {
        report.telegramGetMe = {
          ok: true,
          botId: tgJson.result.id,
          username: tgJson.result.username,
        };
      } else {
        report.telegramGetMe = { ok: false, error: tgJson.description };
      }
    }
  } catch (err: any) {
    report.telegramGetMe = { ok: false, error: err?.message };
  }

  // 5. Test createBot
  try {
    const { createBot } = await import('@hu-asms/bot');
    const bot = createBot(process.env.TELEGRAM_BOT_TOKEN, {
      botInfo: {
        id: 9200252077,
        is_bot: true,
        first_name: 'HU ASMS \u2013 Academic Assistant',
        username: 'HU_ASMS_Bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        supports_guest_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      },
    });
    report.botCreate = { ok: true, isInited: bot.isInited() };
  } catch (err: any) {
    report.botCreate = { ok: false, error: err?.message };
  }

  return Response.json(report, { status: 200 });
}

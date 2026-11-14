// HU-ASMS: /help Command Handler (Phase 15 — Complete Help & Support)
import type { BotContext } from '../types/context.js';
import { Keyboard } from 'grammy';

async function checkIfRepresentative(ctx: BotContext): Promise<boolean> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return false;

  try {
    const { getSupabaseAdminClient } = await import('@hu-asms/database');
    const supabase = getSupabaseAdminClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('telegram_user_id', telegramUserId)
      .eq('is_active', true)
      .maybeSingle();

    return profile?.role === 'representative';
  } catch (err) {
    // Fail safe in test environments
    return false;
  }
}

export async function handleHelpCommand(ctx: BotContext): Promise<void> {
  const isRepresentative = await checkIfRepresentative(ctx);

  // Student Help
  if (!isRepresentative) {
    const supportContact = process.env.SUPPORT_CONTACT || 'your Section Representative or System Administrator';
    
    await ctx.reply(
      `📖 *HU-ASMS Student Help Center*\n` +
        `───────────────────────────\n\n` +
        `*🎯 Registration & Identity*\n` +
        `• Your HU Student ID is your permanent academic identity\n` +
        `• Once approved, your identity is locked and cannot be changed without administrator authorization\n` +
        `• If you need to correct your information, use /correction\n\n` +
        `*📚 Finding Your Assignments*\n` +
        `• Use /start → 📋 My Projects to view available assignments\n` +
        `• Projects are targeted to your academic year and section\n` +
        `• Check deadlines and file requirements before submitting\n\n` +
        `*📤 Individual Submissions*\n` +
        `• Select 📤 Submit Assignment from the main menu or use /submit\n` +
        `• Choose your project and follow the file upload instructions\n` +
        `• Ensure your file meets the required format and size limits\n` +
        `• Submissions before the deadline can be updated if resubmission is allowed\n\n` +
        `*👥 Group Submissions*\n` +
        `• All group members must confirm membership before submission\n` +
        `• Use /groups to view and confirm your group assignments\n` +
        `• Only the designated group leader can submit the final work\n` +
        `• Select 🚀 Submit Group Project or use /submit_group\n\n` +
        `*📜 Tracking Your Submissions*\n` +
        `• Use 📜 Submission History to review past submissions\n` +
        `• Your submissions are routed to your section representative\n` +
        `• Representatives forward submissions to the designated teacher\n\n` +
        `*🔒 Deadlines & File Restrictions*\n` +
        `• Each project has a specific deadline (check project details)\n` +
        `• Only specified file types are accepted (typically PDF)\n` +
        `• File size limits apply (check project file rules)\n` +
        `• Late submissions after deadline are blocked by the system\n\n` +
        `*📞 Support Contact*\n` +
        `For additional assistance, contact: ${supportContact}\n\n` +
        `*💡 Available Commands:*\n` +
        `/start - Main menu\n` +
        `/profile - View your profile\n` +
        `/submit - Submit assignment\n` +
        `/submit_group - Submit group project\n` +
        `/groups - Manage group memberships\n` +
        `/correction - Request identity correction\n` +
        `/cancel - Cancel current operation\n` +
        `/help - Show this help`,
      { 
        parse_mode: 'Markdown',
        reply_markup: new Keyboard()
          .text('🏠 Back to Main Menu')
          .resized()
          .oneTime()
      }
    );
    return;
  }

  // Representative Help
  const supportContact = process.env.SUPPORT_CONTACT || 'System Administrator';
  
  await ctx.reply(
    `📖 *HU-ASMS Representative Help Center*\n` +
      `───────────────────────────\n\n` +
      `*🎖️ Your Responsibilities*\n` +
      `• Monitor incoming student submissions for your assigned section(s)\n` +
      `• Review submission metadata and file quality\n` +
      `• Forward approved submissions to designated teachers\n` +
      `• Track delivery status and confirm teacher receipt\n` +
      `• Report technical issues or missing configurations\n\n` +
      `*🏢 Assigned Section Scope*\n` +
      `• You have read-only access to your assigned academic section(s)\n` +
      `• You can only view students, projects, and submissions within your scope\n` +
      `• Section assignment is controlled by the System Administrator\n` +
      `• Use 🏢 My Assigned Sections to view your current scope\n\n` +
      `*📥 Incoming Student Submissions*\n` +
      `• You receive automatic notifications when students submit work\n` +
      `• Use 📊 Submission Reports to view submitted and missing work\n` +
      `• Use 📂 View All Projects to see active assignments in your scope\n` +
      `• Individual and group submissions are tracked separately\n\n` +
      `*✅ Submission Review Process*\n` +
      `1. Check project details (title, course, teacher, deadline)\n` +
      `2. Verify student or group identity\n` +
      `3. Review file name and size\n` +
      `4. For group submissions, verify confirmed membership\n` +
      `5. Prepare delivery batch when ready to forward to teacher\n\n` +
      `*📦 Teacher Delivery Workflow*\n` +
      `• Teacher assignment is controlled by the administrator\n` +
      `• You cannot independently select or change the designated teacher\n` +
      `• Use the Representative Web Portal for delivery batch creation\n` +
      `• Access: ${process.env.APP_BASE_URL || 'Portal URL'}/rep/deliveries/new\n` +
      `• Download signed file URLs and forward through approved channels\n` +
      `• Record delivery status: prepared → sent → acknowledged\n\n` +
      `*📜 Delivery Status Tracking*\n` +
      `• Use 📜 Delivery History to view past deliveries\n` +
      `• Track: batch count, status, channel, timestamps\n` +
      `• "Sent" means delivery attempted (teacher acknowledgment separate)\n` +
      `• Failed deliveries require retry or escalation\n\n` +
      `*⚠️ Escalation & Problem Reporting*\n` +
      `• Missing teacher Telegram destination → Contact: ${supportContact}\n` +
      `• Telegram delivery failure → Retry or report to ${supportContact}\n` +
      `• Student identity issues → Direct student to /correction\n` +
      `• Technical errors → Screenshot and report to ${supportContact}\n` +
      `• Unauthorized access attempts → Report immediately\n\n` +
      `*💡 Available Commands:*\n` +
      `/start - Main menu\n` +
      `/reports - Submission reports\n` +
      `/help - Show this help\n` +
      `/cancel - Cancel current operation`,
    { 
      parse_mode: 'Markdown',
      reply_markup: new Keyboard()
        .text('🏠 Back to Main Menu')
        .resized()
        .oneTime()
    }
  );
}

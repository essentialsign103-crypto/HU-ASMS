// HU-ASMS: Student Group Membership & Confirmation Handlers (Phase 08)
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types/context.js';
import { GroupManagementService } from '../services/group.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';

export async function handleMyGroups(ctx: BotContext): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const groupService = new GroupManagementService(supabase);

  const studentGroups = await groupService.getStudentGroups(telegramUserId);

  if (studentGroups.length === 0) {
    await ctx.reply(
      `👥 *My Academic Groups*\n\n` +
        `You have not been assigned to any project groups yet.\n` +
        `Groups are pre-created by the System Owner or Section Representative before group submissions begin.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  for (const item of studentGroups) {
    const { group, project, membership, allMembers } = item;
    const isLeader = membership.is_group_leader;
    const verificationBadge =
      group.status === 'verified'
        ? '✅ Fully Verified (Eligible to Submit)'
        : '⏳ Pending Verification (Awaiting Member Confirmations)';

    let text =
      `👥 *${group.group_code} — ${project.title}*\n` +
      `───────────────────────────\n` +
      `• *Group Status:* ${verificationBadge}\n` +
      `• *Your Role:* ${isLeader ? '🎖️ Group Leader (Authorized Submitter)' : '👤 Member'}\n` +
      `• *Your Status:* *${membership.confirmation_status.toUpperCase()}*\n\n` +
      `*Team Members Confirmation Progress:*\n`;

    allMembers.forEach((m, idx) => {
      let icon = '⏳';
      if (m.confirmation_status === 'confirmed') icon = '✅';
      if (m.confirmation_status === 'declined') icon = '❌';

      const leaderTag = m.is_group_leader ? ' [Leader]' : '';
      text += `${idx + 1}. ${icon} *${m.student?.full_name || 'Student'}* (\`${m.student?.hu_student_id}\`)${leaderTag} — _${m.confirmation_status}_\n`;
    });

    const keyboard = new InlineKeyboard();

    if (membership.confirmation_status === 'pending') {
      text += `\n⚠️ *Action Required:*\n` +
              `You have been assigned to *${group.group_code}* for *${project.title}*. Please confirm whether you are a member of this group:`;

      keyboard
        .text('✅ Confirm Membership', `grp_confirm_${group.id}`)
        .text('❌ Decline / Report Error', `grp_decline_${group.id}`)
        .row();
    } else if (membership.confirmation_status === 'confirmed') {
      text += `\n_You confirmed membership on ${new Date(membership.confirmed_at || Date.now()).toLocaleDateString()}._`;
    } else if (membership.confirmation_status === 'declined') {
      text += `\n_You declined this membership assignment._`;
    }

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined,
    });
  }
}

export async function handleMembershipAction(
  ctx: BotContext,
  groupId: string,
  action: 'confirmed' | 'declined'
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const groupService = new GroupManagementService(supabase);

  try {
    const result = await groupService.confirmMembership(telegramUserId, groupId, action);
    await ctx.answerCallbackQuery({
      text: action === 'confirmed' ? 'Membership confirmed!' : 'Membership assignment declined.',
    });

    if (action === 'confirmed') {
      let followUpMsg = `✅ *Membership Confirmed!*\n\nYou have successfully confirmed your membership in this group.`;
      if (result.isGroupVerified) {
        followUpMsg += `\n\n🎉 *All required members have confirmed!* This group is now *Fully Verified* and ready for final submission by your group leader.`;
      } else {
        followUpMsg += `\n\n⏳ The group will become fully verified once all remaining members confirm.`;
      }
      await ctx.reply(followUpMsg, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(
        `❌ *Membership Declined*\n\n` +
          `You have declined membership in this group. The group verification is paused and your section representative has been notified of the conflict.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.answerCallbackQuery({ text: `Error: ${msg}` });
    await ctx.reply(`❌ Could not update membership: ${msg}`);
  }
}

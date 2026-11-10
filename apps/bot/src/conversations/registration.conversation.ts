// HU-ASMS: Student Registration Conversation (Phase 04)
import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { StudentRegistrationService } from '../services/registration.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { getStudentMainMenuKeyboard } from '../keyboards/main-menu.js';
import { BOT_MESSAGES } from '@hu-asms/shared';

export async function registrationConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Unable to identify Telegram account.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const registrationService = new StudentRegistrationService(supabase);

  // 1. Initial Prompt for HU Student ID
  await ctx.reply(
    `🎓 *Haramaya University Academic Submission System*\n\n` +
      `Please enter your official *HU Student ID* to proceed (e.g. \`HU/10294/14\` or \`HU-2024-001\`):`,
    { parse_mode: 'Markdown' }
  );

  const idMsg = await conversation.waitFor(':text');
  const rawId = idMsg.message?.text?.trim() || '';

  // 2. Lookup Identity
  let lookupResult;
  try {
    lookupResult = await conversation.external(() =>
      registrationService.lookupStudentIdentity(rawId, telegramUserId)
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ ${errorMsg}\n\nPlease send /start to try again.`);
    return;
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Linked to current Telegram user
  // ---------------------------------------------------------------------------
  if (lookupResult.status === 'linked_to_current_user') {
    const student = lookupResult.student!;
    await ctx.reply(
      `👋 *Welcome back, ${student.full_name}!*\n\n` +
        `HU Student ID: \`${student.hu_student_id}\`\n` +
        `Department: *${student.department?.name || 'N/A'}*\n` +
        `Academic Scope: *${student.academic_year?.name || 'N/A'} — ${student.section?.name || 'N/A'}*\n` +
        `Status: *${student.registration_status.toUpperCase()} (Locked)*\n\n` +
        `Select an option below to continue:`,
      {
        parse_mode: 'Markdown',
        reply_markup: getStudentMainMenuKeyboard(),
      }
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Linked to another Telegram user (Protection against Identity Theft)
  // ---------------------------------------------------------------------------
  if (lookupResult.status === 'linked_to_another_user') {
    const masked = lookupResult.maskedInfo!;
    await ctx.reply(
      `⚠️ *Account Verification Alert*\n\n` +
        `The Student ID \`${rawId.toUpperCase()}\` is already linked to another registered Telegram account.\n\n` +
        `Registered Student: *${masked.maskedName}*\n` +
        `Department: *${masked.departmentName}*\n\n` +
        `🔒 *Security Notice:* To protect academic identity, students cannot claim existing student records without administrator verification.\n\n` +
        `If this is your student ID and you changed your Telegram account or lost access, please contact your *System Owner* or *Section Representative* for account recovery.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Pending Registration Request
  // ---------------------------------------------------------------------------
  if (lookupResult.status === 'pending_approval') {
    await ctx.reply(
      `⏳ *Registration Awaiting Verification*\n\n` +
        `A registration request for Student ID \`${rawId.toUpperCase()}\` has already been submitted and is currently pending administrator verification.\n\n` +
        `You will receive an automated notification as soon as the System Owner approves your registration.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Account Suspended
  // ---------------------------------------------------------------------------
  if (lookupResult.status === 'suspended') {
    await ctx.reply(
      `⛔ *Account Suspended*\n\n` +
        `Your academic account is currently suspended.\n` +
        `Reason: _${lookupResult.student?.suspension_reason || 'Administrative restriction'}_\n\n` +
        `Please contact your academic section representative or system owner.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Exists in Pre-Approved Roster (Unlinked)
  // ---------------------------------------------------------------------------
  if (lookupResult.status === 'unlinked_roster_record') {
    const student = lookupResult.student!;
    const maskedName = registrationService.maskName(student.full_name);

    const linkKeyboard = new InlineKeyboard()
      .text('✅ Confirm & Bind Account', 'confirm_roster_bind')
      .text('❌ Cancel', 'cancel_roster_bind');

    await ctx.reply(
      `🎓 *Official University Record Matched*\n\n` +
        `HU Student ID: \`${student.hu_student_id}\`\n` +
        `Student Name: *${maskedName}*\n` +
        `Department: *${student.department?.name}*\n` +
        `Academic Year: *${student.academic_year?.name}*\n` +
        `Section: *${student.section?.name}*\n\n` +
        `Please confirm that this is your university identity to bind this Telegram account permanently:`,
      { parse_mode: 'Markdown', reply_markup: linkKeyboard }
    );

    const decision = await conversation.waitForCallbackQuery([
      'confirm_roster_bind',
      'cancel_roster_bind',
    ]);

    if (decision.callbackQuery.data === 'confirm_roster_bind') {
      await conversation.external(() =>
        registrationService.linkRosterStudentToTelegram(
          student.id,
          telegramUserId,
          ctx.from?.username
        )
      );

      await decision.answerCallbackQuery({ text: 'Account successfully bound!' });
      await ctx.reply(
        `🎉 *Account Successfully Linked and Locked!*\n\n` +
          `Welcome, *${student.full_name}*! Your Telegram account is now permanently associated with your official HU identity.\n\n` +
          `Use the menu below to navigate:`,
        {
          parse_mode: 'Markdown',
          reply_markup: getStudentMainMenuKeyboard(),
        }
      );
    } else {
      await decision.answerCallbackQuery({ text: 'Binding cancelled.' });
      await ctx.reply('Registration process cancelled.');
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: First-Time Registration Flow (Not found in Roster)
  // ---------------------------------------------------------------------------
  await ctx.reply(
    `📝 *First-Time Student Registration*\n\n` +
      `Student ID \`${rawId.toUpperCase()}\` was not found on the active roster.\n` +
      `Let's complete your initial registration for administrator approval.\n\n` +
      `Please enter your *Full Name* (as documented on your official university ID card):`,
    { parse_mode: 'Markdown' }
  );

  const nameMsg = await conversation.waitFor(':text');
  const fullName = nameMsg.message?.text?.trim() || '';

  if (fullName.length < 3) {
    await ctx.reply('❌ Full name is too short. Please run /start again.');
    return;
  }

  // Step A: Department Selection
  const departments = await conversation.external(() =>
    registrationService.getDepartments()
  );
  if (departments.length === 0) {
    await ctx.reply('System configuration error: No academic departments found. Contact administrator.');
    return;
  }

  const deptKeyboard = new InlineKeyboard();
  departments.forEach((dept, i) => {
    deptKeyboard.text(dept.name, `dept_${dept.id}`);
    if ((i + 1) % 2 === 0) deptKeyboard.row();
  });

  await ctx.reply('Select your *Academic Department*:', {
    parse_mode: 'Markdown',
    reply_markup: deptKeyboard,
  });

  const deptCb = await conversation.waitForCallbackQuery(/^dept_/);
  const selectedDeptId = deptCb.callbackQuery.data.replace('dept_', '');
  const selectedDept = departments.find((d) => d.id === selectedDeptId);
  await deptCb.answerCallbackQuery();

  // Step B: Academic Year Selection
  const years = await conversation.external(() =>
    registrationService.getAcademicYears()
  );
  const yearKeyboard = new InlineKeyboard();
  years.forEach((yr) => {
    yearKeyboard.text(yr.name, `year_${yr.id}`).row();
  });

  await ctx.reply(`Department: *${selectedDept?.name}*\n\nSelect your *Academic Year*:`, {
    parse_mode: 'Markdown',
    reply_markup: yearKeyboard,
  });

  const yearCb = await conversation.waitForCallbackQuery(/^year_/);
  const selectedYearId = yearCb.callbackQuery.data.replace('year_', '');
  const selectedYear = years.find((y) => y.id === selectedYearId);
  await yearCb.answerCallbackQuery();

  // Step C: Section Selection
  const sections = await conversation.external(() =>
    registrationService.getSectionsByYear(selectedYearId)
  );
  if (sections.length === 0) {
    await ctx.reply('No active sections configured for this academic year yet. Contact administrator.');
    return;
  }

  const secKeyboard = new InlineKeyboard();
  sections.forEach((sec) => {
    secKeyboard.text(sec.name, `sec_${sec.id}`);
  });

  await ctx.reply(
    `Academic Year: *${selectedYear?.name}*\n\nSelect your *Section*:`,
    { parse_mode: 'Markdown', reply_markup: secKeyboard }
  );

  const secCb = await conversation.waitForCallbackQuery(/^sec_/);
  const selectedSecId = secCb.callbackQuery.data.replace('sec_', '');
  const selectedSec = sections.find((s) => s.id === selectedSecId);
  await secCb.answerCallbackQuery();

  // Step D: Registration Warning & Locking Disclosure
  await ctx.reply(BOT_MESSAGES.REGISTRATION_WARNING, { parse_mode: 'Markdown' });

  // Step E: Review and Confirmation Summary
  const confirmKeyboard = new InlineKeyboard()
    .text('✅ Confirm and Submit Registration', 'reg_confirm_submit')
    .text('❌ Cancel', 'reg_cancel');

  await ctx.reply(
    `📋 *Please Review Your Information Carefully*\n\n` +
      `HU Student ID: \`${rawId.toUpperCase()}\`\n` +
      `Full Name: *${fullName}*\n` +
      `Department: *${selectedDept?.name}*\n` +
      `Academic Year: *${selectedYear?.name}*\n` +
      `Section: *${selectedSec?.name}*\n` +
      `Telegram Account ID: \`${telegramUserId}\`\n\n` +
      `After submission, your identity will be verified against the university roster and locked.`,
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );

  const finalDecision = await conversation.waitForCallbackQuery([
    'reg_confirm_submit',
    'reg_cancel',
  ]);

  if (finalDecision.callbackQuery.data === 'reg_confirm_submit') {
    try {
      await conversation.external(() =>
        registrationService.submitFirstTimeRegistration({
          hu_student_id: rawId,
          full_name: fullName,
          department_id: selectedDeptId,
          academic_year_id: selectedYearId,
          section_id: selectedSecId,
          telegram_user_id: telegramUserId,
          telegram_username: ctx.from?.username,
        })
      );

      await finalDecision.answerCallbackQuery({ text: 'Registration submitted!' });
      await ctx.reply(BOT_MESSAGES.REGISTRATION_SUBMITTED, { parse_mode: 'Markdown' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ Registration error: ${msg}`);
    }
  } else {
    await finalDecision.answerCallbackQuery({ text: 'Registration cancelled.' });
    await ctx.reply('Registration cancelled. You can restart anytime using /start.');
  }
}

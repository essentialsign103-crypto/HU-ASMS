// HU-ASMS: Student Registration, Claim Verification & Account Recovery Conversation
// Enforces zero pre-verification PII exposure and blocks unverified roster claims by HU ID alone.
import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { StudentRegistrationService } from '../services/registration.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { sanitizeHuStudentId, isValidHuStudentId } from '@hu-asms/validation';
import { getStudentMainMenuKeyboard } from '../keyboards/main-menu.js';
import type { Department, AcademicYear, Section } from '@hu-asms/types';
import { requirePrivateChat } from '../utils/chat-guard.js';

interface CollectedAcademicProfile {
  fullName: string;
  selectedDept: Department;
  selectedYear: AcademicYear;
  selectedSec: Section;
}

async function collectAcademicProfile(
  conversation: BotConversation,
  ctx: BotContext,
  registrationService: StudentRegistrationService
): Promise<CollectedAcademicProfile | null> {
  await ctx.reply('👤 Please enter your *Full Name* (as written on your University ID):', {
    parse_mode: 'Markdown',
  });
  const nameMsg = await conversation.waitFor(':text');
  const fullName = nameMsg.message?.text?.trim() || '';
  if (fullName.length < 3) {
    await ctx.reply('❌ Full Name is too short. Please run /start to begin again.');
    return null;
  }

  const depts = await conversation.external(() => registrationService.getDepartments());
  if (depts.length === 0) {
    await ctx.reply('⚠️ System configuration incomplete: No departments found. Contact administrator.');
    return null;
  }

  const deptKeyboard = new InlineKeyboard();
  depts.forEach((d) => deptKeyboard.text(d.name, `reg_dept_${d.id}`).row());

  await ctx.reply('🏢 Select your *Department*:', {
    parse_mode: 'Markdown',
    reply_markup: deptKeyboard,
  });
  const deptCallback = await conversation.waitForCallbackQuery(/^reg_dept_/);
  const deptId = deptCallback.callbackQuery.data.replace('reg_dept_', '');
  const selectedDept = depts.find((d) => d.id === deptId);
  if (!selectedDept) {
    await deptCallback.answerCallbackQuery({ text: 'Invalid department selection' });
    await ctx.reply('❌ Invalid department selected. Please run /start again.');
    return null;
  }
  await deptCallback.answerCallbackQuery({ text: `Selected ${selectedDept.name}` });

  const years = await conversation.external(() => registrationService.getAcademicYears());
  if (years.length === 0) {
    await ctx.reply('⚠️ System configuration incomplete: No active academic years found.');
    return null;
  }

  const yearKeyboard = new InlineKeyboard();
  years.forEach((y) => yearKeyboard.text(y.name, `reg_year_${y.id}`).row());

  await ctx.reply('📚 Select your *Academic Year*:', {
    parse_mode: 'Markdown',
    reply_markup: yearKeyboard,
  });
  const yearCallback = await conversation.waitForCallbackQuery(/^reg_year_/);
  const yearId = yearCallback.callbackQuery.data.replace('reg_year_', '');
  const selectedYear = years.find((y) => y.id === yearId);
  if (!selectedYear) {
    await yearCallback.answerCallbackQuery({ text: 'Invalid academic year selection' });
    await ctx.reply('❌ Invalid academic year selected. Please run /start again.');
    return null;
  }
  await yearCallback.answerCallbackQuery({ text: `Selected ${selectedYear.name}` });

  const sections = await conversation.external(() =>
    registrationService.getSectionsByYear(selectedYear.id)
  );
  if (sections.length === 0) {
    await ctx.reply('⚠️ No sections configured for this academic year. Contact administrator.');
    return null;
  }

  const secKeyboard = new InlineKeyboard();
  sections.forEach((s) => secKeyboard.text(s.name, `reg_sec_${s.id}`).row());

  await ctx.reply('🏫 Select your *Section*:', {
    parse_mode: 'Markdown',
    reply_markup: secKeyboard,
  });
  const secCallback = await conversation.waitForCallbackQuery(/^reg_sec_/);
  const sectionId = secCallback.callbackQuery.data.replace('reg_sec_', '');
  const selectedSec = sections.find((s) => s.id === sectionId);
  if (!selectedSec) {
    await secCallback.answerCallbackQuery({ text: 'Invalid section selection' });
    await ctx.reply('❌ Invalid section selected. Please run /start again.');
    return null;
  }
  await secCallback.answerCallbackQuery({ text: `Selected ${selectedSec.name}` });

  return { fullName, selectedDept, selectedYear, selectedSec };
}

export async function registrationConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  if (!(await requirePrivateChat(ctx, 'student registration and account verification'))) {
    return;
  }

  const telegramUserId = ctx.from?.id;
  const telegramUsername = ctx.from?.username || null;

  if (!telegramUserId) {
    await ctx.reply('Error: Could not verify your Telegram account identity.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const registrationService = new StudentRegistrationService(supabase);

  // 1. Block duplicate linking when Telegram account already has a registered or suspended student
  const existingLinked = await conversation.external(() =>
    registrationService.getStudentByTelegramId(telegramUserId)
  );

  if (existingLinked) {
    if (existingLinked.registration_status === 'suspended') {
      await ctx.reply(
        `🚫 *Account Suspended*\n\n` +
          `Your account (\`${existingLinked.hu_student_id}\`) is suspended.\n` +
          `Please contact the System Owner / Academic Administrator.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply(
      `👋 *Welcome back, ${existingLinked.full_name}!*\n` +
        `Your account (\`${existingLinked.hu_student_id}\`) is already verified and locked.`,
      {
        parse_mode: 'Markdown',
        reply_markup: getStudentMainMenuKeyboard(),
      }
    );
    return;
  }

  // 2. Check existing pending request owned by this Telegram user
  const existingPending = await conversation.external(() =>
    registrationService.getPendingRequestByTelegramId(telegramUserId)
  );

  if (existingPending) {
    await ctx.reply(
      `⏳ *Verification Request Already Pending*\n\n` +
        `Your request for HU ID \`${existingPending.hu_student_id}\` is awaiting System Owner approval.\n` +
        `You will receive a notification once reviewed.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 3. Prompt for HU Student ID
  await ctx.reply(
    `🎓 *Welcome to Hawassa University Assignment Submission Bot*\n\n` +
      `To verify or register your academic identity, please enter your official *HU Student ID*:\n` +
      `*(Example: HU/10294/14 or HU-2024-001)*`,
    { parse_mode: 'Markdown' }
  );

  const idResponse = await conversation.waitFor(':text');
  const rawId = idResponse.message?.text?.trim() || '';
  const sanitizedId = sanitizeHuStudentId(rawId);

  if (!isValidHuStudentId(sanitizedId)) {
    await ctx.reply(
      `❌ *Invalid Student ID Format*\n` +
        `You entered: \`${rawId}\`\n\n` +
        `Please run /start again and enter a valid HU Student ID (e.g., HU/10294/14).`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 4. Perform privacy-preserving identity lookup (zero unverified PII returned)
  const lookup = await conversation.external(() =>
    registrationService.lookupStudentIdentity(sanitizedId, telegramUserId)
  );

  if (lookup.status === 'suspended' && lookup.student) {
    await ctx.reply(
      `🚫 *Account Suspended*\n\nYour student account (\`${lookup.student.hu_student_id}\`) is currently suspended. Contact administration.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (lookup.status === 'telegram_already_linked') {
    await ctx.reply(
      `⚠️ *Duplicate Account Linking Blocked*\n\nYour Telegram account is already linked to an existing student identity.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (lookup.status === 'pending_approval') {
    await ctx.reply(
      `⏳ *Verification Pending*\n\nA registration or identity verification request involving \`${sanitizedId}\` is already under System Owner review.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 5. Verified Claim or Lost-Account Recovery Path (NEVER exposes stored name/department/scope)
  if (
    lookup.status === 'unlinked_roster_verification_required' ||
    lookup.status === 'linked_to_another_user'
  ) {
    const isRecovery = lookup.status === 'linked_to_another_user';
    const requestType = isRecovery ? 'account_recovery' : 'roster_claim';

    const actionKeyboard = new InlineKeyboard()
      .text(
        isRecovery ? '🔑 Enter Recovery Code' : '🔑 Enter Verification Code',
        'verify_with_token'
      )
      .row()
      .text(
        isRecovery ? '📝 Request Admin Recovery' : '📝 Request Admin Verification',
        'verify_with_admin'
      )
      .row()
      .text('❌ Cancel', 'cancel_verification');

    await ctx.reply(
      isRecovery
        ? `🔒 *Verification Required for Account Recovery*\n\n` +
            `Student ID \`${sanitizedId}\` is currently associated with another Telegram account.\n` +
            `To protect student privacy, no account details are shown here.\n\n` +
            `If you lost access to your previous Telegram account, choose one of the verified options below:`
        : `🔐 *Identity Verification Required*\n\n` +
            `Knowing an HU Student ID alone is not sufficient to claim a university account.\n` +
            `To verify your ownership of \`${sanitizedId}\`, enter a single-use System Owner verification code or submit an administrator-reviewed claim request:`,
      {
        parse_mode: 'Markdown',
        reply_markup: actionKeyboard,
      }
    );

    const choice = await conversation.waitForCallbackQuery([
      'verify_with_token',
      'verify_with_admin',
      'cancel_verification',
    ]);

    if (choice.callbackQuery.data === 'cancel_verification') {
      await choice.answerCallbackQuery({ text: 'Cancelled' });
      await ctx.reply('Verification cancelled. Run /start when ready.');
      return;
    }

    if (choice.callbackQuery.data === 'verify_with_token') {
      await choice.answerCallbackQuery({ text: 'Verification code selected' });
      await ctx.reply(
        `🔑 Enter the single-use *${isRecovery ? 'Recovery' : 'Verification'} Code* issued for \`${sanitizedId}\`:`,
        { parse_mode: 'Markdown' }
      );
      const tokenMsg = await conversation.waitFor(':text');
      const rawToken = tokenMsg.message?.text?.trim() || '';

      try {
        const verifiedStudent = await conversation.external(() =>
          registrationService.redeemVerificationToken(
            sanitizedId,
            rawToken,
            telegramUserId,
            telegramUsername
          )
        );
        await ctx.reply(
          `✅ *Identity Verified & Account Locked!*\n\n` +
            `Welcome, *${verifiedStudent.full_name}* (\`${verifiedStudent.hu_student_id}\`).\n` +
            `You may now access your academic dashboard:`,
          {
            parse_mode: 'Markdown',
            reply_markup: getStudentMainMenuKeyboard(),
          }
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Verification failed.';
        await ctx.reply(
          `❌ *Verification Failed*\n\n${msg}\n\nRun /start to try again or request System Owner review.`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    // Admin-reviewed claim / recovery workflow
    await choice.answerCallbackQuery({ text: 'Admin verification selected' });
    const profile = await collectAcademicProfile(conversation, ctx, registrationService);
    if (!profile) return;

    await ctx.reply(
      isRecovery
        ? `📄 Explain why you need *Telegram Account Recovery* (at least 10 characters, e.g., lost phone / new SIM):`
        : `📄 Provide verification details for your *Roster Claim* (at least 10 characters):`,
      { parse_mode: 'Markdown' }
    );
    const reasonMsg = await conversation.waitFor(':text');
    const recoveryReason = reasonMsg.message?.text?.trim() || '';
    if (recoveryReason.length < 10) {
      await ctx.reply(
        '❌ Explanation too short (minimum 10 characters). Please run /start to submit again.'
      );
      return;
    }

    const submitKeyboard = new InlineKeyboard()
      .text('✅ Submit for Admin Review', 'confirm_claim_req')
      .text('❌ Cancel', 'cancel_claim_req');

    await ctx.reply(
      `📋 *Confirm ${isRecovery ? 'Account Recovery' : 'Identity Claim'} Submission*\n\n` +
        `• HU Student ID: \`${sanitizedId}\`\n` +
        `• Full Name: *${profile.fullName}*\n` +
        `• Department: *${profile.selectedDept.name}*\n` +
        `• Academic Scope: *${profile.selectedYear.name} — ${profile.selectedSec.name}*\n\n` +
        `The System Owner will verify your details before linking your Telegram account. Submit?`,
      {
        parse_mode: 'Markdown',
        reply_markup: submitKeyboard,
      }
    );

    const submitDecision = await conversation.waitForCallbackQuery([
      'confirm_claim_req',
      'cancel_claim_req',
    ]);

    if (submitDecision.callbackQuery.data === 'confirm_claim_req') {
      try {
        await conversation.external(() =>
          registrationService.submitVerifiedClaimOrRecoveryRequest({
            hu_student_id: sanitizedId,
            full_name: profile.fullName,
            department_id: profile.selectedDept.id,
            academic_year_id: profile.selectedYear.id,
            section_id: profile.selectedSec.id,
            telegram_user_id: telegramUserId,
            telegram_username: telegramUsername,
            request_type: requestType,
            recovery_reason: recoveryReason,
          })
        );
        await submitDecision.answerCallbackQuery({ text: 'Request submitted' });
        await ctx.reply(
          `⏳ *${isRecovery ? 'Account Recovery' : 'Identity Claim'} Request Submitted*\n\n` +
            `Your request has been queued for System Owner verification.\n` +
            `Your Telegram account will be linked once approved.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unable to submit request.';
        await ctx.reply(`❌ ${msg}`);
      }
    } else {
      await submitDecision.answerCallbackQuery({ text: 'Cancelled' });
      await ctx.reply('Request cancelled. Run /start when ready.');
    }
    return;
  }

  // 6. Scenario: Not found -> Preserved First-Time Registration Workflow
  await ctx.reply(
    `📝 *New Student Registration*\n\n` +
      `Your Student ID \`${sanitizedId}\` requires first-time registration.\n` +
      `Please complete your official academic details for System Owner approval:`,
    { parse_mode: 'Markdown' }
  );

  const profile = await collectAcademicProfile(conversation, ctx, registrationService);
  if (!profile) return;

  const confirmRegKeyboard = new InlineKeyboard()
    .text('✅ Confirm & Submit Registration', 'confirm_reg')
    .text('❌ Cancel', 'cancel_reg');

  await ctx.reply(
    `📋 *Review Your Registration Details*\n\n` +
      `• *HU Student ID:* \`${sanitizedId}\`\n` +
      `• *Full Name:* ${profile.fullName}\n` +
      `• *Department:* ${profile.selectedDept.name}\n` +
      `• *Academic Year:* ${profile.selectedYear.name}\n` +
      `• *Section:* ${profile.selectedSec.name}\n\n` +
      `⚠️ Once approved, your academic identity is *permanently locked*. Do you confirm these details?`,
    { parse_mode: 'Markdown', reply_markup: confirmRegKeyboard }
  );

  const finalConfirm = await conversation.waitForCallbackQuery(['confirm_reg', 'cancel_reg']);
  if (finalConfirm.callbackQuery.data === 'confirm_reg') {
    try {
      await conversation.external(() =>
        registrationService.submitFirstTimeRegistration({
          hu_student_id: sanitizedId,
          full_name: profile.fullName,
          department_id: profile.selectedDept.id,
          academic_year_id: profile.selectedYear.id,
          section_id: profile.selectedSec.id,
          telegram_user_id: telegramUserId,
          telegram_username: telegramUsername,
        })
      );

      await finalConfirm.answerCallbackQuery({ text: 'Registration Submitted' });
      await ctx.reply(
        `⏳ *Registration Submitted for Approval*\n\n` +
          `Your request for HU ID \`${sanitizedId}\` has been forwarded to the System Owner.\n` +
          `You will be notified via this bot once approved.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ Failed to submit registration: ${msg}`);
    }
  } else {
    await finalConfirm.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Registration cancelled. Run /start when ready.');
  }
}

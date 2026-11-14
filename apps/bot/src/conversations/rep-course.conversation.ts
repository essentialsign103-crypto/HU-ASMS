// HU-ASMS: Representative Create Course Offering Conversation (Phase B — Core Workflow)
// Guides a representative through creating a new course-section offering:
//   section (derived from rep's assignment) → catalog course → teacher → confirm
//
// Authorization: representative's Telegram ID → active representative_assignment →
// section_id. The representative may only create offerings for their own section.
// DB-level trigger (enforce_cso_integrity) verifies section/year consistency.

import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import {
  CourseOfferingService,
  AcademicManagementService,
} from '@hu-asms/database';
import { RepresentativeService } from '../services/representative.service.js';
import { requirePrivateChat } from '../utils/chat-guard.js';
import { getRepresentativeMainMenuKeyboard } from '../keyboards/main-menu.js';

export async function repCreateCourseConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  if (!(await requirePrivateChat(ctx, 'course creation'))) return;

  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Could not identify your Telegram account.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);

  // 1. Resolve representative's assignments
  const repData = await conversation.external(() =>
    repService.getRepresentativeProfile(telegramUserId)
  );

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply('⚠️ You do not have any active section assignments. Cannot create a course.');
    return;
  }

  // 2. If more than one section, ask the rep to pick one
  let selectedSectionId: string;
  let selectedAcademicYearId: string;
  let selectedSectionName: string;

  if (repData.assignments.length === 1) {
    const a = repData.assignments[0];
    selectedSectionId = a.section_id;
    selectedAcademicYearId = a.section?.academic_year_id || '';
    selectedSectionName = `${a.section?.academic_year?.name || ''} — ${a.section?.name || ''}`;
  } else {
    const keyboard = new InlineKeyboard();
    repData.assignments.forEach((a) => {
      keyboard
        .text(
          `${a.section?.academic_year?.name || ''} — ${a.section?.name || a.section_id}`,
          `csc_sec_${a.section_id}`
        )
        .row();
    });

    await ctx.reply(
      `➕ *Create Course Offering*\n\nYou are assigned to multiple sections.\nSelect the section this course will serve:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );

    const secCb = await conversation.waitForCallbackQuery(/^csc_sec_/);
    selectedSectionId = secCb.callbackQuery.data.replace('csc_sec_', '');
    const chosenAssign = repData.assignments.find((a) => a.section_id === selectedSectionId);
    selectedAcademicYearId = chosenAssign?.section?.academic_year_id || '';
    selectedSectionName = `${chosenAssign?.section?.academic_year?.name || ''} — ${chosenAssign?.section?.name || ''}`;
    await secCb.answerCallbackQuery({ text: `Selected ${selectedSectionName}` });
  }

  if (!selectedAcademicYearId) {
    await ctx.reply('❌ Could not determine academic year from your section. Contact administrator.');
    return;
  }

  // 3. Fetch available catalog courses (not yet offered in this section+year)
  const cso = new CourseOfferingService(supabase);
  const academicService = new AcademicManagementService(supabase);

  const availableCourses = await conversation.external(() =>
    cso.getAvailableCatalogCourses(selectedSectionId, selectedAcademicYearId)
  );

  if (availableCourses.length === 0) {
    await ctx.reply(
      `📚 *All Catalog Courses Already Offered*\n\n` +
        `All available courses have already been added to *${selectedSectionName}*.\n\n` +
        `If you need a new course code, ask your System Administrator to add it to the university catalog.`,
      { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
    );
    return;
  }

  // 4. Present course selection (paginated in groups of 8)
  const PAGE_SIZE = 8;
  const courseKeyboard = new InlineKeyboard();
  availableCourses.slice(0, PAGE_SIZE).forEach((c) => {
    courseKeyboard.text(`${c.code}: ${c.title.substring(0, 25)}`, `csc_crs_${c.id}`).row();
  });
  courseKeyboard.text('❌ Cancel', 'csc_cancel');

  await ctx.reply(
    `➕ *Select Course to Offer*\n` +
      `Section: *${selectedSectionName}*\n\n` +
      `${availableCourses.length > PAGE_SIZE ? `Showing first ${PAGE_SIZE} of ${availableCourses.length} available courses.\n` : ''}` +
      `Choose a course from the university catalog:`,
    { parse_mode: 'Markdown', reply_markup: courseKeyboard }
  );

  const courseCb = await conversation.waitForCallbackQuery(/^csc_(crs_|cancel)/);
  if (courseCb.callbackQuery.data === 'csc_cancel') {
    await courseCb.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Course creation cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  const selectedCourseId = courseCb.callbackQuery.data.replace('csc_crs_', '');
  const selectedCourse = availableCourses.find((c) => c.id === selectedCourseId);
  if (!selectedCourse) {
    await courseCb.answerCallbackQuery({ text: 'Course not found.' });
    await ctx.reply('❌ Selected course not found. Please run the action again.');
    return;
  }
  await courseCb.answerCallbackQuery({ text: `Selected ${selectedCourse.code}` });

  // 5. Fetch active teachers (preferring same department as course)
  const allTeachers = await conversation.external(() =>
    academicService.listTeachers(selectedCourse.department_id)
  );

  // If no department teachers, fall back to all teachers
  const teachers =
    allTeachers.length > 0
      ? allTeachers
      : await conversation.external(() => academicService.listTeachers());

  if (teachers.length === 0) {
    await ctx.reply(
      `⚠️ No active teachers found in the university directory.\n` +
        `Ask your System Administrator to add teachers before creating course offerings.`,
      { reply_markup: getRepresentativeMainMenuKeyboard() }
    );
    return;
  }

  const teacherKeyboard = new InlineKeyboard();
  teachers.slice(0, PAGE_SIZE).forEach((t) => {
    teacherKeyboard.text(t.full_name.substring(0, 40), `csc_tch_${t.id}`).row();
  });
  teacherKeyboard.text('❌ Cancel', 'csc_cancel');

  await ctx.reply(
    `📚 *Select Delivering Teacher*\n` +
      `Course: *${selectedCourse.code} — ${selectedCourse.title}*\n\n` +
      `Choose the teacher responsible for receiving submissions:`,
    { parse_mode: 'Markdown', reply_markup: teacherKeyboard }
  );

  const teacherCb = await conversation.waitForCallbackQuery(/^csc_(tch_|cancel)/);
  if (teacherCb.callbackQuery.data === 'csc_cancel') {
    await teacherCb.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Course creation cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  const selectedTeacherId = teacherCb.callbackQuery.data.replace('csc_tch_', '');
  const selectedTeacher = teachers.find((t) => t.id === selectedTeacherId);
  if (!selectedTeacher) {
    await teacherCb.answerCallbackQuery({ text: 'Teacher not found.' });
    await ctx.reply('❌ Selected teacher not found. Please run the action again.');
    return;
  }
  await teacherCb.answerCallbackQuery({ text: `Selected ${selectedTeacher.full_name}` });

  // 6. Confirm
  const confirmKeyboard = new InlineKeyboard()
    .text('✅ Confirm & Create', 'csc_confirm')
    .text('❌ Cancel', 'csc_cancel');

  await ctx.reply(
    `📋 *Confirm Course Offering*\n` +
      `───────────────────────────\n` +
      `• *Course:* ${selectedCourse.code} — ${selectedCourse.title}\n` +
      `• *Section:* ${selectedSectionName}\n` +
      `• *Teacher:* ${selectedTeacher.full_name}\n\n` +
      `Students in *${selectedSectionName}* will be able to see this course and its assignments.`,
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );

  const confirmCb = await conversation.waitForCallbackQuery(['csc_confirm', 'csc_cancel']);
  if (confirmCb.callbackQuery.data === 'csc_cancel') {
    await confirmCb.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Course creation cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  // 7. Create the offering
  try {
    const offering = await conversation.external(() =>
      cso.createOffering({
        course_id: selectedCourseId,
        section_id: selectedSectionId,
        teacher_id: selectedTeacherId,
        academic_year_id: selectedAcademicYearId,
        created_by: repData.profile.id,
      })
    );

    await confirmCb.answerCallbackQuery({ text: 'Course created!' });
    await ctx.reply(
      `✅ *Course Offering Created!*\n\n` +
        `• *Course:* ${offering.course?.code} — ${offering.course?.title}\n` +
        `• *Section:* ${selectedSectionName}\n` +
        `• *Teacher:* ${offering.teacher?.full_name}\n\n` +
        `Students in this section will now see this course.\n` +
        `Use *📝 Create Assignment* to add assignments to this course.`,
      { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await confirmCb.answerCallbackQuery({ text: 'Error' });
    await ctx.reply(`❌ *Failed to create course offering:*\n${msg}`, { parse_mode: 'Markdown' });
  }
}
